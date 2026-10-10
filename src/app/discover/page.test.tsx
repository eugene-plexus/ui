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

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DiscoverPage from "./page";

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/discover",
  useSearchParams: () => nav.params,
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
let seen: { path: string; params: URLSearchParams; body?: unknown }[];

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
interface ModelBodyOptions {
  projectors?: { path: string; sizeBytes: number; role: string }[];
  warnings?: string[];
  chatTemplate?: boolean;
  recommended?: { label: string; reason: string };
  candidates?: [];
  resolvedCommit?: string;
}

function modelBody(contextLength: number, options: ModelBodyOptions = {}) {
  const kv = Math.trunc(WEIGHTS * 0.15 * (contextLength / 8192));
  const required = WEIGHTS + kv + OVERHEAD;
  return {
    repo: REPO,
    name: "Qwen3.8 27B",
    owner: "unsloth",
    candidates: options.candidates ?? [
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
    projectors: options.projectors ?? [],
    otherFiles: [],
    warnings: options.warnings ?? [],
    ...(options.chatTemplate !== undefined ? { chatTemplate: options.chatTemplate } : {}),
    ...(options.recommended ? { recommended: options.recommended } : {}),
    ...(options.resolvedCommit ? { resolvedCommit: options.resolvedCommit } : {}),
  };
}

const PROJECTORS = [
  { path: "mmproj-F16.gguf", sizeBytes: 856_000_000, role: "projector" },
  { path: "mmproj-BF16.gguf", sizeBytes: 1_712_000_000, role: "projector" },
];

/** The library's own multimodal sentence, verbatim — the API prose the
 * vision box replaces on screen. */
const RAW_PROJECTOR_WARNING =
  "This is a multimodal model: 2 vision projectors are published separately, and one has " +
  "to be downloaded alongside the quant for the model to see images. They are listed " +
  "under `projectors`.";

/** A multimodal repo with a recommendation, the shape the ask names. */
function visionOptions(extra: ModelBodyOptions = {}): ModelBodyOptions {
  return {
    projectors: PROJECTORS,
    warnings: [RAW_PROJECTOR_WARNING],
    recommended: { label: "Q4_K_M", reason: "Largest that fits." },
    ...extra,
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

type Reply = { status: number; body?: unknown };
type Handler = (params: URLSearchParams, body?: unknown) => Reply | Promise<Reply>;
let handlers: Map<string, Handler>;

beforeEach(() => {
  seen = [];
  nav.params = new URLSearchParams();
  nav.replace = vi.fn();
  handlers = new Map<string, Handler>([
    ["GET agent/v1/node", () => ok({ enrolled: false, devices: [] })],
    ["GET control/v1/nodes", () => ({ status: 503, body: { detail: "no root" } })],
    ["GET library/v1/hardware", () => ok({ hostname: "dev", gpus: [], warnings: [] })],
    ["GET library/v1/downloads", () => ok({ downloads: [] })],
    ["GET library/v1/quants", () => ok({ quants: [] })],
    ["GET library/v1/catalogue/card", () => ({ status: 404, body: { detail: "none" } })],
    // Every source together (LS4).
    [
      "POST library/v1/catalogue/search",
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
      const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
      // A POST's own fields are its parameters too (LS4's search is a POST):
      // `lastQuery` reads them the same way whichever way they were sent.
      if (body && typeof body === "object" && !Array.isArray(body)) {
        for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
          if (typeof value === "string" || typeof value === "number")
            params.set(key, String(value));
        }
      }
      seen.push({ path, params, body });
      const handler = handlers.get(`${init?.method ?? "GET"} ${path}`);
      const result = handler
        ? await handler(params, body)
        : { status: 418, body: { detail: `?? ${path}` } };
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

function useModel(options: ModelBodyOptions) {
  handlers.set("GET library/v1/catalogue/model", (params) =>
    ok(modelBody(Number(params.get("contextLength")), options)),
  );
}

function lastDownloadBody(): { repo: string; files: string[] } {
  const hit = [...seen].reverse().find((r) => r.path === "library/v1/downloads" && r.body);
  if (!hit) throw new Error("no download was posted");
  return hit.body as { repo: string; files: string[] };
}

describe("vision pairing", () => {
  beforeEach(() => {
    handlers.set("POST library/v1/downloads", () => ok({}));
  });

  it("rides by default: the button names both sizes and the download carries the projector", async () => {
    useModel(visionOptions());
    await openTheRepo();

    // The fact is a control now, on and visible, and the raw API prose
    // ("listed under `projectors`") is not shown beside it.
    const checkbox = screen.getByTestId("vision-checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(screen.queryByText(/listed under/)).not.toBeInTheDocument();
    expect(screen.getByTestId("takes-images")).toBeInTheDocument();

    const button = screen.getByTestId("repo-recommended-download");
    expect(button.textContent).toContain("+ 856.00 MB vision");
    await act(async () => {
      fireEvent.click(button);
    });
    expect(lastDownloadBody().files).toEqual(["Qwen3.8-27B-Q4_K_M.gguf", "mmproj-F16.gguf"]);
  });

  it("unchecked, the download is the quant alone and the button says only its size", async () => {
    useModel(visionOptions());
    await openTheRepo();

    await act(async () => {
      fireEvent.click(screen.getByTestId("vision-checkbox"));
    });
    const button = screen.getByTestId("repo-recommended-download");
    expect(button.textContent).not.toContain("vision");
    await act(async () => {
      fireEvent.click(button);
    });
    expect(lastDownloadBody().files).toEqual(["Qwen3.8-27B-Q4_K_M.gguf"]);
  });

  it("a different projector precision can be picked and is the one fetched", async () => {
    useModel(visionOptions());
    await openTheRepo();

    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: /mmproj-BF16/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("repo-recommended-download"));
    });
    expect(lastDownloadBody().files).toEqual(["Qwen3.8-27B-Q4_K_M.gguf", "mmproj-BF16.gguf"]);
  });

  it("only the projector sentence is replaced; other warnings still render", async () => {
    useModel(visionOptions({ warnings: [RAW_PROJECTOR_WARNING, "This model is gated."] }));
    await openTheRepo();
    expect(screen.getByText("This model is gated.")).toBeInTheDocument();
    expect(screen.queryByText(/listed under/)).not.toBeInTheDocument();
  });

  it("a text-only repo shows neither the box nor the capability", async () => {
    await openTheRepo();
    expect(screen.queryByTestId("vision-pairing")).not.toBeInTheDocument();
    expect(screen.queryByTestId("takes-images")).not.toBeInTheDocument();
  });
});

describe("the recommended card", () => {
  it("knows its files are already downloading and does not offer a second fetch", async () => {
    useModel(visionOptions());
    handlers.set("GET library/v1/downloads", () =>
      ok({
        downloads: [
          {
            id: "d1",
            repo: REPO,
            state: "downloading",
            files: [{ path: "Qwen3.8-27B-Q4_K_M.gguf", destinationPath: "/models/q.gguf" }],
          },
        ],
      }),
    );
    await openTheRepo();
    const button = screen.getByTestId("repo-recommended-download") as HTMLButtonElement;
    expect(button.textContent).toBe("downloading");
    expect(button.disabled).toBe(true);
  });

  it("offers the exact-fit check, and the card's verdict follows the preflight", async () => {
    useModel(visionOptions());
    await openTheRepo();
    await act(async () => {
      fireEvent.click(screen.getByTestId("repo-recommended-check"));
    });
    await waitFor(() => expect(asked("library/v1/catalogue/model/preflight")).toBe(1));
    expect(screen.getByTestId("repo-recommended-check").textContent).toBe("exact fit checked");
  });
});

describe("honesty on the detail", () => {
  it("a repo with nothing launchable says so instead of an empty table", async () => {
    useModel({ candidates: [] });
    await openTheRepo();
    expect(screen.getByTestId("no-candidates")).toBeInTheDocument();
  });

  it("a missing chat template is warned about; present or unknown is not", async () => {
    useModel({ chatTemplate: false });
    await openTheRepo();
    expect(screen.getByTestId("no-chat-template")).toBeInTheDocument();
  });

  it("chatTemplate true renders no warning", async () => {
    useModel({ chatTemplate: true });
    await openTheRepo();
    expect(screen.queryByTestId("no-chat-template")).not.toBeInTheDocument();
  });

  it("the header names the pinned revision", async () => {
    useModel({ resolvedCommit: "abc1234def5678" });
    await openTheRepo();
    expect(screen.getByText(/pinned at abc1234/)).toBeInTheDocument();
  });
});

describe("two searches in flight", () => {
  it("shows the newer one's results even when the older one answers last", async () => {
    render(<DiscoverPage />);
    await screen.findByRole("button", { name: /Qwen3\.8 27B/ }, { timeout: 5000 });

    let releaseOld!: () => void;
    const oldHeld = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    handlers.set("POST library/v1/catalogue/search", async (params) => {
      if (params.get("sort") === "likes") {
        await oldHeld;
        return ok({ results: [{ repo: "old/Stale-GGUF", name: "Stale answer", owner: "old" }] });
      }
      return ok({ results: [{ repo: "new/Fresh-GGUF", name: "Fresh answer", owner: "new" }] });
    });
    const sort = screen.getByLabelText("Sort order");
    await act(async () => {
      fireEvent.change(sort, { target: { value: "likes" } });
    });
    await act(async () => {
      fireEvent.change(sort, { target: { value: "trending" } });
    });
    await screen.findByRole("button", { name: /Fresh answer/ });
    await act(async () => {
      releaseOld();
      await oldHeld;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: /Stale answer/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Fresh answer/ })).toBeInTheDocument();
  });
});

describe("the results list", () => {
  it("rows carry recency and format, so 'recently updated' has dates on it", async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
    handlers.set("POST library/v1/catalogue/search", () =>
      ok({
        results: [
          {
            repo: REPO,
            name: "Qwen3.8 27B",
            owner: "unsloth",
            lastModified: tenDaysAgo,
            formats: ["gguf"],
          },
        ],
      }),
    );
    render(<DiscoverPage />);
    await screen.findByTestId("result-age", {}, { timeout: 5000 });
    expect(screen.getByTestId("result-age").textContent).toBe("updated 10 days ago");
    expect(screen.getByText("gguf")).toBeInTheDocument();
  });
});

describe("which engines can run it (LS2)", () => {
  /** This node: llama.cpp installed; vLLM installable; Strata installed. */
  const ENGINES = [
    { engine: "llama_cpp", available: true, modelFormats: ["gguf"], accepts: [{ format: "gguf" }] },
    {
      engine: "vllm",
      available: false,
      modelFormats: ["safetensors"],
      accepts: [{ format: "safetensors", authority: "engine" }],
      acquisition: { policy: "manual", installable: false, manualInstall: { command: "pip" } },
    },
    {
      engine: "strata",
      available: true,
      experimental: true,
      modelFormats: [],
      accepts: [{ format: "gguf", architectures: ["qwen4exp"], preparation: { recipe: "s" } }],
    },
  ];
  const fact = (repo: string, format: string) => ({
    id: `search:${repo}:${format}`,
    format,
    approximate: true,
  });
  const ROWS = [
    { repo: "org/red", name: "Red", owner: "org", facts: [fact("org/red", "safetensors")] },
    { repo: "org/amber", name: "Amber", owner: "org", facts: [fact("org/amber", "gguf")] },
    { repo: "org/green", name: "Green", owner: "org", facts: [fact("org/green", "gguf")] },
  ];
  const verdict = (engine: string, v: string, reason: string, available = true) => ({
    engine,
    verdict: v,
    reason,
    available,
    installable: !available,
  });
  /** The Library's answers, by candidate id: what the judge would say. */
  const ANSWERS: Record<string, unknown> = {
    "search:org/green:gguf": {
      level: "works_here",
      approximate: true,
      engines: [verdict("llama_cpp", "runs", "runs it as it is")],
    },
    "search:org/amber:gguf": {
      level: "other_engine",
      approximate: true,
      engines: [
        verdict("strata", "after_preparation", "runs it after preparing it"),
        verdict(
          "llama_cpp",
          "no",
          "loads 156 named architectures, and qwen4exp is not one of them",
        ),
      ],
    },
    "search:org/red:safetensors": {
      level: "not_here",
      approximate: true,
      engines: [verdict("llama_cpp", "no", "loads gguf models, and this one is safetensors")],
    },
    "catalogue:x:Q4_K_M": {
      level: "other_engine",
      approximate: false,
      engines: [
        verdict("vllm", "may_run", "vLLM checks the architecture when it loads", false),
        verdict("llama_cpp", "no", "loads gguf models, and this one is safetensors"),
      ],
    },
  };
  let judged: { candidates?: { id: string }[]; engines?: unknown[] }[];

  beforeEach(() => {
    judged = [];
    handlers.set("GET agent/v1/engines", () => ok({ engines: ENGINES }));
    handlers.set("POST library/v1/catalogue/search", () => ok({ results: ROWS }));
    handlers.set("POST library/v1/eligibility", (_params, body) => {
      const asked = body as { candidates?: { id: string }[]; engines?: unknown[] };
      judged.push(asked);
      return ok({
        models: (asked.candidates ?? [])
          .filter((c) => ANSWERS[c.id])
          .map((c) => ({ modelId: c.id, ...(ANSWERS[c.id] as object) })),
      });
    });
  });

  const rowText = () => screen.getAllByTestId("result-row").map((row) => row.textContent ?? "");

  it("opens on Works here now, since llama.cpp here runs a hub's models as they are", async () => {
    // Troy, 2026-10-09: with an engine that runs something as it is, the
    // red safetensors of *most downloaded* are not where Discover opens.
    render(<DiscoverPage />);
    await screen.findAllByTestId("eligibility-dot", {}, { timeout: 5000 });
    expect(screen.getByLabelText(/Which models/)).toHaveValue("works_here");
    await waitFor(() => expect(rowText()).toEqual([expect.stringContaining("Green")]));
    expect(lastQuery("library/v1/catalogue/search").get("format")).toBe("gguf");
    // Not remembered as a choice: the person never made one.
    expect(localStorage.getItem("eugene-discover-prefs") ?? "").not.toContain("chosenLevel");
  });

  it("with Strata the only engine installed, opens on Everything", async () => {
    // Strata runs nothing from a hub as it is: opening on Works here now
    // would open on an empty list.
    handlers.set("GET agent/v1/engines", () =>
      ok({
        engines: ENGINES.map((e) => (e.engine === "llama_cpp" ? { ...e, available: false } : e)),
      }),
    );
    render(<DiscoverPage />);
    await screen.findAllByTestId("eligibility-dot", {}, { timeout: 5000 });
    expect(screen.getByLabelText(/Which models/)).toHaveValue("");
  });

  it("a filter the person chose is remembered; the old stored default is not", async () => {
    localStorage.setItem("eugene-discover-prefs", JSON.stringify({ level: "" }));
    render(<DiscoverPage />);
    await screen.findAllByTestId("eligibility-dot", {}, { timeout: 5000 });
    expect(screen.getByLabelText(/Which models/)).toHaveValue("works_here");
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Which models/), { target: { value: "" } });
    });
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("eugene-discover-prefs")!).chosenLevel).toBe(""),
    );
  });

  it("lists everything when asked, green then amber then red, each row with its dot", async () => {
    localStorage.setItem("eugene-discover-prefs", JSON.stringify({ chosenLevel: "" }));
    render(<DiscoverPage />);
    await screen.findAllByTestId("eligibility-dot", {}, { timeout: 5000 });
    expect(screen.getByLabelText(/Which models/)).toHaveValue("");
    await waitFor(() =>
      expect(rowText()).toEqual([
        expect.stringContaining("Green"),
        expect.stringContaining("Amber"),
        expect.stringContaining("Red"),
      ]),
    );
    const dots = screen.getAllByTestId("eligibility-dot").map((d) => d.textContent);
    expect(dots).toEqual(["works here(approx.)", "other engine(approx.)", "not here(approx.)"]);
    // The Library judged the rows' own facts, against this node's engines.
    const asked = judged.at(-1)!;
    expect(asked.candidates!.map((c) => c.id)).toEqual(ROWS.map((r) => r.facts[0]!.id));
    expect(asked.engines).toHaveLength(3);
    // The hub is asked for every format when nothing is filtered.
    expect(lastQuery("library/v1/catalogue/search").get("format")).toBeNull();
  });

  it("Works here now hides the rest, asks the hub for what runs here, and says what it hid", async () => {
    render(<DiscoverPage />);
    await screen.findAllByTestId("eligibility-dot", {}, { timeout: 5000 });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Which models/), { target: { value: "works_here" } });
    });
    await waitFor(() => expect(screen.getAllByTestId("result-row")).toHaveLength(1));
    expect(screen.getByTestId("result-row")).toHaveTextContent("Green");
    // llama.cpp is the only engine here running anything as it is: GGUF.
    expect(lastQuery("library/v1/catalogue/search").get("format")).toBe("gguf");
    const hidden = screen.getByTestId("filter-hidden");
    expect(hidden).toHaveTextContent("2 more matches hidden by “Works here now”.");
    await act(async () => {
      within(hidden).getByRole("button", { name: "Show everything" }).click();
    });
    await waitFor(() => expect(screen.getAllByTestId("result-row")).toHaveLength(3));
  });

  it("Works with another engine keeps only the amber rows", async () => {
    localStorage.setItem("eugene-discover-prefs", JSON.stringify({ chosenLevel: "" }));
    render(<DiscoverPage />);
    await screen.findAllByTestId("eligibility-dot", {}, { timeout: 5000 });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Which models/), {
        target: { value: "other_engine" },
      });
    });
    await waitFor(() => expect(screen.getAllByTestId("result-row")).toHaveLength(1));
    expect(screen.getByTestId("result-row")).toHaveTextContent("Amber");
  });

  it("a filter that leaves nothing names itself and undoes in one click", async () => {
    handlers.set("POST library/v1/catalogue/search", () => ok({ results: [ROWS[0]] }));
    render(<DiscoverPage />);
    // Works here now is where it opens, here.
    const empty = await screen.findByTestId("no-results", {}, { timeout: 5000 });
    expect(empty).toHaveTextContent("None of 1 matches works on this host now.");
    await act(async () => {
      within(empty).getByRole("button", { name: "Show everything" }).click();
    });
    expect(screen.getByLabelText(/Which models/)).toHaveValue("");
  });

  it("each version carries its dot, and the popover names every engine's reason", async () => {
    handlers.set("GET library/v1/catalogue/model", (params) => {
      const body = modelBody(Number(params.get("contextLength")));
      body.candidates[0] = {
        ...body.candidates[0]!,
        facts: { id: "catalogue:x:Q4_K_M", format: "safetensors", mlxQuantized: false },
      } as never;
      return ok(body);
    });
    render(<DiscoverPage />);
    const row = await screen.findByRole("button", { name: /^Green/ }, { timeout: 5000 });
    await act(async () => {
      fireEvent.click(row);
    });
    const level = await screen.findByTestId("candidate-level", {}, { timeout: 5000 });
    const dot = within(level).getByRole("button");
    expect(dot).toHaveTextContent("other engine");
    expect(dot).not.toHaveTextContent("approx");
    await act(async () => {
      fireEvent.click(dot);
    });
    const panel = within(level).getByRole("dialog");
    expect(panel).toHaveTextContent("Will work with a different engine");
    expect(within(panel).getByTestId("eligibility-verdicts")).toHaveTextContent(
      "vLLM: vLLM checks the architecture when it loads; not installed on this host yet",
    );
    expect(panel).toHaveTextContent("llama.cpp: loads gguf models, and this one is safetensors");
    // The version's facts went to the judge, not to a rule of this page's.
    expect(judged.some((j) => j.candidates?.some((c) => c.id === "catalogue:x:Q4_K_M"))).toBe(true);
  });

  // Troy, 2026-10-09: a ComfyUI repo's VAE was "Suggested", "fits" and
  // "Can not work on this machine" at once.
  it("never suggests, or quotes a fit for, a version nothing here can run", async () => {
    handlers.set("GET library/v1/catalogue/model", (params) => {
      const body = modelBody(Number(params.get("contextLength")), {
        recommended: { label: "Q4_K_M", reason: "the largest that fits" } as never,
      });
      body.candidates[0] = {
        ...body.candidates[0]!,
        facts: { id: "search:org/red:safetensors", format: "safetensors" },
      } as never;
      return ok(body);
    });
    // Everything, chosen: under Works here now (where it opens, here) the red
    // row is hidden once judged, and a click would race the verdicts.
    localStorage.setItem("eugene-discover-prefs", JSON.stringify({ chosenLevel: "" }));
    render(<DiscoverPage />);
    await screen.findAllByTestId("eligibility-dot", {}, { timeout: 5000 });
    const row = await screen.findByRole("button", { name: /^Red/ }, { timeout: 5000 });
    await act(async () => {
      fireEvent.click(row);
    });
    expect(await screen.findByTestId("repo-nothing-runs", {}, { timeout: 5000 })).toHaveTextContent(
      "Can not work on this host.",
    );
    expect(screen.queryByTestId("repo-recommended")).toBeNull();
    expect(screen.queryByText("recommended")).toBeNull();
    expect(screen.getByTestId("candidate-fit-none")).toBeInTheDocument();
    expect(screen.queryByTestId("fit-badge")).toBeNull();
  });

  // LS6, Troy's L11: each engine owns its fit, and a version's column shows
  // the fit of the engine its dot is about, named; the catalogue's own
  // arithmetic (llama.cpp's) never stands in for another engine's.
  it("a version's fit is its engine's own, and the judge is asked at this context", async () => {
    ANSWERS["catalogue:x:flash"] = {
      level: "other_engine",
      approximate: false,
      engines: [
        {
          ...verdict("llama_cpp", "runs", "runs it as it is"),
          fit: {
            estimated: true,
            verdict: "no",
            model: "spill",
            reason: "too large here: about 70 GiB at 8,192 tokens",
          },
        },
        {
          ...verdict("strata", "after_preparation", "runs it after preparing it"),
          fit: {
            estimated: true,
            verdict: "fits",
            model: "engine_table",
            reason: "Strata keeps its 35.5 GB of experts in RAM",
          },
        },
      ],
    };
    handlers.set("GET library/v1/catalogue/model", (params) => {
      const body = modelBody(Number(params.get("contextLength")));
      body.candidates[0] = {
        ...body.candidates[0]!,
        facts: { id: "catalogue:x:flash", format: "gguf", sizeBytes: 68_000_000_000 },
      } as never;
      return ok(body);
    });
    render(<DiscoverPage />);
    const row = await screen.findByRole("button", { name: /^Green/ }, { timeout: 5000 });
    await act(async () => {
      fireEvent.click(row);
    });
    const badge = await screen.findByTestId("engine-fit-badge", {}, { timeout: 5000 });
    expect(badge).toHaveTextContent("Strata: fits");
    expect(badge).toHaveAttribute("title", "Strata keeps its 35.5 GB of experts in RAM");
    // llama.cpp's arithmetic is not quoted for a version Strata is the answer for.
    expect(screen.queryByTestId("fit-badge")).toBeNull();
    const asked = judged.find((j) => j.candidates?.some((c) => c.id === "catalogue:x:flash")) as
      | { fit?: { contextLength?: number } }
      | undefined;
    expect(asked?.fit?.contextLength).toBe(8192);
    // The popover names each engine's own fit.
    const level = screen.getByTestId("candidate-level");
    await act(async () => {
      fireEvent.click(within(level).getByRole("button"));
    });
    const fits = within(level)
      .getAllByTestId("eligibility-fit")
      .map((f) => f.textContent);
    expect(fits).toEqual([
      "fit, llama.cpp: does not fit: too large here: about 70 GiB at 8,192 tokens",
      "fit, Strata: fits: Strata keeps its 35.5 GB of experts in RAM",
    ]);
  });

  it("a refused engine check shows no dots and says why every model is listed", async () => {
    handlers.set("POST library/v1/eligibility", () => ({
      status: 422,
      body: { detail: "The engine check refused this question." },
    }));
    render(<DiscoverPage />);
    const note = await screen.findByTestId("filter-note", {}, { timeout: 5000 });
    expect(note).toHaveTextContent("Could not ask the Library which of these run on");
    expect(note).toHaveTextContent("The engine check refused this question.");
    expect(screen.queryByTestId("eligibility-dot")).toBeNull();
    expect(screen.getAllByTestId("result-row")).toHaveLength(3);
  });
});

