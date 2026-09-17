/**
 * Discovery's context control, driven.
 *
 * The defect this exists to stop coming back, reported from the live
 * install: changing "Scored for 8k of conversation" moved the label, the
 * column header and the number written into every badge — and moved no
 * verdict. Two independent causes, one symptom:
 *
 *  1. the library's estimated KV term was a flat fraction of the
 *     weights, and a catalogue fit is `basis: estimate` for almost every
 *     repo because the hub reports no layer or attention counts
 *     (`fit.py`, covered by `test_fit.py` on that side);
 *  2. a preflighted row's verdict — which *wins* over the repo-level one
 *     — was cached in this page and never invalidated, so the one row
 *     with real arithmetic behind it was the one most likely to be
 *     answering a question nobody was asking any more.
 *
 * So these are wiring tests, deliberately: that the number the control
 * names is the number every verdict on screen was computed at. A test of
 * `FitBadge` would have been green throughout.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DiscoverPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/discover",
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

const REPO = "unsloth/Qwen3.8-27B-GGUF";
const WEIGHTS = 16_500_000_000;
const OVERHEAD = 1024 ** 3;
/** One 5090 with the desktop on it: what fits is a real question here. */
const FREE_VRAM = 31_000_000_000;

/** Every request this page made, in order, split into path and query. */
let seen: { path: string; params: URLSearchParams }[];

function lastQuery(path: string): URLSearchParams {
  const hit = [...seen].reverse().find((r) => r.path === path);
  if (!hit) throw new Error(`nothing asked for ${path}; saw ${seen.map((r) => r.path).join(", ")}`);
  return hit.params;
}

function asked(path: string): number {
  return seen.filter((r) => r.path === path).length;
}

/**
 * The library's answer, computed the way the library computes it.
 *
 * A fixture returning a fixed body would have agreed with the broken
 * code, because the broken code's whole defect was that the body never
 * changed. So the estimate is reproduced here: 15% of the weights per
 * 8,192 tokens, which is `fit.py`'s fallback and the branch nearly every
 * catalogue verdict takes.
 */
function modelBody(contextLength: number) {
  const kv = Math.trunc(WEIGHTS * 0.15 * (contextLength / 8192));
  const required = WEIGHTS + kv + OVERHEAD;
  return {
    repo: REPO,
    name: "Qwen3.8 27B",
    owner: "unsloth",
    candidates: [
      {
        label: "Q4_K_M",
        format: "gguf",
        files: [{ path: "Qwen3.8-27B-Q4_K_M.gguf", sizeBytes: WEIGHTS, role: "weights" }],
        sizeBytes: WEIGHTS,
        fit: {
          verdict: required <= FREE_VRAM ? "fits" : "no",
          requiredBytes: required,
          weightsBytes: WEIGHTS,
          kvCacheBytes: kv,
          overheadBytes: OVERHEAD,
          contextLength,
          basis: "estimate",
          notes: [],
        },
      },
    ],
    projectors: [],
    otherFiles: [],
    warnings: [],
  };
}

/** The same file read for real: 16 attention layers, not 65. */
function preflightBody(contextLength: number) {
  const kv = contextLength * 16 * 4 * 512 * 2;
  const required = WEIGHTS + kv + OVERHEAD;
  return {
    repo: REPO,
    file: "Qwen3.8-27B-Q4_K_M.gguf",
    format: "gguf",
    bytesRead: 11_000_000,
    quantization: "Q4_K_M",
    blockCount: 65,
    attentionLayers: 16,
    contextLength: 262144,
    fit: {
      verdict: required <= FREE_VRAM ? "fits" : "no",
      requiredBytes: required,
      weightsBytes: WEIGHTS,
      kvCacheBytes: kv,
      overheadBytes: OVERHEAD,
      contextLength,
      basis: "metadata",
      attentionLayers: 16,
      notes: [],
    },
  };
}

function ok(body: unknown) {
  return { status: 200, body };
}

type Handler = (params: URLSearchParams) => { status: number; body?: unknown };
let handlers: Map<string, Handler>;

