/**
 * The Library's empty detail pane offers the Search models shelf (MR3).
 *
 * With nothing selected the pane says "Select a model" and, beside it, where to get
 * the three files an app that searches a person's documents needs. Selecting a
 * model replaces the pane, and so the shelf: it is a thing for before a person has
 * one, not a fixture of every model's page.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LibraryPage from "./page";

let query = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/library",
  useSearchParams: () => new URLSearchParams(query),
}));

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, controls }: { children: ReactNode; controls?: ReactNode }) => (
    <div data-testid="shell">
      {controls}
      {children}
    </div>
  ),
}));

let models: unknown[] = [];

beforeEach(() => {
  query = "";
  models = [];
  sessionStorage.clear();
  localStorage.clear();
  sessionStorage.setItem("eugene-session-token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const route = String(input).replace(/^[/]api[/]proxy[/]/, "");
      const path = route.split("?")[0] ?? "";
      const key = `${init?.method ?? "GET"} ${path}`;
      const bodies: Record<string, unknown> = {
        "GET agent/v1/node": { enrolled: true, name: "desk", devices: [] },
        "GET library/v1/models": { models, lastScanAt: null },
        "GET library/v1/scan": { state: "idle" },
        "GET library/v1/downloads": { downloads: [] },
        "GET agent/v1/engines": { engines: [] },
        "POST library/v1/eligibility": { models: [] },
        "GET agent/v1/runtimes": { runtimes: [] },
      };
      if (key === "GET control/v1/nodes") {
        return new Response(JSON.stringify({ detail: "no root" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      const body = bodies[key];
      return new Response(JSON.stringify(body ?? { detail: `?? ${key}` }), {
        status: body === undefined ? 418 : 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("the Library with nothing selected", () => {
  it("offers the three search models, each linking to Discover with its repo open", async () => {
    render(<LibraryPage />);
    const shelf = await screen.findByTestId("search-models-shelf");
    expect(within(shelf).getByRole("heading", { name: "Search models" })).toBeInTheDocument();
    expect(within(shelf).getAllByRole("listitem")).toHaveLength(3);
    expect(within(shelf).getByTestId("search-model-open-qwen3-embedding")).toHaveAttribute(
      "href",
      "/discover?repo=Qwen%2FQwen3-Embedding-0.6B-GGUF",
    );
  });

  it("says which search models are already in the Library", async () => {
    models = [
      {
        id: "e",
        name: "Qwen3-Embedding-0.6B-Q8_0",
        path: "/m/e.gguf",
        format: "gguf",
        status: "present",
        capabilities: { chat: false, embedding: true },
      },
      {
        id: "c",
        name: "gemma-3",
        path: "/m/c.gguf",
        format: "gguf",
        status: "present",
        capabilities: { chat: true },
      },
    ];
    render(<LibraryPage />);
    const held = await screen.findByTestId("search-models-held");
    expect(held).toHaveTextContent("Qwen3-Embedding-0.6B-Q8_0 (search model)");
    expect(held).not.toHaveTextContent("gemma-3");
  });

  it("is gone once a model is selected: the detail is that model's", async () => {
    models = [
      {
        id: "c",
        name: "gemma-3",
        path: "/m/c.gguf",
        format: "gguf",
        status: "present",
        capabilities: { chat: true },
      },
    ];
    query = "model=c";
    render(<LibraryPage />);
    await waitFor(() => expect(screen.getAllByText("gemma-3").length).toBeGreaterThan(0));
    expect(screen.queryByTestId("search-models-shelf")).toBeNull();
  });
});
