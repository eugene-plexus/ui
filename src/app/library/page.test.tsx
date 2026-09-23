/**
 * The Library's model detail, driven, against a model that is running.
 *
 * Reported from the live install on 2026-09-17: one downloaded model,
 * running on `Amish_Station`, and the page showed **"Needs partial CPU
 * offload"**, **"Will not fit on Amish_Station"** and a full-size
 * **Run** button, with nothing anywhere saying it was up.
 *
 * Both halves were one blind spot — the page joined the library (what is
 * on disk) with the node's engines (what could load it) and never asked
 * that node what it had *loaded*. So these are wiring tests: `runningModel`
 * is pure and covered beside itself, and every case there would stay
 * green with the read removed from this page entirely.
 *
 * The fixture is the live install's shape: a Windows worker with a 5090
 * holding a 27B, whose free VRAM is low **because the model is
 * resident** — which is what made the arithmetic contradict the
 * observation.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LibraryPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/library",
  useSearchParams: () => new URLSearchParams("model=gemma"),
}));

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, controls }: { children: ReactNode; controls?: ReactNode }) => (
    <div data-testid="shell">
      {controls}
      {children}
    </div>
  ),
}));

const MODEL_PATH = "Y:\\models\\gemma-3-27b-it-Q6_K_L.gguf";
const GIB = 1024 ** 3;

function libraryModel() {
  return {
    id: "gemma",
    path: MODEL_PATH,
    format: "gguf",
    name: "gemma-3-27b-it-Q6_K_L",
    status: "present",
    sizeBytes: 23_800_000_000,
    profileCount: 1,
    gguf: { quantization: "Q6_K_L" },
  };
}

/**
 * The fit as the library computes it with the model already loaded:
 * 22.2 GiB of weights against 5.6 GiB free, because the other 26 are
 * this model. `split` — "needs partial CPU offload" — is the honest
 * answer to the question the library was asked, and the wrong answer to
 * the one the operator is asking.
 */
function fitBody() {
  return {
    fit: {
      verdict: "split",
      requiredBytes: 24 * GIB,
      weightsBytes: 22.2 * GIB,
      kvCacheBytes: 0.8 * GIB,
      overheadBytes: GIB,
      contextLength: 8192,
      basis: "metadata",
      budget: {
        vramFreeBytes: 5.6 * GIB,
        vramTotalBytes: 31.8 * GIB,
        largestGpuFreeBytes: 5.6 * GIB,
        ramAvailableBytes: 58 * GIB,
        ramTotalBytes: 93 * GIB,
        gpuCount: 1,
        source: "detected",
      },
      notes: [],
    },
    maxContextLength: 4096,
    modelContextLength: 131072,
  };
}

function runtime(over: Record<string, unknown> = {}) {
  return {
    name: "gemma-a",
    engine: "llama_cpp",
    modelPath: MODEL_PATH,
    modelAlias: "gemma-3-27b",
    status: "ready",
    driver: "gemma-a-driver",
    ...over,
  };
}

type Result = { status: number; body?: unknown };
type Handler = () => Result;
let handlers: Map<string, Handler>;
let posted: string[];
/** Every GET, with its query string, in the order it was sent. */
let gets: string[];
/** Routes whose answer never arrives, for "still asking" states. */
let hanging: Set<string>;

function ok(body: unknown): Result {
  return { status: 200, body };
}

