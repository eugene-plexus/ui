/**
 * Home's sentences, from the bodies that produce them.
 *
 * The node is the live worker's own `GET /v1/node` (the fixture
 * `nodeBudget.test.ts` uses); the library and gateway bodies are the
 * shapes those components return. What matters is that each state a
 * fresh install passes through — nothing, something, something running,
 * a library that is down — gets a card that says one true thing.
 */

import { describe, expect, it } from "vitest";

import { chatModels, firstModelState, gb, machineStrip, modelsOnDisk } from "./home";
import type { EngineList, LibraryModelList, ModelList, NodeIdentity, StarterSet } from "./types";

const AMISH_STATION: NodeIdentity = {
  enrolled: true,
  name: "Amish_Station",
  devices: [
    {
      kind: "cuda",
      name: "NVIDIA GeForce RTX 5090",
      index: 0,
      memoryTotalBytes: 34190917632,
      memoryFreeBytes: 32446087168,
    },
    {
      kind: "cpu",
      name: "AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD",
      index: 0,
      memoryTotalBytes: 100453961728,
      memoryFreeBytes: 75783077888,
    },
  ],
};

// The shipped list as the library serves it, trimmed to the two fields
// this module reads. Scored against a 29 GiB card, which is what makes
// the 30B the recommendation rather than an arbitrary pick.
const STARTER = {
  reviewed: "2026-09-16",
  reviewedDaysAgo: 0,
  source: "shipped",
  models: [
    {
      sizeClass: "4B",
      baseModel: "Qwen/Qwen3.5-4B",
      repo: "unsloth/Qwen3.5-4B-GGUF",
      file: "Qwen3.5-4B-Q4_K_M.gguf",
      label: "Q4_K_M",
      sizeBytes: 2740937888,
      why: "most downloaded in its class",
    },
    {
      sizeClass: "30B",
      baseModel: "Qwen/Qwen3.8-27B",
      repo: "unsloth/Qwen3.8-27B-GGUF",
      file: "Qwen3.8-27B-UD-Q4_K_M.gguf",
      label: "UD-Q4_K_M",
      sizeBytes: 16464440224,
      why: "most downloaded in its class",
    },
  ],
  recommended: {
    sizeClass: "30B",
    reason: "Qwen/Qwen3.8-27B is the largest of these that runs entirely in GPU memory.",
  },
} as unknown as StarterSet;

const TWO_MODELS: LibraryModelList = {
  models: [
    { id: "a", path: "/models/a.gguf", format: "gguf", name: "a", status: "present" },
    { id: "b", path: "/models/b.gguf", format: "gguf", name: "b", status: "present" },
    // Gone from disk since the last scan: keeps its profile, is not "on disk".
    { id: "c", path: "/models/c.gguf", format: "gguf", name: "c", status: "missing" },
  ],
};

