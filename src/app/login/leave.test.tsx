/**
 * ui#20: a machine that can get no session here, because the install removed
 * it or its control root is gone, leaves with its own passphrase from the
 * sign-in page.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LoginPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

interface Call {
  url: string;
  body: unknown;
  authorization: string | null;
}
let calls: Call[];
let refusal: { status: number; title: string; detail: string };
let leaveAnswer: { status: number; body: unknown };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  calls = [];
  sessionStorage.clear();
  sessionStorage.setItem("eugene-session-token", "a-stale-session");
  refusal = {
    status: 409,
    title: "This machine was removed from the install",
    detail: "The install at http://10.0.0.1:8083 did not sign you in to this machine.",
  };
  leaveAnswer = {
    status: 200,
    body: {
      identity: { enrolled: false },
      controlNotified: true,
      previousName: "gpu-box",
      previousControlUrl: "http://10.0.0.1:8083",
      detail: "The install had already removed this machine.",
    },
  };
  const seen = calls;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      if (url.endsWith("/v1/auth/status")) return json({ initialized: true });
      if (url.endsWith("/v1/auth/login")) return json({ detail: { ...refusal } }, refusal.status);
      if (url.endsWith("/v1/node/unenroll")) return json(leaveAnswer.body, leaveAnswer.status);
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

describe("leaving the install from sign-in", () => {
  it("is offered to a removed machine, with its passphrase and no session", async () => {
    await signIn("this machine's own");
    const button = await screen.findByTestId("leave-with-passphrase");
    await userEvent.click(button);
    expect(await screen.findByTestId("left-install")).toHaveTextContent(
      "This machine left the install at http://10.0.0.1:8083 and works on its own now.",
    );
    const leave = calls.find((c) => c.url.endsWith("/api/proxy/agent/v1/node/unenroll"));
    expect(leave?.body).toEqual({ passphrase: "this machine's own" });
    expect(leave?.authorization).toBeNull();
  });

  it("is offered when the control root does not answer, and says the root was not told", async () => {
    refusal = { status: 503, title: "Control root unreachable", detail: "It did not answer." };
    leaveAnswer.body = {
      ...(leaveAnswer.body as object),
      controlNotified: false,
      detail: "The control root at http://10.0.0.1:8083 did not answer, so it was not told.",
    };
    await signIn("this machine's own");
    await userEvent.click(await screen.findByTestId("leave-with-passphrase"));
    expect(await screen.findByTestId("left-install")).toHaveTextContent("it was not told");
  });

  it("shows the agent's refusal when the install still lists the machine", async () => {
    leaveAnswer = {
      status: 409,
      body: {
        detail: {
          title: "The install still lists this machine",
          detail: "The control root at http://10.0.0.1:8083 still lists this machine as 'gpu-box'.",
        },
      },
    };
    await signIn("this machine's own");
    await userEvent.click(await screen.findByTestId("leave-with-passphrase"));
    expect(await screen.findByRole("alert")).toHaveTextContent("still lists this machine");
    expect(screen.queryByTestId("left-install")).toBeNull();
  });

  it("is not offered for a wrong passphrase", async () => {
    refusal = { status: 401, title: "Wrong passphrase", detail: "No." };
    await signIn("wrong");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByTestId("leave-with-passphrase")).toBeNull();
  });
});
