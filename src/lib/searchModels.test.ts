/**
 * The words for what a file is, the override, and the three models suggested (MR3).
 *
 * The Library predicts from the file's header (`capabilities.embedding`,
 * `capabilities.rerank`) and the agent decides from the same two keys, so these say
 * what will happen in plain words. A search model is the contract's `embedding`; a
 * result sorter is `reranking`.
 */

import { describe, expect, it } from "vitest";

import {
  MODE_CHOICES,
  SORTER_HINT,
  SUGGESTED_SEARCH_MODELS,
  discoverHref,
  isSearchFile,
  kindOfFile,
  kindOfMode,
  kindWords,
  modeToSave,
  offersModes,
  runsAs,
  runsAsLine,
  searchModelsIn,
  startsWithLine,
} from "./searchModels";

const CHAT = { chat: true, embedding: false, rerank: false };
const SEARCH = { chat: false, embedding: true, rerank: false };
const SORTER = { chat: false, embedding: false, rerank: true };

describe("what a file is", () => {
  it("reads the Library's capabilities", () => {
    expect(kindOfFile(CHAT)).toBe("chat");
    expect(kindOfFile(SEARCH)).toBe("search");
    expect(kindOfFile(SORTER)).toBe("sorter");
  });

  it("is a chat model when the Library said nothing", () => {
    expect(kindOfFile(undefined)).toBe("chat");
    expect(kindOfFile(null)).toBe("chat");
    expect(kindOfFile({})).toBe("chat");
  });

  it("calls a reranker a sorter even if embedding is also set, because it has its own flag", () => {
    expect(kindOfFile({ embedding: true, rerank: true })).toBe("sorter");
  });

  it("says which files are not chat models", () => {
    expect(isSearchFile(SEARCH)).toBe(true);
    expect(isSearchFile(SORTER)).toBe(true);
    expect(isSearchFile(CHAT)).toBe(false);
    expect(isSearchFile(undefined)).toBe(false);
  });
});

describe("what a person chose", () => {
  it("maps the contract's modes to kinds, and Auto to none", () => {
    expect(kindOfMode("chat")).toBe("chat");
    expect(kindOfMode("embedding")).toBe("search");
    expect(kindOfMode("reranking")).toBe("sorter");
    expect(kindOfMode("auto")).toBeNull();
    expect(kindOfMode(undefined)).toBeNull();
    expect(kindOfMode(null)).toBeNull();
  });

  it("offers the four, in order, in plain words", () => {
    expect(MODE_CHOICES.map((c) => c.label)).toEqual(["Auto", "Chat", "Search", "Sort results"]);
    expect(MODE_CHOICES.map((c) => c.value)).toEqual(["auto", "chat", "embedding", "reranking"]);
  });

  it("saves nothing for Auto, because absent already means Auto", () => {
    expect(modeToSave("auto")).toBeUndefined();
    expect(modeToSave("chat")).toBe("chat");
    expect(modeToSave("embedding")).toBe("embedding");
    expect(modeToSave("reranking")).toBe("reranking");
  });

  it("offers modes for llama.cpp only, which is the one engine that acts on them", () => {
    expect(offersModes("llama_cpp")).toBe(true);
    for (const other of ["vllm", "mlx", "strata", "kev", undefined, null]) {
      expect(offersModes(other)).toBe(false);
    }
  });
});

describe("Runs as", () => {
  it("says what the file's header said, and where it came from", () => {
    expect(runsAsLine(SEARCH, undefined)).toBe("Runs as: search model (found in the file)");
    expect(runsAsLine(SEARCH, "auto")).toBe("Runs as: search model (found in the file)");
    expect(runsAsLine(SORTER, null)).toBe("Runs as: result sorter (found in the file)");
    expect(runsAsLine(CHAT, undefined)).toBe("Runs as: chat model (found in the file)");
  });

  it("says a choice is the person's, and lets it beat the file", () => {
    expect(runsAsLine(SEARCH, "chat")).toBe("Runs as: chat model (you chose this)");
    expect(runsAsLine(CHAT, "embedding")).toBe("Runs as: search model (you chose this)");
    expect(runsAsLine(SEARCH, "reranking")).toBe("Runs as: result sorter (you chose this)");
  });

  it("does not claim the file said it when the Library said nothing", () => {
    expect(runsAsLine(undefined, undefined)).toBe("Runs as: chat model (the file does not say)");
    expect(runsAs(undefined, undefined).source).toBe("assumed");
    // A choice is still a choice.
    expect(runsAs(undefined, "embedding").source).toBe("chosen");
  });

  it("carries the kind, for what is shown under it", () => {
    expect(runsAs(SEARCH, undefined).kind).toBe("search");
    expect(runsAs(SEARCH, "chat").kind).toBe("chat");
  });
});