function install(): Map<string, Handler> {
  return new Map<string, Handler>([
    ["GET agent/v1/node", () => ok({ enrolled: true, name: "Amish_Station", devices: [] })],
    ["GET control/v1/nodes", () => ({ status: 503, body: { detail: "no root" } })],
    ["GET library/v1/models", () => ok({ models: [libraryModel()], lastScanAt: null })],
    ["GET library/v1/scan", () => ok({ state: "idle" })],
    ["GET library/v1/downloads", () => ok({ downloads: [] })],
    ["GET library/v1/models/gemma/fit", () => ok(fitBody())],
    [
      "GET agent/v1/engines",
      () => ok({ engines: [{ engine: "llama_cpp", available: true, modelFormats: ["gguf"] }] }),
    ],
    ["GET agent/v1/runtimes", () => ok({ runtimes: [runtime()] })],
    ["POST agent/v1/runtimes/gemma-a/stop", () => ok({})],
    // The profile editor below the actions.
    ["GET library/v1/models/gemma/profiles", () => ok({ profiles: [] })],
    ["POST agent/v1/runtimes/admission", () => ok({ decision: "admit", fit: "fits" })],
  ]);
}

beforeEach(() => {
  handlers = install();
  posted = [];
  gets = [];
  hanging = new Set();
  sessionStorage.clear();
  localStorage.clear();
  sessionStorage.setItem("eugene-session-token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const route = String(input).replace(/^[/]api[/]proxy[/]/, "");
      const path = route.split("?")[0] ?? "";
      const method = init?.method ?? "GET";
      if (method !== "GET") posted.push(`${method} ${path}`);
      else gets.push(route);
      if (hanging.has(`${method} ${path}`)) return new Promise<Response>(() => {});
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

async function openTheModel() {
  render(<LibraryPage />);
  // `?model=gemma` selects it, so the detail is what we wait for.
  await screen.findByTestId("model-fit", {}, { timeout: 5000 });
}

describe("a model that is running on the picked node", () => {
  it("says so, instead of offering to start it", async () => {
    await openTheModel();
    const panel = await screen.findByTestId("model-running");
    expect(panel).toHaveTextContent("Running on Amish_Station now");
    expect(panel).toHaveTextContent("gemma-a");
    // The defect, exactly: a full-size Run as the primary action.
    expect(within(screen.getByTestId("model-run")).queryByText("Run")).toBeNull();
  });

  it("does not tell the operator it will not fit on the machine that is running it", async () => {
    await openTheModel();
    const fit = screen.getByTestId("model-fit");
    expect(fit).toHaveAttribute("data-resident", "true");
    // The three headlines that were a contradiction of the observation.
    expect(fit).not.toHaveTextContent("Needs partial CPU offload");
    expect(fit).not.toHaveTextContent("Too large for this node");
    expect(fit).toHaveTextContent("Running on Amish_Station now — it fits");
  });

  it("keeps the arithmetic, and says which question it answers", async () => {
    await openTheModel();
    const fit = screen.getByTestId("model-fit");
    // Not hidden: a 5.6 GiB reading is true, and an expert wants it. It
    // is labelled as being about a SECOND copy, which is what it is once
    // the first is inside the memory it is scored against.
    expect(fit).toHaveTextContent("second");
    expect(fit).toHaveTextContent("A second copy would need");
  });

  it("offers Stop, and stops the runtime the node actually named", async () => {
    await openTheModel();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    });
    await waitFor(() => expect(posted).toContain("POST agent/v1/runtimes/gemma-a/stop"));
  });

  it("keeps a second copy reachable, and out of the primary slot", async () => {
    await openTheModel();
    // `easy-default-expert-override`: the exception is still possible.
    // The disclosure, not the button inside it -- both carry the words.
    const summary = screen.getByText("Run another copy", { selector: "summary" });
    expect(summary.closest("details")?.hasAttribute("open")).toBe(false);
    expect(within(screen.getByTestId("model-running")).getByTestId("run-button")).toBeTruthy();
  });

  it("marks it in the list, so it is visible without clicking", async () => {
    await openTheModel();
    expect(await screen.findByTestId("model-list-running")).toHaveTextContent("running");
  });
});

describe("a model that is not running", () => {
  beforeEach(() => {
    handlers.set("GET agent/v1/runtimes", () => ok({ runtimes: [] }));
  });

  it("offers Run and the plain fit verdict, exactly as before", async () => {
    await openTheModel();
    expect(screen.queryByTestId("model-running")).toBeNull();
    expect(screen.getByTestId("model-fit")).toHaveAttribute("data-resident", "false");
    expect(screen.getByTestId("model-fit")).toHaveTextContent("Needs partial CPU offload");
    expect(await screen.findByTestId("run-button")).toHaveTextContent("Run");
  });

  it("says nothing at all when the node did not answer", async () => {
    // "Did not answer" is not "nothing is running". Collapsing them
    // would put a Run button under a claim this page cannot make — the
    // same distinction the Inference screen draws about devices.
    handlers.set("GET agent/v1/runtimes", () => ({ status: 502, body: null }));
    await openTheModel();
    expect(screen.queryByTestId("model-running")).toBeNull();
    expect(screen.queryByTestId("model-list-running")).toBeNull();
  });
});

/**
 * The pre-release polish pass, driven through the page rather than a
 * helper: every one of these is wiring — which link a sentence carries,
 * which sentence an error shows, whether a click acts or asks.
 */
function listed(name: string, path: string, over: Record<string, unknown> = {}) {
  return { id: name, path, format: "gguf", name, status: "present", ...over };
}

/** Seven models, so the filter box is offered, and one whose only match
 * for "archive" is its path. */
function manyModels() {
  return [
    libraryModel(),
    listed("Qwen3-8B-Q4_K_M", "Y:\\models\\Qwen3-8B-Q4_K_M.gguf"),
    listed("qwen3-coder-30b-Q5_K_M", "Y:\\models\\qwen3-coder-30b-Q5_K_M.gguf"),
    listed("llama-3.1-8b-instruct", "Y:\\models\\llama-3.1-8b-instruct.gguf"),
    listed("mistral-7b-v0.3", "Y:\\models\\mistral-7b-v0.3.gguf"),
    listed("phi-4-Q8_0", "Y:\\models\\phi-4-Q8_0.gguf"),
    listed("big-model", "D:\\archive\\special\\big-model.gguf"),
  ];
}

/** The list's own buttons, by the model name each carries. */
function listedNames(): string[] {
  const list = screen.getByTestId("model-list");
  return within(list)
    .queryAllByRole("button")
    .map((b) => b.querySelector("span")?.textContent ?? "")
    .filter((n) => n !== "");
}

describe("an empty library", () => {
  it("links the sentence that says where folders go to the page that holds them", async () => {
    handlers.set("GET library/v1/models", () => ok({ models: [], lastScanAt: null }));
    render(<LibraryPage />);
    // A bare "the Config page" opened an empty Config screen: no `?sel=`
    // means nothing selected. Library folders are where a folder is added.
    const link = await screen.findByRole("link", { name: "Library folders" });
    expect(link).toHaveAttribute("href", "/library/folders?sel=library");
  });
});

describe("a failure the library explained", () => {
  it("shows the library's own sentence, not the status line", async () => {
    handlers.set("GET library/v1/models", () => ({
      status: 500,
      body: {
        detail: {
          title: "Library index unreadable",
          detail: "The model index could not be read. Scan again to rebuild it.",
          status: 500,
        },
      },
    }));
    render(<LibraryPage />);
    const sentence = await screen.findByText(
      "The model index could not be read. Scan again to rebuild it.",
    );
    expect(sentence).toHaveAttribute("role", "alert");
    expect(screen.queryByText(/HTTP 500/)).toBeNull();
  });

  it("reads a plain-string detail too, which the page's own helper missed", async () => {
    handlers.set("POST library/v1/scan", () => ({
      status: 409,
      body: { detail: "A scan is already running." },
    }));
    await openTheModel();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "scan" }));
    });
    const sentence = await screen.findByText("A scan is already running.");
    expect(sentence).toHaveAttribute("role", "alert");
    expect(screen.queryByText(/HTTP 409/)).toBeNull();
  });
});