describe("firstModelState", () => {
  it("is nothing until the library has answered once", () => {
    expect(firstModelState({ library: null, libraryFailed: false, routable: 0 })).toEqual({
      kind: "loading",
    });
  });

  it("names the library as the thing that did not answer", () => {
    expect(firstModelState({ library: null, libraryFailed: true, routable: 0 })).toEqual({
      kind: "library-unreachable",
    });
  });

  it("offers the first model when the disk is empty", () => {
    expect(firstModelState({ library: { models: [] }, libraryFailed: false, routable: 0 })).toEqual(
      { kind: "no-models" },
    );
  });

  it("names one model when the starter set recommends one (S6)", () => {
    const state = firstModelState({
      library: { models: [] },
      libraryFailed: false,
      routable: 0,
      starter: STARTER,
    });
    expect(state.kind).toBe("no-models-recommended");
    if (state.kind !== "no-models-recommended") throw new Error("wrong state");
    expect(state.model.baseModel).toBe("Qwen/Qwen3.8-27B");
    expect(state.reason).toContain("largest");
  });

  it("falls back to the search route when nothing in the set fits", () => {
    // A recommendation with no `sizeClass` is the library saying nothing
    // here runs on this machine. Offering a download that cannot run
    // would be worse than offering none.
    const nothingFits = {
      ...STARTER,
      recommended: { reason: "None of these fits in 4.00 GiB." },
    };
    expect(
      firstModelState({
        library: { models: [] },
        libraryFailed: false,
        routable: 0,
        starter: nothingFits as never,
      }),
    ).toEqual({ kind: "no-models" });
  });

  it("falls back to the search route when the library did not answer the set", () => {
    expect(
      firstModelState({
        library: { models: [] },
        libraryFailed: false,
        routable: 0,
        starter: null,
      }),
    ).toEqual({ kind: "no-models" });
  });

  it("does not suggest anything once a model is on disk", () => {
    // The suggestion is for an empty disk only. Someone who has a model
    // and nothing running needs Run, not another download.
    expect(
      firstModelState({
        library: TWO_MODELS,
        libraryFailed: false,
        routable: 0,
        starter: STARTER,
      }).kind,
    ).toBe("none-running");
  });

  it("offers to run one when models exist and nothing is routable", () => {
    expect(firstModelState({ library: TWO_MODELS, libraryFailed: false, routable: 0 })).toEqual({
      kind: "none-running",
      count: 2,
      only: null,
    });
  });

  // S3: one model on disk is the state a person is in the moment their
  // first download finishes, and the card runs it in one click.
  const ONE_MODEL: LibraryModelList = { models: [TWO_MODELS.models![0]!] };
  const LLAMA: EngineList = {
    engines: [{ engine: "llama_cpp", available: false, modelFormats: ["gguf"] }],
  };

  it("offers to run THE model when there is exactly one this machine can load", () => {
    const state = firstModelState({
      library: ONE_MODEL,
      libraryFailed: false,
      routable: 0,
      engines: LLAMA,
    });
    expect(state).toEqual({ kind: "none-running", count: 1, only: ONE_MODEL.models![0] });
  });

  it("offers the one model even while the engine is not installed: Run asks to install it", () => {
    expect(
      firstModelState({ library: ONE_MODEL, libraryFailed: false, routable: 0, engines: LLAMA }),
    ).toMatchObject({ only: { id: "a" } });
  });

  it("sends the person to the Library when no engine here reads the one model's format", () => {
    const safetensors: LibraryModelList = {
      models: [{ ...TWO_MODELS.models![0]!, format: "safetensors" }],
    };
    expect(
      firstModelState({ library: safetensors, libraryFailed: false, routable: 0, engines: LLAMA }),
    ).toEqual({ kind: "none-running", count: 1, only: null });
  });

  it("offers the one model when the engines are still unknown, rather than predicting a failure", () => {
    expect(
      firstModelState({ library: ONE_MODEL, libraryFailed: false, routable: 0, engines: null }),
    ).toMatchObject({ only: { id: "a" } });
  });

  it("does not count a missing file as the one model", () => {
    const missingOnly: LibraryModelList = { models: [TWO_MODELS.models![2]!] };
    expect(
      firstModelState({ library: missingOnly, libraryFailed: false, routable: 0, engines: LLAMA }),
    ).toEqual({ kind: "no-models" });
  });

  it("does not call models 'not running' before the gateway has answered", () => {
    expect(firstModelState({ library: TWO_MODELS, libraryFailed: false, routable: null })).toEqual({
      kind: "loading",
    });
    // An empty disk needs no gateway answer: there is nothing to run.
    expect(
      firstModelState({ library: { models: [] }, libraryFailed: false, routable: null }),
    ).toEqual({ kind: "no-models" });
  });

  it("says the library did not answer even when an earlier answer is still held", () => {
    expect(firstModelState({ library: TWO_MODELS, libraryFailed: true, routable: 0 })).toEqual({
      kind: "library-unreachable",
    });
  });

  it("gets out of the way once something is routable, whatever the library says", () => {
    expect(firstModelState({ library: TWO_MODELS, libraryFailed: false, routable: 1 })).toEqual({
      kind: "hidden",
    });
    // A routable external backend with an unreachable library: the person
    // can chat, so the card that says "get a model" would be wrong.
    expect(firstModelState({ library: null, libraryFailed: true, routable: 1 })).toEqual({
      kind: "hidden",
    });
  });
});

