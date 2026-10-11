/**
 * Search models, in the console's words (MR3).
 *
 * A **search model** turns text into numbers so passages can be found by meaning
 * (the contract's `embedding`); a **result sorter** puts the best matches first
 * (`reranking`). llama.cpp has to be told which one a file is when it starts, and
 * the agent works it out from the file's own header unless a person says
 * otherwise. The Library predicts what it will find (`capabilities.embedding`,
 * `capabilities.rerank`); this module says it in plain words and carries the
 * override a person has when the header misleads.
 *
 * Nothing here decides how a model starts: the agent does. These are the words,
 * and the three models the console suggests.
 */

import type { LibraryModel, ModelCapabilities, ModelProfile } from "./types";

/** What a file is, as the Library reads it. */
export type ModelKind = "chat" | "search" | "sorter";

/** `ModelProfile.mode`, which is `RuntimeMode`'s four values. */
export type ModeChoice = NonNullable<ModelProfile["mode"]>;

/**
 * The override, in the order and the words a person sees. The values are the
 * contract's; the labels are not: "embedding" and "reranking" are what the
 * engine calls them, and nobody setting up a computer to search their notes
 * needs either word.
 */
export const MODE_CHOICES: { value: ModeChoice; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "chat", label: "Chat" },
  { value: "embedding", label: "Search" },
  { value: "reranking", label: "Sort results" },
];

const KIND_WORDS: Record<ModelKind, string> = {
  chat: "chat model",
  search: "search model",
  sorter: "result sorter",
};

/** What the Library says a file is. A reranker is not also a search model. */
export function kindOfFile(capabilities: ModelCapabilities | null | undefined): ModelKind {
  if (capabilities?.rerank) return "sorter";
  if (capabilities?.embedding) return "search";
  return "chat";
}

/** What a person chose, or null for Auto (and for a profile that says nothing). */
export function kindOfMode(mode: ModeChoice | null | undefined): ModelKind | null {
  if (mode === "chat") return "chat";
  if (mode === "embedding") return "search";
  if (mode === "reranking") return "sorter";
  return null;
}

/** Whether a file is a search model or a sorter, whatever any profile says. */
export function isSearchFile(capabilities: ModelCapabilities | null | undefined): boolean {
  return kindOfFile(capabilities) !== "chat";
}

export interface RunsAs {
  kind: ModelKind;
  /** "chat model", "search model" or "result sorter". */
  words: string;
  /**
   * Where the answer came from: the file's own header, the person's choice, or,
   * for a file the Library said nothing about, an assumption that is said so.
   */
  source: "file" | "chosen" | "assumed";
}

/** What starting this file with this profile will make of it. */
export function runsAs(
  capabilities: ModelCapabilities | null | undefined,
  mode: ModeChoice | null | undefined,
): RunsAs {
  const chosen = kindOfMode(mode);
  if (chosen) return { kind: chosen, words: KIND_WORDS[chosen], source: "chosen" };
  const kind = kindOfFile(capabilities);
  return {
    kind,
    words: KIND_WORDS[kind],
    source: capabilities == null && kind === "chat" ? "assumed" : "file",
  };
}

const SOURCE_WORDS: Record<RunsAs["source"], string> = {
  file: "found in the file",
  chosen: "you chose this",
  assumed: "the file does not say",
};

/** "Runs as: search model (found in the file)". */
export function runsAsLine(
  capabilities: ModelCapabilities | null | undefined,
  mode: ModeChoice | null | undefined,
): string {
  const answer = runsAs(capabilities, mode);
  return `Runs as: ${answer.words} (${SOURCE_WORDS[answer.source]})`;
}

/**
 * What a search model or a sorter starts with, which the agent supplies and a
 * person's own settings beat. The numbers are the agent's (`SEARCH_DEFAULTS` in
 * `engines/run_mode.py`) and the contract's (`RuntimeMode`), said once here.
 */
