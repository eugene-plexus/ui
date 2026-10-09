/**
 * Web search order (GS7), driven through the Routing page.
 *
 * The gateway here is a small stateful stub: a PATCH to `webSearchOrder`
 * changes what the next `GET /v1/admin/routing` reports, so the assertion
 * that matters (the page re-reads the view after Save rather than trusting
 * what it sent) can fail: the stub places accounts by its own rule.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RoutingPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/routing",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div data-testid="shell">{children}</div>,
}));

interface Account {
  name: string;
  node?: string | null;
  provider: string;
  label: string;
  billing: "free" | "per_search";
  runs: boolean;
}

// In the gateway's default order: free first, then per-search.
const DEFAULT_ACCOUNTS: Account[] = [
  {
    name: "searxng",
    node: "nas",
    provider: "searxng",
    label: "SearXNG",
    billing: "free",
    runs: false,
  },
  { name: "brave", provider: "brave", label: "Brave Search", billing: "per_search", runs: true },
  {
    name: "google",
    provider: "google",
    label: "Google Search (Gemini API key)",
    billing: "per_search",
    runs: true,
  },
];

const keyOf = (a: Account) => (a.node ? `${a.node}:${a.name}` : a.name);

let order: string[];
let patched: unknown[];
let rejectNext: string | null;
let reads: number;

function view() {
  const named = order
    .map((k) => DEFAULT_ACCOUNTS.find((a) => keyOf(a) === k))
    .filter((a): a is Account => a !== undefined);
  const rest = DEFAULT_ACCOUNTS.filter((a) => !named.includes(a));
  return {
    refreshed_at: "2026-10-09T12:00:00Z",
    slots: [],
    search_accounts: [
      ...named.map((a) => ({ ...a, placed_by: "order" })),
      ...rest.map((a) => ({ ...a, placed_by: "default" })),
    ],
  };
}

beforeEach(() => {
  order = [];
  patched = [];
  rejectNext = null;
  reads = 0;
  sessionStorage.clear();
  localStorage.clear();
  sessionStorage.setItem("eugene-session-token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const route = String(input).replace(/^\/api\/proxy\//, "");
      const key = `${init?.method ?? "GET"} ${route}`;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      let result: { status: number; body?: unknown } = {
        status: 418,
        body: { detail: `unhandled: ${key}` },
      };
      if (key === "GET gateway/v1/config") result = { status: 200, body: { modelSlots: [] } };
      if (key === "GET gateway/v1/admin/routing") {
        reads += 1;
        result = { status: 200, body: view() };
      }
      if (key === "PATCH gateway/v1/config") {
        patched.push(body);
        if (rejectNext) {
          result = {
            status: 200,
            body: { applied: [], rejected: [{ key: "webSearchOrder", message: rejectNext }] },
          };
        } else {
          order = (body as { webSearchOrder: string[] }).webSearchOrder;
          result = { status: 200, body: { applied: ["webSearchOrder"], rejected: [] } };
        }
      }
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

async function section() {
  render(<RoutingPage />);
  return await screen.findByTestId("web-search-order", {}, { timeout: 5000 });
}

function names(el: HTMLElement) {
  return within(el)
    .getAllByTestId("search-order-row")
    .map((r) => r.querySelector(".font-mono")?.textContent);
}

describe("Web search order on the Routing page", () => {
  it("lists the accounts as the gateway reports them, and says the default is in effect", async () => {
    const s = await section();
    expect(names(s)).toEqual(["searxng", "brave", "google"]);
    const rows = within(s).getAllByTestId("search-order-row");
    expect(rows[0]).toHaveTextContent("SearXNG");
    expect(rows[0]).toHaveTextContent("on nas");
    expect(rows[0]).toHaveTextContent("free");
    expect(rows[0]).toHaveTextContent("not set up");
    expect(rows[2]).toHaveTextContent("Google Search (Gemini API key)");
    expect(rows[2]).toHaveTextContent("billed per search");
    expect(rows[2]).not.toHaveTextContent("not set up");
    expect(screen.getByTestId("search-order-in-effect")).toHaveTextContent(
      "The default order is in effect: free accounts first, then this machine's before others.",
    );
    // Nothing to reset, nothing to save.
    expect(screen.getByTestId("search-order-save")).toBeDisabled();
    expect(screen.getByTestId("search-order-reset")).toBeDisabled();
  });

  it("links to the search accounts page, and the page links back here", async () => {
    const s = await section();
    expect(within(s).getByRole("link", { name: "the search accounts page" })).toHaveAttribute(
      "href",
      "/backends/search?sel=backends",
    );
    expect(screen.getByRole("link", { name: "further down" })).toHaveAttribute(
      "href",
      "#web-search-order",
    );
  });

  it("moves an account, saves the order with node:name keys, and re-reads the view", async () => {
    const user = userEvent.setup({ delay: null });
    const s = await section();
    await user.click(within(s).getByRole("button", { name: /Google Search.*earlier/ }));
    // Local only until Save, and said so.
    expect(names(s)).toEqual(["searxng", "google", "brave"]);
    expect(patched).toEqual([]);
    expect(screen.getByTestId("search-order-in-effect")).toHaveTextContent(
      "Nothing changes until you press Save order",
    );
    await user.click(within(s).getByRole("button", { name: /Google Search.*earlier/ }));
    expect(names(s)).toEqual(["google", "searxng", "brave"]);
    const readsBefore = reads;
    await user.click(screen.getByTestId("search-order-save"));
    await screen.findByTestId("search-order-saved");
    expect(patched).toEqual([{ webSearchOrder: ["google", "nas:searxng", "brave"] }]);
    // The view was read again, and what shows is the gateway's word.
    expect(reads).toBeGreaterThan(readsBefore);
    expect(names(s)).toEqual(["google", "nas:searxng".split(":")[1], "brave"]);
    expect(screen.getByTestId("search-order-in-effect")).toHaveTextContent(
      "Your order is in effect.",
    );
    within(s)
      .getAllByTestId("search-order-row")
      .forEach((r) => expect(r).toHaveTextContent("your order"));
  });

  it("says when only some accounts are placed by the person's order", async () => {
    order = ["brave"];
    const s = await section();
    expect(names(s)).toEqual(["brave", "searxng", "google"]);
    expect(screen.getByTestId("search-order-in-effect")).toHaveTextContent(
      "Your order is in effect for the first 1. The rest follow the default order",
    );
    const rows = within(s).getAllByTestId("search-order-row");
    expect(rows[0]).toHaveTextContent("your order");
    expect(rows[1]).toHaveTextContent("default order");
  });

  it("Use the default order sends an empty list and shows the default rule again", async () => {
    order = ["google", "brave"];
    const user = userEvent.setup({ delay: null });
    const s = await section();
    expect(names(s)).toEqual(["google", "brave", "searxng"]);
    await user.click(screen.getByTestId("search-order-reset"));
    await screen.findByTestId("search-order-saved");
    expect(patched).toEqual([{ webSearchOrder: [] }]);
    expect(names(s)).toEqual(["searxng", "brave", "google"]);
    expect(screen.getByTestId("search-order-in-effect")).toHaveTextContent(
      "The default order is in effect",
    );
  });

  it("shows a refused save by its reason and keeps the moved order on screen", async () => {
    rejectNext = "webSearchOrder names no search account called ghost.";
    const user = userEvent.setup({ delay: null });
    const s = await section();
    await user.click(within(s).getByRole("button", { name: /Brave Search.*later/ }));
    await user.click(screen.getByTestId("search-order-save"));
    await waitFor(() =>
      expect(screen.getByTestId("search-order-error")).toHaveTextContent("names no search account"),
    );
    expect(screen.queryByTestId("search-order-saved")).toBeNull();
    expect(names(s)).toEqual(["searxng", "google", "brave"]);
  });

  it("names the empty case and points to adding an account", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const route = String(input).replace(/^\/api\/proxy\//, "");
        const body = route.endsWith("/v1/admin/routing")
          ? { refreshed_at: "2026-10-09T12:00:00Z", slots: [], search_accounts: [] }
          : { modelSlots: [] };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const s = await section();
    expect(within(s).getByTestId("search-order-empty")).toHaveTextContent("No search accounts yet");
    expect(within(s).getByRole("link", { name: "Add one" })).toHaveAttribute(
      "href",
      "/backends/search?sel=backends",
    );
  });
});
