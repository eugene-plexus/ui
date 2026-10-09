/**
 * The first-run gate when nothing answers.
 *
 * The gate's first call is the first thing every install-root page does,
 * and it had no deadline: an agent that accepted the connection and never
 * replied (a blocked event loop, a restart half done, a tailnet hop that
 * dropped) left the page reading "Checking setup state…" forever, with
 * nothing to press. What matters here is that each page that uses the
 * gate gives up in bounded time, says so in plain words, and offers a
 * way to try again that really does try again.
 *
 * Driven through the PAGES rather than the hook alone: a hook that
 * reports `unreachable` is no use if a page renders its whole body for
 * any state that is not `checking`, which is exactly how the three pages
 * were written.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AddBackendPage from "@/app/backends/add/page";
import LoginPage from "@/app/login/page";
import HomePage from "@/app/page";
import PlaygroundPage from "@/app/playground/page";
import WizardPage from "@/app/setup/page";

vi.mock("next/navigation", () => {
  // One router for the life of the test, as Next gives: the gate's effect
  // depends on it, and a new object per render would restart the check on
  // every render.
  const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
  return {
    useRouter: () => router,
    usePathname: () => "/",
    useSearchParams: () => new URLSearchParams(),
  };
});

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div data-testid="shell">{children}</div>,
}));

vi.mock("@/lib/useAutoScroll", () => ({
  useAutoScroll: () => ({
    scrollRef: { current: null },
    isAtBottom: true,
    scrollToBottom: () => {},
  }),
}));

/** What the agent does for each route: hang, or answer. */
let answering: boolean;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  answering = false;
  sessionStorage.clear();
  localStorage.clear();
  sessionStorage.setItem("eugene-session-token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const route = String(input).replace(/^\/api\/proxy\//, "");
      if (!answering) {
        // Accepts the connection and never replies, until aborted.
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        });
      }
      const body =
        route === "agent/v1/auth/status"
          ? { initialized: true }
          : route === "agent/v1/config"
            ? { firstRunComplete: true }
            : { detail: "not in this test" };
      const status = body && "detail" in body ? 404 : 200;
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Either apostrophe: the copy is written with `&rsquo;`. */
const UNREACHABLE = /Can.t reach Eugene on this machine\./;

/** Longer than any deadline the gate could sensibly have. */
async function waitOutTheGate() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
}

describe("the setup gate when the agent never answers", () => {
  it.each([
    ["Home", HomePage],
    ["the playground", PlaygroundPage],
    ["Add an app", AddBackendPage],
  ])("%s stops checking and says it cannot reach Eugene", async (_name, Page) => {
    render(<Page />);
    expect(screen.getByText("Checking setup state…")).toBeInTheDocument();
    await waitOutTheGate();
    expect(screen.queryByText("Checking setup state…")).toBeNull();
    expect(screen.getByText(UNREACHABLE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    // The page body is not rendered behind it.
    expect(screen.queryByTestId("shell")).toBeNull();
  });

  it.each([
    ["sign-in", LoginPage],
    ["the wizard", WizardPage],
  ])(
    "%s stops loading, says it cannot reach Eugene, and Try again asks again",
    async (_n, Page) => {
      // Their own startup checks had no deadline: against an agent that
      // took the connection and never replied, "Loading…" stayed forever.
      render(<Page />);
      await waitOutTheGate();
      expect(screen.getByText(UNREACHABLE)).toBeInTheDocument();

      answering = true;
      const asked = vi.mocked(fetch).mock.calls.length;
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(asked);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.queryByText(UNREACHABLE)).toBeNull();
    },
  );

  it("a refused connection is no answer too, and says so at once", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    render(<HomePage />);
    expect(await screen.findByText(UNREACHABLE)).toBeInTheDocument();
  });

  it("an agent that answered with an error still opens the page", async () => {
    // It is there; the page's own reads will say what is wrong. Only no
    // answer at all is the unreachable state.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "boom" }), { status: 500 })),
    );
    render(<HomePage />);
    expect(await screen.findByTestId("home")).toBeInTheDocument();
    expect(screen.queryByText(UNREACHABLE)).toBeNull();
  });

  it("Try again asks again, and opens the page once the agent answers", async () => {
    render(<HomePage />);
    await waitOutTheGate();
    expect(screen.getByText(UNREACHABLE)).toBeInTheDocument();

    answering = true;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(await screen.findByTestId("home")).toBeInTheDocument();
    expect(screen.queryByText(UNREACHABLE)).toBeNull();
  });
});