describe("forgetting a model whose file has gone", () => {
  beforeEach(() => {
    handlers.set("GET library/v1/models", () =>
      ok({ models: [{ ...libraryModel(), status: "missing" }] }),
    );
    handlers.set("DELETE library/v1/models/gemma", () => ({ status: 204 }));
  });

  it("asks first, and one click drops nothing", async () => {
    render(<LibraryPage />);
    const button = await screen.findByRole(
      "button",
      { name: "forget this entry and its profiles" },
      { timeout: 5000 },
    );
    await act(async () => {
      fireEvent.click(button);
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(posted).not.toContain("DELETE library/v1/models/gemma");
    // What is lost, said before it is lost: the profiles are the one
    // thing here a rescan cannot bring back.
    expect(screen.getByRole("group", { name: "Confirm" })).toHaveTextContent("1 saved profile");
  });

  it("forgets on the second click", async () => {
    render(<LibraryPage />);
    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: "forget this entry and its profiles" },
        { timeout: 5000 },
      ),
    );
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("group", { name: "Confirm" })).getByRole("button", {
          name: "forget this entry and its profiles",
        }),
      );
    });
    await waitFor(() => expect(posted).toContain("DELETE library/v1/models/gemma"));
  });
});

describe("the model list", () => {
  beforeEach(() => {
    handlers.set("GET library/v1/models", () => ok({ models: manyModels(), lastScanAt: null }));
  });

  it("filters by name or path, case-insensitively, and says how many it shows", async () => {
    await openTheModel();
    const filter = screen.getByLabelText("Filter models");
    fireEvent.change(filter, { target: { value: "QWEN" } });
    expect(listedNames()).toEqual(["Qwen3-8B-Q4_K_M", "qwen3-coder-30b-Q5_K_M"]);
    expect(screen.getByTestId("model-filter-count")).toHaveTextContent("2 of 7");

    // The path is searched too: the folder is often how someone remembers
    // where a model came from.
    fireEvent.change(filter, { target: { value: "archive" } });
    expect(listedNames()).toEqual(["big-model"]);
  });

  it("says nothing matched, and clearing brings every model back", async () => {
    await openTheModel();
    const filter = screen.getByLabelText("Filter models");
    fireEvent.change(filter, { target: { value: "no-such-model" } });
    expect(screen.getByTestId("model-list")).toHaveTextContent("No models match");
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(listedNames()).toHaveLength(7);
    // Back in the box, so the next thing typed filters again.
    expect(filter).toHaveFocus();
  });

  it("is not offered for a handful of models", async () => {
    handlers.set("GET library/v1/models", () => ok({ models: [libraryModel()] }));
    await openTheModel();
    expect(screen.queryByLabelText("Filter models")).toBeNull();
  });

  it("marks the selected model for a screen reader, not by colour alone", async () => {
    await openTheModel();
    // The name is also the detail pane's heading; the list's copy is the
    // one inside a button.
    const selected = screen
      .getAllByText("gemma-3-27b-it-Q6_K_L")
      .map((el) => el.closest("button"))
      .find((b) => b !== null);
    expect(selected).toHaveAttribute("aria-current", "true");
    const other = screen.getByText("phi-4-Q8_0").closest("button");
    expect(other).not.toHaveAttribute("aria-current");
  });
});