describe("what a search model starts with", () => {
  it("is said for a search model and a sorter, with the numbers the agent uses", () => {
    for (const kind of ["search", "sorter"] as const) {
      const line = startsWithLine(kind);
      expect(line).toContain("4 requests");
      expect(line).toContain("1,024 tokens");
      expect(line).toContain("stays running");
    }
  });

  it("is not said for a chat model", () => {
    expect(startsWithLine("chat")).toBeNull();
  });

  it("tells a person whose result sorter reads as a search model what to do", () => {
    expect(SORTER_HINT).toContain("Sort results");
  });
});

describe("the three suggested models", () => {
  it("are the ones the plan names, each as a file", () => {
    expect(SUGGESTED_SEARCH_MODELS.map((m) => [m.repo, m.file])).toEqual([
      ["Qwen/Qwen3-Embedding-0.6B-GGUF", "Qwen3-Embedding-0.6B-Q8_0.gguf"],
      ["nomic-ai/nomic-embed-text-v1.5-GGUF", "nomic-embed-text-v1.5.Q8_0.gguf"],
      ["ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF", "qwen3-reranker-0.6b-q8_0.gguf"],
    ]);
  });

  it("start with the default, then the light one, then the sorter", () => {
    expect(SUGGESTED_SEARCH_MODELS.map((m) => m.kind)).toEqual(["search", "search", "sorter"]);
    expect(SUGGESTED_SEARCH_MODELS[0]!.tag).toBe("Start here");
    expect(SUGGESTED_SEARCH_MODELS[1]!.tag).toBe("Lighter");
  });

  it("link to Discover with the repo open", () => {
    expect(discoverHref(SUGGESTED_SEARCH_MODELS[0]!)).toBe(
      "/discover?repo=Qwen%2FQwen3-Embedding-0.6B-GGUF",
    );
    for (const model of SUGGESTED_SEARCH_MODELS) {
      const url = new URL(discoverHref(model), "http://console.test");
      expect(url.searchParams.get("repo")).toBe(model.repo);
    }
  });

  it("say what each is in words a person can use, and how big it is", () => {
    for (const model of SUGGESTED_SEARCH_MODELS) {
      expect(model.about.length).toBeGreaterThan(20);
      expect(model.size).toMatch(/^about \d+ MB$/);
      expect(kindWords(model.kind)).toMatch(/search model|result sorter/);
    }
  });

  it("warn that only this copy of the sorter scores right", () => {
    const sorter = SUGGESTED_SEARCH_MODELS.find((m) => m.kind === "sorter")!;
    expect(sorter.about).toContain("most others score wrongly");
  });
});

describe("what the Library already holds", () => {
  const model = (id: string, capabilities: object, status = "present") => ({
    id,
    name: `model ${id}`,
    capabilities,
    status: status as "present" | "missing",
  });

  it("lists the search models and the sorters, and nothing else", () => {
    const held = searchModelsIn([
      model("a", CHAT),
      model("b", SEARCH),
      model("c", SORTER),
      model("d", {}),
    ]);
    expect(held).toEqual([
      { id: "b", name: "model b", kind: "search" },
      { id: "c", name: "model c", kind: "sorter" },
    ]);
  });

  it("skips one whose file is gone, which cannot be started", () => {
    expect(searchModelsIn([model("b", SEARCH, "missing")])).toEqual([]);
  });

  it("is empty before the Library has answered", () => {
    expect(searchModelsIn(null)).toEqual([]);
  });
});
