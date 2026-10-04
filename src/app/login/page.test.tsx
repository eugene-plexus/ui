/**
 * Sign-in, driven: one call, to this machine's agent.
 *
 * Since per-node token keys (2026-09-25) the agent forwards the
 * passphrase to the control root, which mints the session and unlocks
 * itself in the same step. This page used to post the passphrase to the
 * root a second time; what matters now is that it does not, and that a
 * root the agent could not reach is reported rather than read as an
 * install that needs setting up.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ATTRIBUTION } from "@/components/Attribution";

import LoginPage from "./page";

const replace = vi.fn();
let search = "next=%2Fnodes";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));

interface Call {
  url: string;
  method: string;
  body: unknown;
  authorization: string | null;
}
let calls: Call[];
let agentLoginFailure: { status: number; title: string; detail: string } | null;

beforeEach(() => {
  search = "next=%2Fnodes";
  calls = [];
  agentLoginFailure = null;
  replace.mockReset();
  sessionStorage.clear();
  const seen = calls;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      seen.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
        authorization: headers.get("authorization"),
      });
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      if (url.endsWith("/api/proxy/agent/v1/auth/status")) return json({ initialized: true });
      if (url.endsWith("/api/proxy/agent/v1/auth/login")) {
        if (agentLoginFailure !== null)
          return json(
            {
              detail: {
                title: agentLoginFailure.title,
                detail: agentLoginFailure.detail,
                status: agentLoginFailure.status,
              },
            },
            agentLoginFailure.status,
          );
        const body = init?.body ? (JSON.parse(String(init.body)) as { passphrase: string }) : null;
        if (body?.passphrase !== "correct horse")
          return json({ detail: { title: "Invalid", status: 401 } }, 401);
        return json({ sessionToken: "agent-jwt", expiresAt: "2026-09-27T00:00:00Z" });
      }
      return json({ detail: "Not Found" }, 404);
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function signIn(passphrase: string) {
  render(<LoginPage />);
  const field = await screen.findByLabelText(/passphrase/i);
  await userEvent.type(field, passphrase, { delay: null });
  await userEvent.click(screen.getByRole("button", { name: /unlock/i }));
}

const controlLogins = () => calls.filter((c) => c.url.endsWith("/api/proxy/control/v1/auth/login"));

describe("typing the passphrase", () => {
  it("can be shown, and hidden again", async () => {
    render(<LoginPage />);
    const field = await screen.findByLabelText(/passphrase/i);
    expect(field).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(field).toHaveAttribute("type", "text");
    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(field).toHaveAttribute("type", "password");
  });

  it("says when Caps Lock is on", async () => {
    render(<LoginPage />);
    const field = await screen.findByLabelText(/passphrase/i);
    field.focus();
    const event = new KeyboardEvent("keydown", { key: "A", bubbles: true });
    Object.defineProperty(event, "getModifierState", {
      value: (k: string) => k === "CapsLock",
    });
    act(() => {
      field.dispatchEvent(event);
    });
    expect(await screen.findByTestId("caps-lock")).toHaveTextContent("Caps Lock is on.");
    expect(field).toHaveAccessibleDescription(/Caps Lock is on/);
  });
});

describe("signing in", () => {
  it("is one call to this machine's agent, then navigates", async () => {
    await signIn("correct horse");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/nodes"));
    const logins = calls.filter((c) => c.url.includes("/v1/auth/login"));
    expect(logins).toHaveLength(1);
    expect(logins[0]?.url).toMatch(/\/api\/proxy\/agent\/v1\/auth\/login$/);
    expect(logins[0]?.body).toEqual({ passphrase: "correct horse" });
    expect(controlLogins()).toHaveLength(0);
    expect(sessionStorage.getItem("eugene-session-token")).toBe("agent-jwt");
  });

  it("reports a control root it could not reach, and does not send anyone to setup", async () => {
    agentLoginFailure = {
      status: 503,
      title: "Control root unreachable",
      detail: "Signing in needs the control root at http://10.0.0.1:8083, and it did not answer.",
    };
    await signIn("correct horse");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/needs the control root/);
    expect(replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("eugene-session-token")).toBeNull();
  });

  it("sends an install with no passphrase yet to setup", async () => {
    agentLoginFailure = { status: 503, title: "Setup required", detail: "No passphrase set yet." };
    await signIn("correct horse");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/setup"));
  });

  it("puts the cursor back in the box and ties the refusal to it", async () => {
    await signIn("wrong");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/did not match/i);
    const field = screen.getByLabelText(/passphrase/i);
    // It was disabled while the request was out, which dropped focus to
    // the page: a retype needed a click first.
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(/did not match/i);
  });

  it("goes nowhere when the passphrase was refused", async () => {
    await signIn("wrong");
    await screen.findByText(/did not match/i);
    expect(controlLogins()).toHaveLength(0);
    expect(replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("eugene-session-token")).toBeNull();
  });

  // The api client adds `reason=expired` when the session it sent was
  // refused. Without a line saying so, the person was reading a page one
  // moment and looking at a passphrase box the next, with no idea why.
  it("says the session ended when it was sent here because one did", async () => {
    search = "next=%2Fnodes&reason=expired";
    render(<LoginPage />);
    await screen.findByLabelText(/passphrase/i);
    expect(screen.getByText("Your session ended. Sign in again.")).toBeInTheDocument();
  });

  it("says nothing about a session to someone arriving without one", async () => {
    render(<LoginPage />);
    await screen.findByLabelText(/passphrase/i);
    expect(screen.queryByText(/session ended/i)).toBeNull();
  });

  // The third of the licence line's three surfaces. It is driven here
  // rather than in `components/Attribution.test.tsx` because reaching
  // the card needs the stubbed fetch and mocked router this file
  // already sets up -- and it is driven at all because a component
  // test is not a wiring test.
  it("carries the licence line on the card", async () => {
    render(<LoginPage />);
    // After the probe, not before: the card is a "Loading…" line until
    // the install is known to be initialized, and a line asserted in
    // that window would pass against a screen nobody can sign in on.
    await screen.findByLabelText(/passphrase/i);
    expect(screen.getByTestId("attribution")).toHaveTextContent(ATTRIBUTION);
  });
});