describe("the model detail", () => {
  it("offers to copy the model's path", async () => {
    await openTheModel();
    expect(screen.getByRole("button", { name: "Copy path" })).toBeInTheDocument();
  });
});

describe("a runtime that exists but is stopped", () => {
  beforeEach(() => {
    handlers.set("GET agent/v1/runtimes", () =>
      ok({ runtimes: [runtime({ status: "stopped", stopReason: "idle" })] }),
    );
  });

  it("offers to start it again and says why it stopped", async () => {
    // Settings already chosen, and an idle unload is the system working
    // rather than a fault — a different sentence from a model nobody has
    // ever launched.
    await openTheModel();
    expect(screen.queryByTestId("model-running")).toBeNull();
    expect(await screen.findByTestId("run-button")).toHaveTextContent("Start again");
    expect(screen.getByTestId("model-run")).toHaveTextContent("the gateway unloaded it");
    // Stopped frees the memory, so the prediction is about this model
    // again and is shown plainly.
    expect(screen.getByTestId("model-fit")).toHaveAttribute("data-resident", "false");
  });
});

describe("the fit panel and the header's node picker", () => {
  beforeEach(() => {
    handlers.set("GET agent/v1/runtimes", () => ok({ runtimes: [] }));
    handlers.set("GET control/v1/nodes", () =>
      ok({
        nodes: [
          { name: "Amish_Station", reachable: true },
          {
            name: "gpu-b",
            reachable: true,
            devices: [{ kind: "cuda", name: "RTX 3090", memoryFreeBytes: 20 * GIB }],
          },
        ],
      }),
    );
    handlers.set("GET node:gpu-b/v1/engines", () =>
      ok({ engines: [{ engine: "llama_cpp", available: true, modelFormats: ["gguf"] }] }),
    );
    handlers.set("GET node:gpu-b/v1/runtimes", () => ok({ runtimes: [] }));
  });

  it("scores the node the picker moves to, without another model being selected", async () => {
    await openTheModel();
    fireEvent.change(screen.getByLabelText("Node to score against and launch on"), {
      target: { value: "gpu-b" },
    });
    // A second copy of the picker inside the panel kept scoring the first
    // node until a different model was opened.
    await waitFor(() =>
      expect(gets.filter((g) => g.startsWith("library/v1/models/gemma/fit")).at(-1)).toContain(
        `vramBytes=${20 * GIB}`,
      ),
    );
  });

  it("never asks for a fit before the picker has chosen a node", async () => {
    // A node that reports its card, so its budget is not null. A fit sent
    // before the picker answered carries no budget, and the library scores
    // it against its own host -- which can land after the right answer.
    handlers.set("GET agent/v1/node", () =>
      ok({
        enrolled: true,
        name: "Amish_Station",
        devices: [{ kind: "cuda", name: "RTX 5090", memoryFreeBytes: 5.6 * GIB }],
      }),
    );
    await openTheModel();
    const fits = gets.filter((g) => g.startsWith("library/v1/models/gemma/fit"));
    expect(fits.length).toBeGreaterThan(0);
    for (const request of fits) expect(request).toContain("vramBytes=");
  });
});