export function startsWithLine(kind: ModelKind): string | null {
  if (kind === "chat") return null;
  return "It stays running. It starts with room for 4 requests of 1,024 tokens each, unless you set the context size or slots below.";
}

/**
 * A result sorter's header can read as a search model: some are converted with
 * neither of the keys the Library looks for. The line says what to do, because the
 * wrong guess starts the file as the wrong thing and nothing says so until a
 * search comes back strange.
 */
export const SORTER_HINT =
  "Some result sorters read as search models. If this one does, choose Sort results.";

/** Only llama.cpp starts a model as a search model; another engine refuses. */
export function offersModes(engine: string | null | undefined): boolean {
  return engine === "llama_cpp";
}

/** The `mode` to save: nothing for Auto, because absent already means Auto. */
export function modeToSave(choice: ModeChoice): ModeChoice | undefined {
  return choice === "auto" ? undefined : choice;
}

// --- what the console suggests ------------------------------------------------------

export interface SuggestedSearchModel {
  /** A stable key, and what a test names it by. */
  id: string;
  name: string;
  /** The Hugging Face repo, for the Discover deep link. */
  repo: string;
  /** The file to pick in it: the others in the repo are other sizes. */
  file: string;
  kind: ModelKind;
  /** A short label for the row: what makes this the one to take. */
  tag: string;
  /** What it does, in a sentence a person can use. */
  about: string;
  /** What the download is, in words (the table's MiB, rounded). */
  size: string;
}

/**
 * The three the design names (memory-and-documents plan, section 4.2): the
 * default, a lighter one, and the one reranker that scores correctly. Each is
 * Apache-2.0, and each file was read off its own header on 2026-10-11 (pooling
 * 3, pooling 1, pooling 4 with its labels), so the agent starts each as what it
 * is with no setting.
 *
 * Qwen3-Reranker is **that file only**: most other copies of it score
 * wrongly (llama.cpp issue 16407), so the row names the repo and the file.
 */
export const SUGGESTED_SEARCH_MODELS: SuggestedSearchModel[] = [
  {
    id: "qwen3-embedding",
    name: "Qwen3-Embedding-0.6B",
    repo: "Qwen/Qwen3-Embedding-0.6B-GGUF",
    file: "Qwen3-Embedding-0.6B-Q8_0.gguf",
    kind: "search",
    tag: "Start here",
    about: "Finds passages by meaning, in many languages. Runs well on most computers.",
    size: "about 610 MB",
  },
  {
    id: "nomic-embed",
    name: "nomic-embed-text-v1.5",
    repo: "nomic-ai/nomic-embed-text-v1.5-GGUF",
    file: "nomic-embed-text-v1.5.Q8_0.gguf",
    kind: "search",
    tag: "Lighter",
    about: "Smaller and quicker, for a computer that is short on memory.",
    size: "about 140 MB",
  },
  {
    id: "qwen3-reranker",
    name: "Qwen3-Reranker-0.6B",
    repo: "ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF",
    file: "qwen3-reranker-0.6b-q8_0.gguf",
    kind: "sorter",
    tag: "Sorts results",
    about:
      "An optional second step that puts the best matches first. Take this copy: most others score wrongly.",
    size: "about 610 MB",
  },
];

/** The Discover link for a suggested model: its repo, open. */
export function discoverHref(model: Pick<SuggestedSearchModel, "repo">): string {
  return `/discover?repo=${encodeURIComponent(model.repo)}`;
}

/** The kind's words for a row: "search model" or "result sorter". */
export function kindWords(kind: ModelKind): string {
  return KIND_WORDS[kind];
}

/** What a Library already holds that is a search model or a sorter, by name. */
export function searchModelsIn(
  models: readonly Pick<LibraryModel, "id" | "name" | "capabilities" | "status">[] | null,
): { id: string; name: string; kind: ModelKind }[] {
  return (models ?? [])
    .filter((m) => m.status === "present" && isSearchFile(m.capabilities))
    .map((m) => ({ id: m.id, name: m.name, kind: kindOfFile(m.capabilities) }));
}