describe("modelsOnDisk", () => {
  it("does not count a model whose file has gone", () => {
    expect(modelsOnDisk(TWO_MODELS)).toBe(2);
    expect(modelsOnDisk(null)).toBe(0);
  });
});

describe("chatModels", () => {
  it("keeps chat models and models from a gateway that says nothing about surfaces", () => {
    const list: ModelList = {
      object: "list",
      data: [
        {
          id: "chat",
          object: "model",
          created: 0,
          owned_by: "x",
          x_eugene_plexus: { surfaces: ["chat"] },
        },
        {
          id: "embed",
          object: "model",
          created: 0,
          owned_by: "x",
          x_eugene_plexus: { surfaces: ["embeddings"] },
        },
        { id: "old", object: "model", created: 0, owned_by: "x" },
      ],
    } as unknown as ModelList;
    expect(chatModels(list).map((m) => m.id)).toEqual(["chat", "old"]);
    expect(chatModels(null)).toEqual([]);
  });
});

describe("machineStrip", () => {
  it("names the machine, its card with total and free, its engine and its models", () => {
    const strip = machineStrip({
      node: AMISH_STATION,
      engines: {
        engines: [
          { engine: "llama_cpp", available: true, version: "b10948", modelFormats: ["gguf"] },
          { engine: "vllm", available: false, modelFormats: ["safetensors"] },
        ],
      },
      library: TWO_MODELS,
      libraryFailed: false,
    });
    expect(strip.name).toBe("Amish_Station");
    expect(strip.devices).toEqual(["NVIDIA GeForce RTX 5090 · 34 GB · 32 GB free"]);
    expect(strip.engine).toBe("llama.cpp b10948");
    expect(strip.models).toBe("2 models on disk");
  });

  it("says what is unknown, per piece, when a source did not answer", () => {
    const strip = machineStrip({ node: null, engines: null, library: null, libraryFailed: true });
    expect(strip.name).toBe("This machine");
    expect(strip.devices).toEqual(["hardware unknown"]);
    expect(strip.engine).toBe("engines unknown");
    expect(strip.models).toBe("library did not answer");
  });

  it("says llama.cpp is not installed yet, in those words, on a fresh machine", () => {
    const strip = machineStrip({
      node: { enrolled: false, devices: [] },
      engines: {
        engines: [{ engine: "llama_cpp", available: false, modelFormats: ["gguf"] }],
      },
      library: { models: [] },
      libraryFailed: false,
    });
    expect(strip.engine).toBe("llama.cpp not installed yet");
    expect(strip.models).toBe("0 models on disk");
    expect(strip.devices).toEqual(["hardware unknown"]);
  });

  it("describes a machine with no GPU by its memory, not as an error", () => {
    const strip = machineStrip({
      node: {
        enrolled: true,
        name: "nas",
        devices: [{ kind: "cpu", name: "x86_64", memoryTotalBytes: 75e9, memoryFreeBytes: 70e9 }],
      },
      engines: { engines: [] },
      library: { models: [{ id: "a", path: "/a", format: "gguf", name: "a", status: "present" }] },
      libraryFailed: false,
    });
    expect(strip.devices).toEqual(["no GPU · 75 GB memory"]);
    expect(strip.engine).toBe("no engines");
    expect(strip.models).toBe("1 model on disk");
  });

  it("quotes memory the way a card's box does", () => {
    expect(gb(34190917632)).toBe("34 GB");
    expect(gb(8e9)).toBe("8.0 GB");
  });
});