describe("sources are a list (LS4)", () => {
  const LISTED = {
    id: "IQ2_XS",
    title: "Qwen3.8 27B for Strata",
    about: "the size Strata recommends",
    publisher: "unsloth",
    format: "gguf",
    architecture: "qwen4exp",
    quantization: "Q4_K_M",
    source: { repoId: REPO, file: "Qwen3.8-27B-Q4_K_M.gguf", revision: "abc1234def" },
    sizeBytes: 68_000_000_000,
    preparation: { recipe: "strata-prepare", note: "an expert pack and an MTP helper" },
    recommended: true,
  };
  const ENGINES = [
    {
      engine: "llama_cpp",
      available: false,
      modelFormats: ["gguf"],
      accepts: [{ format: "gguf" }],
    },
    {
      engine: "strata",
      available: true,
      experimental: true,
      modelFormats: ["prepared"],
      accepts: [{ format: "gguf", preparation: { recipe: "strata-prepare" } }],
      supportedModels: [LISTED],
    },
  ];
  const ROWS = [
    {
      repo: REPO,
      name: LISTED.title,
      owner: "unsloth",
      source: "engines",
      hubSource: "huggingface",
      engine: "strata",
      supported: LISTED,
      formats: ["gguf"],
    },
    {
      repo: "org/Small",
      name: "Small",
      owner: "org",
      source: "huggingface",
      hubSource: "huggingface",
    },
    { repo: "corp/Inside", name: "Inside", owner: "corp", source: "corp", hubSource: "corp" },
  ];
  const SOURCES = [
    { id: "huggingface", kind: "hf_hub", label: "Hugging Face", searched: true, results: 1 },
    { id: "corp", kind: "hf_hub", label: "Corp hub", searched: true, results: 1 },
    { id: "engines", kind: "engine_list", label: "Engines' own lists", searched: true, results: 1 },
    {
      id: "mirror",
      kind: "hf_hub",
      label: "Mirror",
      searched: true,
      results: 0,
      problem: "Could not reach https://mirror.example to search (no route to host).",
    },
  ];

  beforeEach(() => {
    handlers.set("GET agent/v1/engines", () => ok({ engines: ENGINES }));
    handlers.set("POST library/v1/catalogue/search", () =>
      ok({ results: ROWS, sources: SOURCES, interpretedAs: "search" }),
    );
    handlers.set("POST library/v1/downloads", () => ({ status: 202, body: { id: "d1" } }));
  });

  it("asks every source together, sending the node's engines' own lists", async () => {
    render(<DiscoverPage />);
    await waitFor(() => expect(screen.getAllByTestId("result-row")).toHaveLength(3), {
      timeout: 5000,
    });
    const sent = [...seen].reverse().find((r) => r.path === "library/v1/catalogue/search")!;
    expect(sent.body).toMatchObject({ engines: [{ engine: "strata", models: [LISTED] }] });
    expect(asked("library/v1/catalogue/search")).toBe(1);
  });

  it("every row says where it came from, and a source that failed says why", async () => {
    render(<DiscoverPage />);
    await waitFor(() => expect(screen.getAllByTestId("result-row")).toHaveLength(3), {
      timeout: 5000,
    });
    const from = screen.getAllByTestId("result-source").map((s) => s.textContent);
    expect(from).toEqual(["Strata’s list · unsloth", " · Hugging Face", " · Corp hub"]);
    expect(screen.getAllByTestId("result-row")[0]).toHaveTextContent("68.00 GB to download");
    expect(screen.getByTestId("source-problem")).toHaveTextContent(
      "Mirror: Could not reach https://mirror.example",
    );
  });

  it("an engine's entry opens its repo at the revision it pins, on its list", async () => {
    render(<DiscoverPage />);
    const row = await screen.findByRole(
      "button",
      { name: /Qwen3\.8 27B for Strata/ },
      { timeout: 5000 },
    );
    await act(async () => {
      fireEvent.click(row);
    });
    await screen.findByTestId("all-versions", {}, { timeout: 5000 });
    const detail = lastQuery("library/v1/catalogue/model");
    expect(detail.get("revision")).toBe("abc1234def");
    expect(detail.get("source")).toBe("huggingface");
    expect(screen.getByTestId("listed-entry")).toHaveTextContent(
      "On Strata’s own list: Qwen3.8 27B for Strata · recommended",
    );
    expect(screen.getByTestId("candidate-listed")).toHaveTextContent("on Strata’s list");
    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith(expect.stringContaining("listed=strata%3AIQ2_XS"), {
        scroll: false,
      }),
    );
  });

  it("an engine's entry is downloaded and prepared in one action (LS5)", async () => {
    render(<DiscoverPage />);
    const row = await screen.findByRole(
      "button",
      { name: /Qwen3\.8 27B for Strata/ },
      { timeout: 5000 },
    );
    await act(async () => {
      fireEvent.click(row);
    });
    const prepare = await screen.findByTestId("prepare-model", {}, { timeout: 5000 });
    expect(prepare).toHaveTextContent("Download and prepare for Strata");
    expect(prepare).toHaveTextContent("an expert pack and an MTP helper");
    await act(async () => {
      fireEvent.click(within(prepare).getByTestId("prepare-start"));
    });
    await waitFor(() =>
      expect(seen.some((r) => r.path.startsWith("library/v1/run-operations/dl_"))).toBe(true),
    );
    const put = seen.find((r) => r.path.startsWith("library/v1/run-operations/dl_"))!;
    expect(put.body).toMatchObject({
      download: {
        repo: REPO,
        files: ["Qwen3.8-27B-Q4_K_M.gguf"],
        revision: "abc1234def",
        source: "huggingface",
      },
      preparation: { engine: "strata" },
    });
    // Never a plain download beside it: the run operation downloads.
    expect(seen.filter((r) => r.path === "library/v1/downloads" && r.body)).toHaveLength(0);
  });

  it("a repo from another hub is opened, and fetched, from that hub", async () => {
    render(<DiscoverPage />);
    const row = await screen.findByRole("button", { name: /Inside/ }, { timeout: 5000 });
    await act(async () => {
      fireEvent.click(row);
    });
    await screen.findByTestId("all-versions", {}, { timeout: 5000 });
    expect(lastQuery("library/v1/catalogue/model").get("source")).toBe("corp");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "download" }));
    });
    await waitFor(() => expect(asked("library/v1/downloads")).toBeGreaterThan(0));
    const posted = [...seen].reverse().find((r) => r.path === "library/v1/downloads" && r.body)!;
    expect(posted.body).toMatchObject({ repo: "corp/Inside", source: "corp" });
  });
});