describe("before the picked node has said which engines it has", () => {
  beforeEach(() => {
    handlers.set("GET agent/v1/runtimes", () => ok({ runtimes: [] }));
  });

  it("says it is asking, and does not call the model unloadable", async () => {
    hanging.add("GET agent/v1/engines");
    await openTheModel();
    expect(screen.getByTestId("engines-unknown")).toHaveTextContent(
      "Checking which engines Amish_Station has",
    );
    expect(screen.queryByText(/No engine here can load/)).toBeNull();
    expect(screen.queryByText("no engine")).toBeNull();
  });

  it("says the question failed, rather than that there is no engine", async () => {
    handlers.set("GET agent/v1/engines", () => ({
      status: 502,
      body: { detail: "Amish_Station did not answer." },
    }));
    await openTheModel();
    const line = await screen.findByRole("alert");
    expect(line).toHaveTextContent("Could not ask Amish_Station which engines it has");
    expect(line).toHaveTextContent("Amish_Station did not answer.");
    expect(screen.queryByText(/No engine here can load/)).toBeNull();
    expect(screen.queryByText("no engine")).toBeNull();
  });
});

describe("sizes", () => {
  it("are decimal, the unit the download and the hub quoted", async () => {
    await openTheModel();
    // 23,800,000,000 bytes read "22.2 GB" here and "23.80 GB" on Discover.
    expect(screen.queryByText(/22\.2 GB/)).toBeNull();
    expect(screen.getAllByText("24 GB").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByTitle("23,800,000,000 bytes").length).toBeGreaterThanOrEqual(2);
  });
});
