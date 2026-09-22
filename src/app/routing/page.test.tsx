/**
 * The Routing page, driven.
 *
 * The ops and the resolution join are pure and tested in
 * `modelSlots.test.ts`; what is left is the **wiring** (the S7 lesson: a
 * component test is not a wiring test): that the page reads the lists off
 * the gateway's CONFIG and only decorates them from the routing table —
 * a configured target the table has never heard of must still render —
 * that a reorder actually reaches the PATCH body, and that a rejected
 * save is shown rather than swallowed.
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
  AppShell: ({ children, controls }: { children: ReactNode; controls?: ReactNode }) => (
    <div data-testid="shell">
      {controls}
      {children}
    </div>
  ),
}));

type Handler = (body?: unknown) => { status: number; body?: unknown };
let handlers: Map<string, Handler>;
let patched: unknown[];

function install(): Map<string, Handler> {
  return new Map<string, Handler>([
    [
      "GET gateway/v1/config",
      () => ({
        status: 200,
        body: {
          modelSlots: [{ model: "coder", targets: ["qwen3-coder-30b", "claude", "missing-model"] }],
          defaultMaxTokens: 1024,
        },
      }),
    ],
    [
      "GET gateway/v1/admin/routing",
      () => ({
        status: 200,
        body: {
          refreshed_at: "2026-09-21T12:00:00Z",
          slots: [
            {
              model: "coder",
              configured: true,
              tiers: [
                { target: "coder", backends: [{ driver: "coder-driver", eligible: true }] },
                {
                  target: "qwen3-coder-30b",
                  backends: [{ driver: "qwen-driver", eligible: true, node: "nas" }],
                },
                { target: "claude", backends: [{ driver: "claude-cli", eligible: true }] },
                { target: "missing-model", backends: [] },
              ],
            },
            {
              model: "qwen3-coder-30b",
              configured: false,
              tiers: [
                {
                  target: "qwen3-coder-30b",
                  backends: [{ driver: "qwen-driver", eligible: true, node: "nas" }],
                },
              ],
            },
            {
              model: "gemma-3-27b",
              configured: false,
              tiers: [
                {
                  target: "gemma-3-27b",
                  backends: [
                    { driver: "gemma-driver", eligible: false, ineligible_reason: "stopped" },
                  ],
                },
              ],
            },
          ],
        },
      }),
    ],
    [
      "PATCH gateway/v1/config",
      () => ({
        status: 200,
        body: { applied: ["modelSlots"], rejected: [], requiresRestart: false },
      }),
    ],
  ]);
}

beforeEach(() => {
  handlers = install();
  patched = [];
  sessionStorage.clear();
  localStorage.clear();
  sessionStorage.setItem("eugene-session-token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const route = String(input).replace(/^\/api\/proxy\//, "");
      const key = `${init?.method ?? "GET"} ${route}`;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (key === "PATCH gateway/v1/config") patched.push(body);
      const handler = handlers.get(key);
      const result = handler
        ? handler(body)
        : { status: 418, body: { detail: `unhandled: ${key}` } };
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

async function renderPage() {
  render(<RoutingPage />);
  return await screen.findByTestId("routing-slot", {}, { timeout: 5000 });
}

describe("the lists come from config, decorated by the routing table", () => {
  it("owns its scroll, because the shell clips at the viewport", async () => {
    await renderPage();
    // Same defect the metrics page shipped with: the AppShell is h-dvh
    // with overflow hidden, so a page without its own overflow-y-auto
    // renders everything below the fold unreachable. jsdom applies no
    // CSS, so the class IS the assertion.
    expect(screen.getByTestId("routing-scroll").className).toContain("overflow-y-auto");
  });

  it("renders the configured list with its self tier and per-target resolution", async () => {
    const card = await renderPage();
    const self = within(card).getByTestId("self-tier");
    expect(self).toHaveTextContent("coder");
    expect(within(self).getByTestId("self-served")).toHaveTextContent("served by coder-driver");

    const rows = within(card).getAllByTestId("target-row");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByRole("combobox")).toHaveValue("qwen3-coder-30b");
    expect(within(rows[0]!).getByTestId("target-served")).toHaveTextContent(
      "served by qwen-driver @ nas",
    );
    // The page's whole point: a target nothing serves is flagged on its
    // own row, at edit time, instead of failing silently at request time.
    expect(within(rows[2]!).getByTestId("target-unserved")).toHaveTextContent(
      "nothing serves this right now",
    );
  });

  it("still renders a configured target the routing table has never heard of", async () => {
    // The config is the subject and the table is the overlay. A page that
    // read its lists off the table would drop this entry — the
    // wrong-subject defect, asserted against.
    handlers.set("GET gateway/v1/config", () => ({
      status: 200,
      body: { modelSlots: [{ model: "coder", targets: ["not-in-the-table"] }] },
    }));
    const card = await renderPage();
    const rows = within(card).getAllByTestId("target-row");
    expect(within(rows[0]!).getByRole("combobox")).toHaveValue("not-in-the-table");
    expect(within(rows[0]!).getByTestId("target-unserved")).toBeInTheDocument();
  });

  it("keeps editing when the routing table is missing, and says why", async () => {
    handlers.set("GET gateway/v1/admin/routing", () => ({
      status: 503,
      body: { detail: "safe mode" },
    }));
    const card = await renderPage();
    expect(screen.getByTestId("routing-soft-error")).toHaveTextContent("safe mode");
    // Unknown must not read as "nothing serves this".
    expect(within(card).queryByTestId("target-unserved")).toBeNull();
    expect(within(card).queryByTestId("target-served")).toBeNull();
  });
});

describe("reordering", () => {
  it("moves a target down and PATCHes the new order", async () => {
    const card = await renderPage();
    const user = userEvent.setup();
    await user.click(within(card).getByRole("button", { name: "Try qwen3-coder-30b later" }));
    const rows = within(card).getAllByTestId("target-row");
    expect(within(rows[0]!).getByRole("combobox")).toHaveValue("claude");
    expect(within(rows[1]!).getByRole("combobox")).toHaveValue("qwen3-coder-30b");

    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByTestId("save-applied");
    expect(patched).toEqual([
      { modelSlots: [{ model: "coder", targets: ["claude", "qwen3-coder-30b", "missing-model"] }] },
    ]);
  });

  it("disables the edge moves", async () => {
    const card = await renderPage();
    expect(
      within(card).getByRole("button", { name: "Try qwen3-coder-30b earlier" }),
    ).toBeDisabled();
    expect(within(card).getByRole("button", { name: "Try missing-model later" })).toBeDisabled();
  });
});

describe("saving", () => {
  it("blocks Save on what the gateway would reject, naming the list", async () => {
    const card = await renderPage();
    const user = userEvent.setup();
    // Remove every target: the server rejects a list with none, so Save
    // is blocked by the same rule with the row named.
    for (const name of ["qwen3-coder-30b", "claude", "missing-model"]) {
      await user.click(within(card).getByRole("button", { name: `Remove ${name}` }));
    }
    expect(screen.getByTestId("slot-problems")).toHaveTextContent('"coder" has no fallbacks');
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(patched).toEqual([]);
  });

  it("shows a rejected save rather than swallowing it", async () => {
    handlers.set("PATCH gateway/v1/config", () => ({
      status: 200,
      body: {
        applied: [],
        rejected: [{ key: "modelSlots", message: "entry 0: model 'coder' is listed twice" }],
        requiresRestart: false,
      },
    }));
    const card = await renderPage();
    const user = userEvent.setup();
    await user.click(within(card).getByRole("button", { name: "Try qwen3-coder-30b later" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByTestId("save-rejected")).toHaveTextContent("listed twice");
  });

  it("warns on a self-target without blocking", async () => {
    const card = await renderPage();
    const user = userEvent.setup();
    const add = within(card).getByLabelText("Add a fallback to coder");
    await user.type(add, "coder");
    await user.click(within(card).getByRole("button", { name: "Add fallback" }));
    expect(screen.getByTestId("slot-warnings")).toHaveTextContent("lists itself");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});

describe("adding a list", () => {
  it("offers the served models that have no list yet", async () => {
    await renderPage();
    const user = userEvent.setup();
    // gemma is served (by a stopped-but-declared runtime) and
    // unconfigured; coder is configured and absent from the offers.
    await user.click(screen.getByRole("button", { name: /gemma-3-27b/ }));
    const cards = screen.getAllByTestId("routing-slot");
    expect(cards).toHaveLength(2);
    expect(within(cards[1]!).getByLabelText("Model name this list answers for")).toHaveValue(
      "gemma-3-27b",
    );
    // A fresh list has no targets yet, which the gateway would refuse —
    // named, and Save blocked until one is added.
    expect(screen.getByTestId("slot-problems")).toHaveTextContent("no fallbacks");
    await user.type(within(cards[1]!).getByLabelText("Add a fallback to gemma-3-27b"), "coder");
    await user.click(within(cards[1]!).getByRole("button", { name: "Add fallback" }));
    await waitFor(() => expect(screen.queryByTestId("slot-problems")).toBeNull());
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("refuses a second list for a name that has one", async () => {
    await renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Model name for the new list"), "coder");
    expect(screen.getByRole("button", { name: "Add list" })).toBeDisabled();
    expect(screen.getByText(/already has a list/)).toBeInTheDocument();
  });
});

describe("the JSON fallback", () => {
  it("falls back to JSON when the stored value does not parse into lists", async () => {
    handlers.set("GET gateway/v1/config", () => ({
      status: 200,
      body: { modelSlots: [{ model: 42, targets: [] }] },
    }));
    render(<RoutingPage />);
    const error = await screen.findByTestId("slots-parse-error");
    expect(error).toHaveTextContent("model must be a string");
    // The raw value is in the editor, not an empty array that would hide
    // what needs fixing.
    const editor = screen.getByLabelText("Priority lists as JSON") as HTMLTextAreaElement;
    expect(editor.value).toContain("42");
    expect(screen.queryByTestId("routing-slot")).toBeNull();
  });

  it("applies a valid JSON edit to the draft", async () => {
    await renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByText("Edit as JSON"));
    const editor = screen.getByLabelText("Priority lists as JSON");
    await user.clear(editor);
    await user.click(editor);
    await user.paste('[{"model": "coder", "targets": ["claude"]}]');
    const card = screen.getByTestId("routing-slot");
    await waitFor(() => expect(within(card).getAllByTestId("target-row")).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});