beforeEach(() => {
  seen = [];
  handlers = new Map<string, Handler>([
    ["GET agent/v1/node", () => ok({ enrolled: false, devices: [] })],
    ["GET control/v1/nodes", () => ({ status: 503, body: { detail: "no root" } })],
    ["GET library/v1/hardware", () => ok({ hostname: "dev", gpus: [], warnings: [] })],
    ["GET library/v1/downloads", () => ok({ downloads: [] })],
    ["GET library/v1/quants", () => ok({ quants: [] })],
    ["GET library/v1/catalogue/card", () => ({ status: 404, body: { detail: "none" } })],
    [
      "GET library/v1/catalogue/search",
      () => ok({ results: [{ repo: REPO, name: "Qwen3.8 27B", owner: "unsloth" }] }),
    ],
    [
      "GET library/v1/catalogue/model",
      (params) => ok(modelBody(Number(params.get("contextLength")))),
    ],
    [
      "GET library/v1/catalogue/model/preflight",
      (params) => ok(preflightBody(Number(params.get("contextLength")))),
    ],
  ]);

  sessionStorage.clear();
  localStorage.clear();
  sessionStorage.setItem("eugene-session-token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const route = String(input).replace(/^[/]api[/]proxy[/]/, "");
      const [path = "", query = ""] = route.split("?");
      const params = new URLSearchParams(query);
      seen.push({ path, params });
      const handler = handlers.get(`${init?.method ?? "GET"} ${path}`);
      const result = handler ? handler(params) : { status: 418, body: { detail: `?? ${path}` } };
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

/** Render, pick the one repo, and wait for its candidate table. */
async function openTheRepo() {
  render(<DiscoverPage />);
  const row = await screen.findByRole("button", { name: /Qwen3\.8 27B/ }, { timeout: 5000 });
  await act(async () => {
    fireEvent.click(row);
  });
  await screen.findByTestId("all-versions", {}, { timeout: 5000 });
}

function setContext(tokens: number) {
  const control = screen.getByLabelText("Context length to score against");
  return act(async () => {
    fireEvent.change(control, { target: { value: String(tokens) } });
  });
}

/** The row's verdict, whichever source it came from. */
async function verdict() {
  const badges = await screen.findAllByTestId("fit-badge", {}, { timeout: 5000 });
  return badges[badges.length - 1];
}

describe("the context control", () => {
  it("re-asks the library, and the verdict follows it", async () => {
    await openTheRepo();
    expect(lastQuery("library/v1/catalogue/model").get("contextLength")).toBe("8192");
    expect(await verdict()).toHaveTextContent("fits");

    await setContext(262144);

    await waitFor(() =>
      expect(lastQuery("library/v1/catalogue/model").get("contextLength")).toBe("262144"),
    );
    // The point of the screen: 16.5 GB of weights sit inside a 31 GB
    // card at 8k of context and do not at 262,144.
    await waitFor(async () => expect(await verdict()).toHaveTextContent("too large"));
  });

  it("does not leave a preflighted verdict standing at a context it was not scored at", async () => {
    await openTheRepo();
    await act(async () => {
      // "check" is the per-row preflight; it reads "checked" once taken.
      fireEvent.click(screen.getByRole("button", { name: "check" }));
    });
    await waitFor(() =>
      expect(lastQuery("library/v1/catalogue/model/preflight").get("contextLength")).toBe("8192"),
    );
    // Real arithmetic, and it wins over the row's estimate: this file
    // fits at 8k with metadata behind the claim.
    await waitFor(async () => expect(await verdict()).toHaveTextContent("fits"));

    await setContext(262144);

    // A preflight response carries no shape to re-score from, so a cached
    // one is a verdict about a question nobody is asking any more — and
    // it is the one that wins. Whatever replaces it, what is on screen
    // must be scored at the number the header names.
    await waitFor(async () => expect(await verdict()).toHaveTextContent("too large"));
    // And the row says the check is available again rather than claiming
    // a check that no longer describes anything on screen.
    expect(screen.getByRole("button", { name: "check" })).toBeTruthy();
  });

  it("does not re-spend the preflight's bandwidth on its own", async () => {
    await openTheRepo();
    await act(async () => {
      // "check" is the per-row preflight; it reads "checked" once taken.
      fireEvent.click(screen.getByRole("button", { name: "check" }));
    });
    await waitFor(() => expect(asked("library/v1/catalogue/model/preflight")).toBe(1));

    await setContext(32768);
    await waitFor(() =>
      expect(lastQuery("library/v1/catalogue/model").get("contextLength")).toBe("32768"),
    );

    // Preflight reads ~11 MB of someone else's file per call and is
    // explicit by design. Dropping the stale answer is this page's
    // business; spending the bandwidth again is the operator's.
    expect(asked("library/v1/catalogue/model/preflight")).toBe(1);
  });
});
