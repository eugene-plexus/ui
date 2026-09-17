/**
 * Sign-in, driven: the passphrase that opens the agent opens the root.
 *
 * Reported from the live install: after a container update the UI asked
 * for the passphrase at sign-in and `/nodes` asked for it again, because
 * only the Nodes screen ever posted it to the sealed control root. What
 * matters here is the sequence of calls -- agent login, then control
 * login with the same passphrase -- and the three ways the second call
 * must NOT interfere with the first: a mismatched root, an unreachable
 * root, and a session that must survive the root's 401.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ATTRIBUTION } from "@/components/Attribution";

import LoginPage from "./page";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams("next=%2Fnodes"),
}));

interface Call {
  url: string;
  method: string;
  body: unknown;
  authorization: string | null;
}
let calls: Call[];
let controlStatus: number;
let controlThrows: boolean;

beforeEach(() => {
  calls = [];
  controlStatus = 200;
  controlThrows = false;
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
        const body = init?.body ? (JSON.parse(String(init.body)) as { passphrase: string }) : null;
        if (body?.passphrase !== "correct horse")
          return json({ detail: { title: "Invalid", status: 401 } }, 401);
        return json({ sessionToken: "agent-jwt", expiresAt: "2026-09-27T00:00:00Z" });
      }
      if (url.endsWith("/api/proxy/control/v1/auth/login")) {
        if (controlThrows) throw new TypeError("Failed to fetch");
        if (controlStatus === 200)
          return json({ sessionToken: "control-jwt", expiresAt: "2026-09-27T00:00:00Z" });
        return json({ detail: { title: "Invalid token", status: controlStatus } }, controlStatus);
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

describe("sign-in unlocks the control root", () => {
  it("posts the same passphrase to the root after the agent accepts it, then navigates", async () => {
    await signIn("correct horse");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/nodes"));
    const [agentLogin] = calls.filter((c) => c.url.endsWith("/api/proxy/agent/v1/auth/login"));
    const [rootLogin] = controlLogins();
    expect(agentLogin?.body).toEqual({ passphrase: "correct horse" });
    expect(rootLogin?.body).toEqual({ passphrase: "correct horse" });
    // Ordered: the root is asked only once the agent has said yes.
    expect(calls.indexOf(agentLogin!)).toBeLessThan(calls.indexOf(rootLogin!));
    // The fresh session is what the proxy spends to find the root on another node.
    expect(rootLogin?.authorization).toBe("Bearer agent-jwt");
    expect(sessionStorage.getItem("eugene-session-token")).toBe("agent-jwt");
  });

  it("a root with a different passphrase does not cost the session or the navigation", async () => {
    controlStatus = 401;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await signIn("correct horse");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/nodes"));
    expect(sessionStorage.getItem("eugene-session-token")).toBe("agent-jwt");
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/refused the same passphrase/));
    expect(screen.queryByText(/did not match/i)).toBeNull();
  });

  it("an unreachable root does not block sign-in", async () => {
    controlThrows = true;
    await signIn("correct horse");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/nodes"));
    expect(sessionStorage.getItem("eugene-session-token")).toBe("agent-jwt");
  });

  it("never asks the root when the agent refused the passphrase", async () => {
    await signIn("wrong");
    await screen.findByText(/did not match/i);
    expect(controlLogins()).toHaveLength(0);
    expect(replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("eugene-session-token")).toBeNull();
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
