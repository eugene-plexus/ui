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
import type { LibraryModelList, ModelList, NodeIdentity } from "./types";

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

  it("offers to run one when models exist and nothing is routable", () => {
    expect(firstModelState({ library: TWO_MODELS, libraryFailed: false, routable: 0 })).toEqual({
      kind: "none-running",
      count: 2,
    });
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