describe("a search the library refused", () => {
  it("shows the library's plain-string sentence, not the status line", async () => {
    // FastAPI's `HTTPException(detail="...")` puts a bare string in
    // `detail`, and this page's own helper read only the nested shape.
    handlers.set("POST library/v1/catalogue/search", () => ({
      status: 409,
      body: { detail: "Catalogue search is turned off in the Library's settings." },
    }));
    render(<DiscoverPage />);
    const sentence = await screen.findByText(
      "Catalogue search is turned off in the Library's settings.",
      {},
      { timeout: 5000 },
    );
    expect(sentence).toHaveAttribute("role", "alert");
    expect(screen.queryByText(/HTTP 409/)).toBeNull();
  });
});

describe("selection and preferences survive", () => {
  it("?repo= opens the detail without a click, and selection is mirrored to the URL", async () => {
    nav.params = new URLSearchParams(`repo=${REPO}`);
    render(<DiscoverPage />);
    await screen.findByTestId("all-versions", {}, { timeout: 5000 });
    expect(asked("library/v1/catalogue/model")).toBeGreaterThan(0);
  });

  it("marks the open repo for a screen reader, not only with a tint", async () => {
    await openTheRepo();
    expect(screen.getByRole("button", { name: /Qwen3\.8 27B/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("clicking a repo writes ?repo= into the URL", async () => {
    await openTheRepo();
    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith(`/discover?repo=${encodeURIComponent(REPO)}`, {
        scroll: false,
      }),
    );
  });

  it("mirroring the selection preserves the tree's ?sel=, never clobbers it", async () => {
    // The tree's selection rides in ?sel= on every page. A repo click
    // that rewrote the query from scratch would silently deselect the
    // tree — invisible in the test above, whose query starts empty.
    window.history.replaceState(null, "", "/discover?sel=agent%3Anode-a");
    try {
      await openTheRepo();
      await waitFor(() => {
        const urls = nav.replace.mock.calls.map((c) => String(c[0]));
        const withRepo = urls.find((u) => u.includes("repo="));
        expect(withRepo).toBeDefined();
        expect(withRepo).toContain("sel=agent%3Anode-a");
      });
    } finally {
      window.history.replaceState(null, "", "/discover");
    }
  });

  it("the scoring context and sort come back from the browser's own store", async () => {
    localStorage.setItem(
      "eugene-discover-prefs",
      JSON.stringify({ contextLength: 32768, sort: "modified", format: "" }),
    );
    await openTheRepo();
    await waitFor(() =>
      expect(lastQuery("library/v1/catalogue/model").get("contextLength")).toBe("32768"),
    );
    expect(lastQuery("library/v1/catalogue/search").get("sort")).toBe("modified");
    expect(lastQuery("library/v1/catalogue/search").get("format")).toBeNull();
  });
});

describe("the starter set's Download", () => {
  const STARTER_FILE = "Qwen3.8-27B-UD-Q4_K_M.gguf";
  beforeEach(() => {
    handlers.set("GET library/v1/catalogue/starter", () =>
      ok({
        reviewed: "2026-09-16",
        reviewedDaysAgo: 0,
        source: "shipped",
        models: [
          {
            sizeClass: "30B",
            baseModel: "Qwen/Qwen3.8-27B",
            repo: REPO,
            file: STARTER_FILE,
            label: "UD-Q4_K_M",
            sizeBytes: WEIGHTS,
            why: "most downloaded in its class",
          },
        ],
        recommended: { sizeClass: "30B", reason: "The largest that runs in GPU memory here." },
      }),
    );
  });

  it("is not offered again while that file is downloading", async () => {
    handlers.set("GET library/v1/downloads", () =>
      ok({
        downloads: [
          {
            id: "d1",
            repo: REPO,
            state: "downloading",
            files: [{ path: STARTER_FILE, destinationPath: "", state: "downloading" }],
            bytesTotal: WEIGHTS,
            bytesDownloaded: 1,
          },
        ],
      }),
    );
    render(<DiscoverPage />);
    // It forgot, the moment its request returned, that it had started one.
    await waitFor(() => expect(screen.getByTestId("starter-download")).toBeDisabled(), {
      timeout: 5000,
    });
    expect(screen.getByTestId("starter-download")).toHaveTextContent("Downloading…");
  });

  it("says a refusal on its own card, not in the search results", async () => {
    handlers.set("POST library/v1/downloads", () => ({
      status: 409,
      body: { detail: { title: "Busy", detail: "Another download is already writing that file." } },
    }));
    render(<DiscoverPage />);
    const button = await screen.findByTestId("starter-download", {}, { timeout: 5000 });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(await screen.findByTestId("starter-error")).toHaveTextContent(
      "Another download is already writing that file.",
    );
  });
});

describe("the machine line", () => {
  it("says the node's card once, rounded one way", async () => {
    // The picker said "30 GiB free" and a second line beside it said
    // "29.6 GiB free of 31.8 GiB": one card, two readings, two roundings.
    handlers.set("GET agent/v1/node", () =>
      ok({
        enrolled: false,
        devices: [
          {
            kind: "cuda",
            name: "NVIDIA GeForce RTX 5090",
            index: 0,
            memoryTotalBytes: 34190917632,
            memoryFreeBytes: 31_800_000_000,
          },
        ],
      }),
    );
    render(<DiscoverPage />);
    const shell = await screen.findByTestId("shell");
    await waitFor(() => expect(shell.textContent ?? "").toMatch(/GiB free/), { timeout: 5000 });
    const text = shell.textContent ?? "";
    expect(text.match(/GiB free/g)).toHaveLength(1);
    expect(text).toContain("NVIDIA GeForce RTX 5090 · 29.6 GiB free of 31.8 GiB");
  });
});
