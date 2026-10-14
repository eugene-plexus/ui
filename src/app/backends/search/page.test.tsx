/**
 * Adding a search account (P8), driven.
 *
 * The assertion that matters is the sequence: the account is created
 * before it is configured, and a real test search runs before the page
 * says web search is on -- so a SearXNG with JSON output off is found
 * here, with the fix, not when a model asks.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AddSearchAccountPage from "./page";
import {
  blankSearch,
  freeSearchPort,
  remedyFor,
  searchDraftComplete,
  searchNameFor,
  searchPatch,
} from "./searchAccount";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/backends/search",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/setup/start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/setup/start")>()),
  withRetry: <T,>(call: () => Promise<T>) => call(),
}));

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div data-testid="shell">{children}</div>,
}));

interface Call {
  method: string;
  route: string;
  body: Record<string, unknown> | undefined;
}

type Handler = () => { status: number; body?: unknown };

let calls: Call[];
let handlers: Map<string, Handler>;

const components = [
  { name: "gateway", kind: "gateway", url: "http://127.0.0.1:8080/" },
  { name: "searxng", kind: "tool-driver", url: "http://127.0.0.1:8190/" },
];

function install(test: { ok: boolean; summary?: string; error?: string }): Map<string, Handler> {
  return new Map<string, Handler>([
    ["GET agent/v1/auth/status", () => ({ status: 200, body: { initialized: true } })],
    ["GET agent/v1/config", () => ({ status: 200, body: { firstRunComplete: true } })],
    ["GET agent/v1/components", () => ({ status: 200, body: { components } })],
    ["POST agent/v1/components", () => ({ status: 201, body: {} })],
    ["PATCH searxng-2/v1/config", () => ({ status: 200, body: { applied: ["provider"] } })],
    ["POST searxng-2/v1/config/test", () => ({ status: 200, body: test })],
    ["PATCH google/v1/config", () => ({ status: 200, body: { applied: ["provider"] } })],
    ["POST google/v1/config/test", () => ({ status: 200, body: test })],
  ]);
}

function key(call: Call): string {
  return `${call.method} ${call.route}`;
}

function stub(routes: Map<string, Handler>) {
  calls = [];
  handlers = routes;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? "GET",
        route: String(input).replace(/^\/api\/proxy\//, ""),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const handler = handlers.get(key(call));
      const result = handler
        ? handler()
        : { status: 418, body: { detail: { title: `unhandled route: ${key(call)}` } } };
      return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
        status: result.status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem("eugene-session-token", "test-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const BANNED = ["tool-driver", "tool driver", "component", "topology", "egress", "operator"];

describe("/backends/search", () => {
  it("creates the account, gives it its address, and runs a real test search", async () => {
    stub(install({ ok: true, summary: "searxng answered 3 results for 'Apache License 2.0'." }));
    const user = userEvent.setup({ delay: null });
    render(<AddSearchAccountPage />);
    await screen.findByRole("heading", { name: "Add a search account" });
    const add = screen.getByTestId("search-add-button");
    expect(add).toBeDisabled();
    await user.type(screen.getByTestId("search-address"), "http://192.168.1.20:8888/");
    expect(add).toBeEnabled();
    await user.click(add);
    await screen.findByTestId("search-added");
    const text = (screen.getByTestId("search-add").textContent ?? "").toLowerCase();
    for (const word of BANNED) expect(text, word).not.toContain(word);

    const sequence = calls
      .map(key)
      .filter((k) => !k.startsWith("GET agent/v1/auth") && k !== "GET agent/v1/config");
    expect(sequence).toEqual([
      "GET agent/v1/components",
      "POST agent/v1/components",
      "PATCH searxng-2/v1/config",
      "POST searxng-2/v1/config/test",
    ]);
    const created = calls.find((c) => key(c) === "POST agent/v1/components");
    expect(created?.body).toEqual({
      name: "searxng-2",
      kind: "tool-driver",
      url: "http://127.0.0.1:8191",
      spawn: { configFile: "searxng-2.yaml" },
    });
    const patched = calls.find((c) => key(c) === "PATCH searxng-2/v1/config");
    expect(patched?.body).toEqual({ provider: "searxng", baseUrl: "http://192.168.1.20:8888" });
    expect(screen.getByTestId("search-try")).toHaveAttribute("href", "/playground?search=1");
  });

  it("says what to change when the test search fails, and tries again on the same account", async () => {
    stub(
      install({
        ok: false,
        error:
          "SearXNG at http://192.168.1.20:8888 refused JSON output (HTTP 403). Add `json` to `search.formats`",
      }),
    );
    const user = userEvent.setup({ delay: null });
    render(<AddSearchAccountPage />);
    await user.type(await screen.findByTestId("search-address"), "http://192.168.1.20:8888");
    await user.click(screen.getByTestId("search-add-button"));
    const error = await screen.findByTestId("search-error");
    expect(error.textContent).toMatch(/settings\.yml/);
    expect(screen.getByTestId("search-add-button")).toHaveTextContent("Try again");
    handlers.set("POST searxng-2/v1/config/test", () => ({
      status: 200,
      body: { ok: true, summary: "fine" },
    }));
    await user.click(screen.getByTestId("search-add-button"));
    await screen.findByTestId("search-added");
    await waitFor(() =>
      expect(calls.filter((c) => key(c) === "POST agent/v1/components")).toHaveLength(1),
    );
  });

  it("asks Brave for a key, never an address", async () => {
    stub(install({ ok: true }));
    const user = userEvent.setup({ delay: null });
    render(<AddSearchAccountPage />);
    await user.click(await screen.findByTestId("search-provider-brave"));
    expect(screen.queryByTestId("search-address")).toBeNull();
    expect(screen.getByTestId("search-key")).toHaveAttribute("type", "password");
  });
});

describe("adding a Google search account", () => {
  it("offers Google by its name, asks for a Gemini key, and says the price and the terms", async () => {
    stub(install({ ok: true }));
    const user = userEvent.setup({ delay: null });
    render(<AddSearchAccountPage />);
    await user.click(await screen.findByTestId("search-provider-google"));
    expect(screen.getByText("Google Search (Gemini API key)")).toBeInTheDocument();
    expect(screen.queryByTestId("search-address")).toBeNull();
    expect(screen.getByTestId("search-key")).toHaveAttribute("type", "password");
    const page = screen.getByTestId("search-add").textContent ?? "";
    expect(page).toContain("aistudio.google.com/apikey");
    const notes = screen.getByTestId("search-google-notes").textContent ?? "";
    expect(notes).toContain("5,000 searches a month are free");
    expect(notes).toContain("$14 per 1,000");
    expect(notes).toContain("as of 2026-10");
    expect(notes).toContain(
      "Google's terms bind the key's owner: Google's answer and sources are shown unmodified, with Google's Search Suggestions, to the person who asked. Workbench shows them; other apps may not.",
    );
    // The notes are Google's alone.
    await user.click(screen.getByTestId("search-provider-brave"));
    expect(screen.queryByTestId("search-google-notes")).toBeNull();
    for (const word of BANNED) expect(page.toLowerCase(), word).not.toContain(word);
  });

  it("creates a google account with its key and links to the search order", async () => {
    stub(install({ ok: true, summary: "google answered." }));
    const user = userEvent.setup({ delay: null });
    render(<AddSearchAccountPage />);
    await user.click(await screen.findByTestId("search-provider-google"));
    expect(screen.getByTestId("search-add-button")).toBeDisabled();
    await user.type(screen.getByTestId("search-key"), " AIza-test ");
    await user.click(screen.getByTestId("search-add-button"));
    await screen.findByTestId("search-added");
    const created = calls.find((c) => key(c) === "POST agent/v1/components");
    expect((created?.body as { name: string }).name).toBe("google");
    const patched = calls.find((c) => key(c) === "PATCH google/v1/config");
    expect(patched?.body).toEqual({ provider: "google", apiKey: "AIza-test" });
    expect(screen.getByTestId("search-order-link").querySelector("a")).toHaveAttribute(
      "href",
      "/routing?sel=gateway#web-search-order",
    );
  });

  it("links to the search order before the account is added too", async () => {
    stub(install({ ok: true }));
    render(<AddSearchAccountPage />);
    const link = (await screen.findByTestId("search-order-link")).querySelector("a");
    expect(link).toHaveAttribute("href", "/routing?sel=gateway#web-search-order");
  });
});

describe("the search account helpers", () => {
  it("names, ports, patches and remedies", () => {
    const existing = [
      { name: "brave", kind: "tool-driver", url: "http://127.0.0.1:8190/" },
    ] as never[];
    expect(searchNameFor("brave", existing)).toBe("brave-2");
    expect(searchNameFor("searxng", existing)).toBe("searxng");
    expect(freeSearchPort(existing)).toBe(8191);
    expect(searchPatch({ provider: "brave", address: "x", apiKey: " k " })).toEqual({
      provider: "brave",
      apiKey: "k",
    });
    expect(searchDraftComplete(blankSearch())).toBe(false);
    expect(searchDraftComplete({ ...blankSearch(), address: "searx.lan" })).toBe(false);
    expect(searchDraftComplete({ ...blankSearch(), address: "http://searx.lan" })).toBe(true);
    expect(remedyFor("searxng", "HTTP 403")).toMatch(/settings\.yml/);
    expect(remedyFor("brave", "refused this account's API key")).toMatch(/Copy the key/);
    expect(remedyFor("searxng", "something else")).toBeNull();
    expect(searchPatch({ provider: "google", address: "x", apiKey: " g " })).toEqual({
      provider: "google",
      apiKey: "g",
    });
    expect(searchDraftComplete({ ...blankSearch(), provider: "google" })).toBe(false);
    expect(searchDraftComplete({ ...blankSearch(), provider: "google", apiKey: "k" })).toBe(true);
    expect(searchNameFor("google", [])).toBe("google");
    expect(remedyFor("google", "refused this account's API key")).toContain("aistudio.google.com");
  });
});
