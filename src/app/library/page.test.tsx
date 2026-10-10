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
      // A dense model, read since A3b: no expert tensors, so a split moves
      // whole layers.
      expertBytes: 0,
      offload: "layers",
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
/** The JSON body of each non-GET request, by `METHOD path`. */
let bodies: Map<string, unknown>;
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
  bodies = new Map();
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
      if (method !== "GET") {
        posted.push(`${method} ${path}`);
        if (typeof init?.body === "string") bodies.set(`${method} ${path}`, JSON.parse(init.body));
      } else gets.push(route);
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

  it("says how much of a dense model spills, in whole layers", async () => {
    // A stray experts number on a dense model must not be offered: it is
    // a number for a way of running this model does not have.
    handlers.set("GET library/v1/models/gemma/fit", () =>
      ok({ ...fitBody(), maxContextExpertsInRam: 99999 }),
    );
    await openTheModel();
    expect(screen.getByTestId("model-fit")).not.toHaveTextContent("99,999");
    // 24 GiB needed against 5.6 free: the rest runs from system memory.
    expect(screen.getByTestId("model-fit-placement")).toHaveTextContent(
      "About 18.4 GiB does not fit on the card, so some whole layers run from system memory.",
    );
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
 * A3c: a mixture-of-experts model on a card smaller than its file.
 *
 * The library says `split`, the word a dense spill gets, and since A3b it
 * says which kind: `offload: experts`. The headline used to read "Needs
 * partial CPU offload" about a model that keeps every layer on the card,
 * with no context offered at all, because the whole file never fits.
 */
describe("a mixture-of-experts model with its experts in system memory", () => {
  function moeFit(over: Record<string, unknown> = {}) {
    const body = fitBody();
    return {
      ...body,
      fit: {
        ...body.fit,
        requiredBytes: 23 * GIB,
        weightsBytes: 20.6 * GIB,
        kvCacheBytes: 1.4 * GIB,
        overheadBytes: GIB,
        contextLength: 16384,
        expertBytes: 18.3 * GIB,
        offload: "experts",
        budget: { ...body.fit.budget, vramFreeBytes: 7.5 * GIB, vramTotalBytes: 8 * GIB },
        ...over,
      },
      maxContextLength: null,
      maxContextExpertsInRam: 61440,
    };
  }

  beforeEach(() => {
    handlers.set("GET agent/v1/runtimes", () => ok({ runtimes: [] }));
  });

  it("says the experts sit in system memory, not that it spills", async () => {
    handlers.set("GET library/v1/models/gemma/fit", () => ok(moeFit()));
    await openTheModel();
    const fit = screen.getByTestId("model-fit");
    expect(fit).toHaveTextContent("Runs with its experts in system memory");
    expect(fit).not.toHaveTextContent("partial");
  });

  it("says what sits where, and the context that way of running allows", async () => {
    handlers.set("GET library/v1/models/gemma/fit", () => ok(moeFit()));
    await openTheModel();
    expect(screen.getByTestId("model-fit-placement")).toHaveTextContent(
      "The card holds everything except the experts: 4.70 GiB with the cache. Up to 18.3 GiB of experts go to system memory. That way it fits up to 61,440 tokens.",
    );
  });

  it("does not guess which kind of split a file read without its tensor table is", async () => {
    // A scan from before 2026-09-30: the library could not say, so the
    // page says neither the dense wording nor the experts wording.
    handlers.set("GET library/v1/models/gemma/fit", () =>
      ok(moeFit({ expertBytes: null, offload: null })),
    );
    await openTheModel();
    const fit = screen.getByTestId("model-fit");
    expect(fit).toHaveTextContent("Needs system memory as well");
    expect(fit).not.toHaveTextContent("partial");
    expect(fit).not.toHaveTextContent("experts");
    expect(screen.queryByTestId("model-fit-placement")).toBeNull();
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
    render(<LibraryPage />);
    expect(await screen.findByTestId("engines-unknown", {}, { timeout: 5000 })).toHaveTextContent(
      "Checking which engines Amish_Station has",
    );
    // Whose fit it would be is not known yet either (LS6): no fit is claimed.
    expect(screen.queryByTestId("model-fit")).toBeNull();
    expect(screen.queryByText(/No engine here can load/)).toBeNull();
    expect(screen.queryByText("no engine")).toBeNull();
  });

  it("says the question failed, rather than that there is no engine", async () => {
    handlers.set("GET agent/v1/engines", () => ({
      status: 502,
      body: { detail: "Amish_Station did not answer." },
    }));
    render(<LibraryPage />);
    const line = await screen.findByRole("alert", {}, { timeout: 5000 });
    expect(screen.queryByTestId("model-fit")).toBeNull();
    expect(line).toHaveTextContent("Could not ask Amish_Station which engines it has");
    expect(line).toHaveTextContent("Amish_Station did not answer.");
    expect(screen.queryByText(/No engine here can load/)).toBeNull();
    expect(screen.queryByText("no engine")).toBeNull();
  });
});

describe("which engines can run it: the Library judges (LS1)", () => {
  beforeEach(() => {
    handlers.set("GET agent/v1/runtimes", () => ok({ runtimes: [] }));
    handlers.set("GET agent/v1/engines", () =>
      ok({
        engines: [
          {
            engine: "llama_cpp",
            available: true,
            modelFormats: ["gguf"],
            accepts: [{ format: "gguf", preference: 10 }],
          },
          { engine: "strata", available: true, modelFormats: [], experimental: true, accepts: [] },
        ],
      }),
    );
  });

  it("asks with the node's engines and shows the dot and each engine's reason", async () => {
    // Troy, 2026-10-09: Strata installed on Amish_Station, and a GGUF
    // model's profile offered llama.cpp alone with nothing saying why.
    let asked: unknown = null;
    handlers.set("POST library/v1/eligibility", () => {
      asked = true;
      return ok({
        models: [
          {
            modelId: "gemma",
            level: "works_here",
            engines: [
              { engine: "llama_cpp", verdict: "runs", available: true, reason: "runs it as it is" },
              {
                engine: "strata",
                verdict: "no",
                available: true,
                experimental: true,
                reason: "loads only the qwen4exp architecture, and this one is gemma3",
              },
            ],
          },
        ],
      });
    });
    await openTheModel();
    const panel = await screen.findByTestId("model-eligibility");
    expect(asked).toBe(true);
    expect(panel).toHaveTextContent("Will work on this machine now");
    expect(panel).toHaveTextContent("llama.cpp: runs it as it is");
    expect(panel).toHaveTextContent(
      "Strata (experimental): loads only the qwen4exp architecture, and this one is gemma3",
    );
    expect(screen.getByTestId("model-list-level")).toHaveTextContent("works here");
  });

  it("offers Run only when the Library says an engine here can run it", async () => {
    // A GGUF the format alone would hand to llama.cpp: the judge decides.
    handlers.set("POST library/v1/eligibility", () =>
      ok({
        models: [
          {
            modelId: "gemma",
            level: "not_here",
            engines: [
              {
                engine: "llama_cpp",
                verdict: "no",
                available: true,
                reason: "loads only the llama architecture, and this one is gemma3",
              },
            ],
          },
        ],
      }),
    );
    await openTheModel();
    expect(await screen.findByTestId("model-eligibility")).toHaveTextContent(
      "Can not work on this machine",
    );
    expect(screen.queryByTestId("model-run")).toBeNull();
  });

  // 404: older than the judge; 422: older than LS3's `prepared`, which this
  // node's Strata declares.
  it.each([404, 422])("falls back to the format alone on an older library (%i)", async (status) => {
    handlers.set("POST library/v1/eligibility", () => ({ status, body: {} }));
    const folder = {
      id: "st",
      path: "Y:\\models\\st",
      format: "safetensors",
      name: "st",
      status: "present",
    };
    handlers.set("GET library/v1/models", () => ok({ models: [libraryModel(), folder] }));
    await openTheModel();
    expect(screen.queryByTestId("model-eligibility")).toBeNull();
    // llama.cpp still loads the GGUF by its format: Run is offered.
    expect(await screen.findByTestId("model-run")).toBeInTheDocument();
    // And the format rule marks what no engine here loads, as before LS1.
    const row = screen.getByRole("button", { name: /^st/ });
    await waitFor(() => expect(row).toHaveTextContent("no engine"));
  });
});

describe("preparing a GGUF for an engine that runs it only after (LS5)", () => {
  // Strata's own list names this file (by its first shard's name), with what
  // its setup needs on this node and the contexts it offers.
  const LISTED = {
    id: "IQ2_XS",
    title: "Qwen3.8-Flash-Next IQ2_XS",
    format: "gguf",
    source: { repoId: "ISTA-DASLab/x", file: "IQ2_XS/gemma-3-27b-it-Q6_K_L.gguf", revision: "r" },
    preparation: {
      recipe: "strata-prepare",
      note: "an expert pack, a lookup table and an MTP helper",
      diskBytes: 8_000_000_000,
      contexts: [8192, 32768],
    },
  };
  function judged(llama: "runs" | "no") {
    return ok({
      models: [
        {
          modelId: "gemma",
          level: llama === "runs" ? "works_here" : "other_engine",
          engines: [
            { engine: "llama_cpp", verdict: llama, available: true, reason: "llama.cpp says" },
            {
              engine: "strata",
              verdict: "after_preparation",
              available: true,
              experimental: true,
              reason: "runs it after preparing it",
            },
          ],
        },
      ],
    });
  }
  beforeEach(() => {
    handlers.set("GET agent/v1/runtimes", () => ok({ runtimes: [] }));
    handlers.set("GET agent/v1/engines", () =>
      ok({
        engines: [
          { engine: "llama_cpp", available: true, modelFormats: ["gguf"], accepts: [] },
          {
            engine: "strata",
            available: true,
            experimental: true,
            modelFormats: ["prepared"],
            accepts: [],
            supportedModels: [LISTED],
          },
        ],
      }),
    );
  });

  it("offers Prepare beside Run, with the node's disk and the engine's contexts", async () => {
    handlers.set("POST library/v1/eligibility", () => judged("runs"));
    await openTheModel();
    expect(await screen.findByTestId("model-run")).toBeInTheDocument();
    const prepare = await screen.findByTestId("prepare-model");
    expect(prepare).toHaveTextContent("Prepare for Strata");
    expect(prepare).toHaveTextContent("an expert pack, a lookup table and an MTP helper");
    expect(within(prepare).getByTestId("prepare-disk")).toHaveTextContent("8");
    const context = within(prepare).getByTestId("prepare-context");
    expect(
      within(context)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Strata's recommendation for Amish_Station", "8K tokens", "32K tokens"]);
    fireEvent.change(context, { target: { value: "32768" } });
    fireEvent.click(within(prepare).getByTestId("prepare-start"));
    await waitFor(() =>
      expect(posted.some((p) => p.startsWith("PUT library/v1/run-operations/prep_"))).toBe(true),
    );
    const put = posted.find((p) => p.startsWith("PUT library/v1/run-operations/prep_"))!;
    expect(bodies.get(put)).toEqual({
      node: "Amish_Station",
      modelId: "gemma",
      preparation: { engine: "strata", contextSize: 32768 },
    });
    // Run was not pressed and is not what the preparation started.
    expect(posted.filter((p) => p.startsWith("PUT library/v1/run-operations/"))).toHaveLength(1);
  });

  it("offers Prepare alone when nothing here runs it as it is", async () => {
    handlers.set("POST library/v1/eligibility", () => judged("no"));
    await openTheModel();
    expect(await screen.findByTestId("prepare-model")).toBeInTheDocument();
    expect(screen.queryByTestId("model-run")).toBeNull();
  });

  it("is not offered for a file the engine does not prepare", async () => {
    handlers.set("POST library/v1/eligibility", () =>
      ok({
        models: [
          {
            modelId: "gemma",
            level: "works_here",
            engines: [
              { engine: "llama_cpp", verdict: "runs", available: true, reason: "runs it" },
              { engine: "strata", verdict: "no", available: true, reason: "not on its list" },
            ],
          },
        ],
      }),
    );
    await openTheModel();
    await screen.findByTestId("model-run");
    expect(screen.queryByTestId("prepare-model")).toBeNull();
  });
});

describe("prepared models are Library models (LS3)", () => {
  const PREPARED = {
    id: "qwen",
    path: "D:\\Models\\qwen-flash.eugene-prepared.json",
    format: "prepared",
    name: "qwen-flash",
    status: "present",
    fileCount: 1,
    prepared: {
      engine: "strata",
      entry: "E:\\Strata\\strata-qwen.json",
      entryPath: "E:\\Strata\\strata-qwen.json",
      entryFound: false,
    },
  };
  let listed: unknown[];

  beforeEach(() => {
    listed = [libraryModel(), PREPARED];
    handlers.set("GET library/v1/models", () => ok({ models: listed, lastScanAt: null }));
    handlers.set("GET agent/v1/runtimes", () => ok({ runtimes: [] }));
    handlers.set("GET library/v1/models/qwen/profiles", () => ok({ profiles: [] }));
    handlers.set("GET library/v1/folders", () => ok({ folders: [{ path: "D:\\Models" }] }));
    handlers.set("GET agent/v1/engines", () =>
      ok({
        engines: [
          {
            engine: "llama_cpp",
            available: true,
            modelFormats: ["gguf"],
            accepts: [{ format: "gguf" }],
          },
          {
            engine: "strata",
            available: true,
            experimental: true,
            modelFormats: ["prepared"],
            accepts: [
              { format: "prepared", preparedFor: "strata" },
              { format: "gguf", preparation: { recipe: "strata-prepare" } },
            ],
          },
        ],
      }),
    );
    handlers.set("POST library/v1/eligibility", () =>
      ok({
        models: [
          {
            modelId: "gemma",
            level: "works_here",
            engines: [
              { engine: "llama_cpp", verdict: "runs", available: true, reason: "runs it" },
              {
                engine: "strata",
                verdict: "after_preparation",
                available: true,
                reason: "runs it after preparing it",
              },
            ],
          },
          {
            modelId: "qwen",
            level: "works_here",
            engines: [
              {
                engine: "strata",
                verdict: "runs",
                available: true,
                experimental: true,
                reason: "runs it as it is",
              },
              {
                engine: "llama_cpp",
                verdict: "no",
                available: true,
                reason: "loads gguf models, and this one is prepared",
              },
            ],
          },
        ],
      }),
    );
  });

  it("lists one with its engine, offers Run, and never asks llama.cpp's fit", async () => {
    render(<LibraryPage />);
    const row = await screen.findByRole("button", { name: /qwen-flash/ });
    expect(row).toHaveTextContent("for Strata");
    fireEvent.click(row);
    const fit = await screen.findByTestId("model-fit");
    expect(fit).toHaveTextContent("Fit not estimated");
    expect(await screen.findByTestId("model-run")).toBeInTheDocument();
    const detail = screen.getByTestId("model-eligibility");
    expect(detail).toHaveTextContent("Strata (experimental): runs it as it is");
    expect(screen.getByText("prepared outside Eugene")).toBeInTheDocument();
    expect(screen.getByText(/not on the Library.s machine/)).toBeInTheDocument();
    expect(gets.some((g) => g.startsWith("library/v1/models/qwen/fit"))).toBe(false);
  });

  it("adds one through the Library, then shows it", async () => {
    handlers.set("POST library/v1/models/prepared", () => {
      const made = { ...PREPARED, id: "new", name: "strata-qwen" };
      listed = [...listed, made];
      return { status: 201, body: made };
    });
    render(<LibraryPage />);
    await screen.findByTestId("model-fit");
    fireEvent.click(screen.getByRole("button", { name: "add prepared model" }));
    const form = await screen.findByTestId("add-prepared");
    fireEvent.change(within(form).getByLabelText(/configuration file/), {
      target: { value: "E:\\Strata\\strata-qwen.json" },
    });
    // Named for its file, as a GGUF is.
    expect(within(form).getByLabelText(/^Name/)).toHaveValue("strata-qwen");
    // Only what Strata prepares from is offered as its source.
    const from = within(form).getByLabelText(/Made from/);
    expect(
      within(from)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Not in the Library, or not known", "gemma-3-27b-it-Q6_K_L"]);
    fireEvent.change(from, { target: { value: "gemma" } });
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: "Add model" }));
    });
    await waitFor(() => expect(posted).toContain("POST library/v1/models/prepared"));
    expect(bodies.get("POST library/v1/models/prepared")).toEqual({
      name: "strata-qwen",
      root: "D:\\Models",
      provenance: {
        engine: "strata",
        entry: "E:\\Strata\\strata-qwen.json",
        source: { path: MODEL_PATH },
      },
    });
    // No runtime is posted straight to the node any more.
    expect(
      posted.some((p) => p.startsWith("POST agent/v1/runtimes") && !p.endsWith("admission")),
    ).toBe(false);
    await waitFor(() => expect(screen.queryByTestId("add-prepared")).toBeNull());
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

describe("a prepared model's fit is its engine's own table (LS6)", () => {
  it("shows Strata's answer from the judge, and never asks the arithmetic", async () => {
    const prepared = {
      id: "qwen",
      path: "D:\\Models\\qwen-flash.eugene-prepared.json",
      format: "prepared",
      name: "qwen-flash",
      status: "present",
      fileCount: 1,
      prepared: { engine: "strata", entry: "strata-qwen.json" },
    };
    handlers.set("GET library/v1/models", () =>
      ok({ models: [libraryModel(), prepared], lastScanAt: null }),
    );
    handlers.set("GET agent/v1/runtimes", () => ok({ runtimes: [] }));
    handlers.set("GET library/v1/models/qwen/profiles", () => ok({ profiles: [] }));
    handlers.set("GET agent/v1/engines", () =>
      ok({
        engines: [
          {
            engine: "strata",
            available: true,
            experimental: true,
            accepts: [{ format: "prepared", preparedFor: "strata" }],
            fit: { kind: "engine_table", table: [] },
          },
        ],
      }),
    );
    handlers.set("POST library/v1/eligibility", () =>
      ok({
        models: [
          {
            modelId: "qwen",
            level: "works_here",
            engines: [
              {
                engine: "strata",
                verdict: "runs",
                available: true,
                experimental: true,
                reason: "runs it as it is",
                fit: {
                  estimated: true,
                  verdict: "fits",
                  model: "engine_table",
                  reason:
                    "Strata keeps its 35.5 GB of experts in RAM: it needs about 48 GB of RAM, and this machine has 94 GB",
                },
              },
            ],
          },
        ],
      }),
    );
    render(<LibraryPage />);
    fireEvent.click(await screen.findByRole("button", { name: /qwen-flash/ }));
    // Not estimated until the judge answers; then Strata's own.
    await waitFor(() =>
      expect(screen.getByTestId("model-fit")).toHaveAttribute("data-estimated", "true"),
    );
    const fit = screen.getByTestId("model-fit");
    expect(fit).toHaveTextContent("Strata: fits");
    expect(fit).toHaveTextContent("it needs about 48 GB of RAM, and this machine has 94 GB");
    expect(gets.some((g) => g.startsWith("library/v1/models/qwen/fit"))).toBe(false);
  });
});

describe("each engine owns its fit (LS6)", () => {
  beforeEach(() => {
    handlers.set("GET agent/v1/runtimes", () => ok({ runtimes: [] }));
  });

  function engines(...list: object[]) {
    handlers.set("GET agent/v1/engines", () => ok({ engines: list }));
  }
  function judgeSays(engineVerdicts: object[], level = "works_here") {
    handlers.set("POST library/v1/eligibility", () =>
      ok({ models: [{ modelId: "gemma", level, engines: engineVerdicts }] }),
    );
  }

  it("asks the judge with the picked node's memory", async () => {
    handlers.set("GET agent/v1/node", () =>
      ok({
        enrolled: true,
        name: "Amish_Station",
        devices: [
          {
            kind: "cuda",
            index: 0,
            name: "RTX 5090",
            memoryTotalBytes: 32 * GIB,
            memoryFreeBytes: 30 * GIB,
          },
          { kind: "cpu", memoryTotalBytes: 94 * GIB, memoryFreeBytes: 65 * GIB },
        ],
      }),
    );
    engines({
      engine: "llama_cpp",
      available: true,
      accepts: [{ format: "gguf" }],
      fit: { kind: "spill" },
    });
    judgeSays([{ engine: "llama_cpp", verdict: "runs", available: true, reason: "runs it" }]);
    await openTheModel();
    await waitFor(() =>
      expect(bodies.get("POST library/v1/eligibility")).toMatchObject({
        fit: {
          vramFreeBytes: 30 * GIB,
          vramTotalBytes: 32 * GIB,
          gpuCount: 1,
          ramAvailableBytes: 65 * GIB,
          ramTotalBytes: 94 * GIB,
        },
        engines: [{ engine: "llama_cpp", fit: { kind: "spill" } }],
      }),
    );
    // llama.cpp's own estimate, named (the panel re-measures once the
    // node's memory arrives, so it is waited for).
    await waitFor(() =>
      expect(screen.getByTestId("model-fit")).toHaveTextContent("llama.cpp’s estimate"),
    );
  });

  it("asks a share-taking engine's fit by its share, and says whose it is", async () => {
    engines({
      engine: "vllm",
      available: true,
      accepts: [{ format: "gguf" }],
      fit: { kind: "reserved_share", gpuMemoryUtilization: 0.92 },
    });
    judgeSays([{ engine: "vllm", verdict: "may_run", available: true, reason: "may" }]);
    handlers.set("GET library/v1/models/gemma/fit", () =>
      ok({ ...fitBody(), fit: { ...fitBody().fit, verdict: "tight", model: "reserved_share" } }),
    );
    render(<LibraryPage />);
    await waitFor(
      () =>
        expect(screen.getByTestId("model-fit")).toHaveTextContent(
          "Fits vLLM's share, but less than it is free now",
        ),
      { timeout: 5000 },
    );
    const asked = gets.filter((g) => g.startsWith("library/v1/models/gemma/fit")).at(-1) ?? "";
    expect(asked).toContain("fitModel=reserved_share");
    expect(asked).toContain("gpuMemoryUtilization=0.92");
    expect(screen.getByTestId("model-fit")).toHaveTextContent("vLLM’s estimate");
    // Nothing moves to system memory on vLLM: llama.cpp's placement words never show.
    expect(screen.getByTestId("model-fit")).not.toHaveTextContent("system memory");
    expect(screen.queryByTestId("model-fit-placement")).toBeNull();
  });

  it("an engine with no fit model says so and never borrows llama.cpp's arithmetic", async () => {
    engines({ engine: "mlx", available: true, accepts: [{ format: "gguf" }] });
    judgeSays([
      {
        engine: "mlx",
        verdict: "runs",
        available: true,
        reason: "runs it",
        fit: { estimated: false, reason: "this engine has no fit estimate in Eugene yet" },
      },
    ]);
    render(<LibraryPage />);
    const fit = await screen.findByTestId("model-fit", {}, { timeout: 5000 });
    await waitFor(() => expect(fit).toHaveTextContent("Fit not estimated."));
    expect(fit).toHaveAttribute("data-estimated", "false");
    expect(fit).toHaveTextContent("MLX: this engine has no fit estimate in Eugene yet.");
    expect(gets.some((g) => g.startsWith("library/v1/models/gemma/fit"))).toBe(false);
  });

  it("shows each engine's own fit beside its verdict", async () => {
    engines(
      {
        engine: "llama_cpp",
        available: true,
        accepts: [{ format: "gguf" }],
        fit: { kind: "spill" },
      },
      { engine: "strata", available: true, experimental: true, accepts: [{ format: "gguf" }] },
    );
    judgeSays(
      [
        {
          engine: "llama_cpp",
          verdict: "runs",
          available: true,
          reason: "runs it",
          fit: { estimated: true, verdict: "no", model: "spill", reason: "too large here" },
        },
        {
          engine: "strata",
          verdict: "after_preparation",
          available: true,
          experimental: true,
          reason: "runs it after preparing it",
          fit: {
            estimated: true,
            verdict: "split",
            model: "engine_table",
            reason: "fits in Strata's low-RAM mode",
          },
        },
      ],
      "other_engine",
    );
    await openTheModel();
    const lines = (await screen.findAllByTestId("engine-fit")).map((l) => l.textContent);
    expect(lines).toEqual([
      "fit, llama.cpp: does not fit: too large here",
      "fit, Strata: fits, slower: fits in Strata's low-RAM mode",
    ]);
  });
});
