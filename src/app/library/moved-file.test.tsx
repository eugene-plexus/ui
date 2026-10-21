/**
 * Row 22, on the Library page: a missing model whose file moved says where it
 * went, and after one click the page shows the model that has its profiles.
 * Driven through the page against stubbed routes, so the wiring is the thing
 * under test (the component's own sentences are covered beside it).
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LibraryPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/library",
  useSearchParams: () => new URLSearchParams("model=old"),
}));

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, controls }: { children: ReactNode; controls?: ReactNode }) => (
    <div data-testid="shell">
      {controls}
      {children}
    </div>
  ),
}));

const OLD = "D:\\models\\x.gguf";
const NEW = "E:\\llm\\x.gguf";

type Result = { status: number; body?: unknown };
let handlers: Map<string, () => Result>;
let posted: string[];
/** The writes that are not the page's own eligibility question (a read, by POST). */
const writes = () => posted.filter((p) => p !== "POST library/v1/eligibility");
let bodies: Map<string, unknown>;
/** Which models the Library lists: the move changes it. */
let moved = false;

function ok(body: unknown): Result {
  return { status: 200, body };
}

const missing = {
  id: "old",
  path: OLD,
  format: "gguf",
  name: "x",
  status: "missing",
  profileCount: 2,
  lastSeenAt: "2026-10-01T00:00:00Z",
};
const present = {
  id: "new",
  path: NEW,
  format: "gguf",
  name: "x",
  status: "present",
  profileCount: 0,
};

beforeEach(() => {
  moved = false;
  posted = [];
  bodies = new Map();
  handlers = new Map<string, () => Result>([
    ["GET agent/v1/node", () => ok({ enrolled: true, name: "Amish_Station", devices: [] })],
    ["GET control/v1/nodes", () => ({ status: 503, body: { detail: "no root" } })],
    [
      "GET library/v1/models",
      () => ok({ models: moved ? [{ ...present, profileCount: 2 }] : [missing, present] }),
    ],
    ["GET library/v1/scan", () => ok({ state: "idle" })],
    ["GET library/v1/downloads", () => ok({ downloads: [] })],
    ["GET agent/v1/engines", () => ok({ engines: [] })],
    ["GET agent/v1/runtimes", () => ok({ runtimes: [] })],
    ["POST library/v1/eligibility", () => ok({ models: [] })],
    ["GET library/v1/models/old/profiles", () => ok({ profiles: [] })],
    ["GET library/v1/models/new/profiles", () => ok({ profiles: [] })],
    [
      "GET library/v1/models/old/relocate-candidates",
      () =>
        ok({
          candidates: [{ model: { ...present, profileCount: 0 }, match: "same", differences: [] }],
        }),
    ],
    [
      "POST library/v1/models/old/relocate",
      () => {
        moved = true;
        return ok({
          model: { ...present, profileCount: 2 },
          moved: 2,
          renamed: [],
          warnings: ['The profile "vision" still names the old path in its extra arguments.'],
        });
      },
    ],
  ]);
  sessionStorage.clear();
  localStorage.clear();
  sessionStorage.setItem("eugene-session-token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const route = String(input).replace(/^[/]api[/]proxy[/]/, "");
      const path = route.split("?")[0] ?? "";
      const method = init?.method ?? "GET";
      if (method !== "GET") {
        posted.push(`${method} ${path}`);
        if (typeof init?.body === "string") bodies.set(`${method} ${path}`, JSON.parse(init.body));
      }
      const handler = handlers.get(`${method} ${path}`);
      const result = handler ? handler() : { status: 418, body: { detail: `?? ${path}` } };
      return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
        status: result.status,
        statusText: String(result.status),
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a missing model whose file moved", () => {
  it("says where the file went and moves nothing by itself", async () => {
    render(<LibraryPage />);

    expect(await screen.findByTestId("moved-lead", {}, { timeout: 5000 })).toHaveTextContent(
      `Missing from ${OLD}. Found at ${NEW}.`,
    );
    expect(screen.getByRole("button", { name: /Move 2 profiles to/ })).toBeInTheDocument();
    // Forget is still there, beside it.
    expect(screen.getByRole("button", { name: "forget this entry and its profiles" })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 30));
    expect(writes()).toEqual([]);
  });

  it("moves the profiles on the click, and shows the model that has them", async () => {
    render(<LibraryPage />);
    const button = await screen.findByRole(
      "button",
      { name: /Move 2 profiles to/ },
      { timeout: 5000 },
    );

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => expect(writes()).toEqual(["POST library/v1/models/old/relocate"]));
    expect(bodies.get("POST library/v1/models/old/relocate")).toEqual({ to: "new" });
    const notice = await screen.findByTestId("moved-notice");
    expect(notice).toHaveTextContent(`Profiles moved to ${NEW}.`);
    expect(screen.getByTestId("moved-warning")).toHaveTextContent("still names the old path");
    // The missing entry is gone: no more "Missing", no more Forget.
    await waitFor(() => expect(screen.queryByTestId("moved-model")).toBeNull());
    expect(screen.queryByRole("button", { name: "forget this entry and its profiles" })).toBeNull();
  });
});
