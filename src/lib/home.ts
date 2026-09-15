/**
 * What Home says, from what the components answered.
 *
 * Home is the install root's landing page (hobbyist UX §6.1): a strip
 * about this machine, then one card that names the next thing to do,
 * then a place to try a model, then what is running. Every line is a
 * function of a few bodies, and those functions live here — pure, no
 * fetching, no React — so the states a fresh install, a stocked library
 * and a dead library each produce can be asserted without a browser.
 *
 * **Every source is soft** (the Inference screen's rule, which Home
 * inherits doubly: it is the page you land on after signing in while
 * the fleet is restarting). `null` means "did not answer" and each
 * function says something true about that rather than nothing.
 *
 * **The words are the person's** (P5). "model", "machine", "engine",
 * "download", "loading". A test on the page asserts the banned list.
 */

import type {
  EngineList,
  LibraryModel,
  LibraryModelList,
  Model,
  ModelList,
  NodeIdentity,
} from "./types";
import { engineLabel } from "./tasks";

// --- the first-model card --------------------------------------------

/**
 * Which card the person meets, and the one it is. One primary button per
 * state, by design: Hick's law, and every product in the design's §2.1.
 *
 * `recommend` is not here yet. S6 drops a recommended model into the
 * `no-models` state ("Recommended for your card: …"); when it does, it is
 * a new member of this union with its own render, not a rewrite of the
 * card — which is why the card switches on `kind` and nothing else.
 */
export type FirstModelState =
  /** The library has not answered yet this session. Nothing is shown. */
  | { kind: "loading" }
  /** The library answered with an error, or did not answer at all. */
  | { kind: "library-unreachable" }
  /** The library answered, and there is nothing on disk. */
  | { kind: "no-models" }
  /**
   * Models are on disk and the gateway routes to none of them. `only` is
   * the one model when there is exactly one this machine has an engine
   * for (S3): the card offers to run it in one click rather than sending
   * the person to the Library to choose from a list of one.
   */
  | { kind: "none-running"; count: number; only: LibraryModel | null }
  /** Something is routable, so the Try it card takes over. */
  | { kind: "hidden" };

export function firstModelState(args: {
  /** The library's last successful answer, kept across a later failure. */
  library: LibraryModelList | null;
  /** True while the library's most recent read failed. */
  libraryFailed: boolean;
  /** How many chat models the gateway will route to; null until it has
   * answered (or failed) once. */
  routable: number | null;
  /** This machine's engines, for whether the one model on disk can run
   * here at all; null when the agent has not answered. */
  engines?: EngineList | null;
}): FirstModelState {
  if (args.routable !== null && args.routable > 0) return { kind: "hidden" };
  // A library that stopped answering after it had answered still gets the
  // sentence: a stale count presented as current would be the silent
  // failure P4 forbids, and the person can still reach Inference.
  if (args.libraryFailed) return { kind: "library-unreachable" };
  if (args.library === null) return { kind: "loading" };
  const present = presentModels(args.library);
  const count = present.length;
  if (count === 0) return { kind: "no-models" };
  // Models on disk, and the gateway has not said yet whether any is
  // routable: "none running" would be a guess. Wait for its first answer.
  if (args.routable === null) return { kind: "loading" };
  const only =
    count === 1 && present[0] && runnableHere(present[0], args.engines ?? null) ? present[0] : null;
  return { kind: "none-running", count, only };
}

/** Models the library can see right now. A `missing` entry keeps its
 * profile but its file is gone, which is not "on disk". */
export function modelsOnDisk(library: LibraryModelList | null): number {
  return presentModels(library).length;
}

function presentModels(library: LibraryModelList | null): LibraryModel[] {
  return (library?.models ?? []).filter((m) => m.status !== "missing");
}

/**
 * Whether an engine on this machine can load this model's format — not
 * whether one is installed, since Run offers to install one. Unknown
 * engines (the agent has not answered) read as "yes": Run explains a
 * real failure better than this card predicts one.
 */
function runnableHere(model: LibraryModel, engines: EngineList | null): boolean {
  if (model.status !== "present") return false;
  if (engines === null) return true;
  return (engines.engines ?? []).some((e) => (e.modelFormats ?? []).includes(model.format));
}

// --- routable models --------------------------------------------------

/**
 * The gateway's chat models — the playground's own filter, moved here
 * so Home's picker and the playground's cannot disagree about what a
 * person can talk to. `surfaces` is absent on a gateway older than the
 * embeddings call, and absent must read as "no opinion", not "no chat".
 */
export function chatModels(list: ModelList | null): Model[] {
  return (list?.data ?? []).filter((m) => {
    const surfaces = m.x_eugene_plexus?.surfaces;
    return !surfaces || surfaces.includes("chat");
  });
}

// --- the machine strip -----------------------------------------------

export interface MachineStrip {
  /** The node's name in the install, or "This machine" before it has one. */
  name: string;
  /** One line per accelerator: "NVIDIA GeForce RTX 5090 · 32 GB · 29 GB free". */
  devices: string[];
  /** "llama.cpp b10948", or what stands in its way. */
  engine: string;
  /** "2 models on disk". */
  models: string;
}

export function machineStrip(args: {
  node: NodeIdentity | null;
  engines: EngineList | null;
  library: LibraryModelList | null;
  libraryFailed: boolean;
}): MachineStrip {
  return {
    name: args.node?.name ?? "This machine",
    devices: describeDevices(args.node),
    engine: describeEngines(args.engines),
    models: describeLibrary(args.library, args.libraryFailed),
  };
}

function describeDevices(node: NodeIdentity | null): string[] {
  if (node === null) return ["hardware unknown"];
  const devices = node.devices ?? [];
  const gpus = devices.filter((d) => d.kind !== "cpu");
  if (gpus.length > 0) {
    return gpus.map((d) => {
      const parts = [d.name ?? d.kind];
      if (d.memoryTotalBytes != null) parts.push(gb(d.memoryTotalBytes));
      if (d.memoryFreeBytes != null) parts.push(`${gb(d.memoryFreeBytes)} free`);
      return parts.join(" · ");
    });
  }
  const cpu = devices.find((d) => d.kind === "cpu");
  if (cpu?.memoryTotalBytes != null) return [`no GPU · ${gb(cpu.memoryTotalBytes)} memory`];
  return devices.length === 0 ? ["hardware unknown"] : ["no GPU"];
}

/** Engines this machine has, or the one it is missing. llama.cpp is the
 * one named when nothing is installed because it is the one the install
 * fetches itself; the others are the operator's to provide. */
function describeEngines(engines: EngineList | null): string {
  if (engines === null) return "engines unknown";
  const list = engines.engines ?? [];
  const available = list.filter((e) => e.available);
  if (available.length > 0) {
    return available
      .map((e) => `${engineLabel(e.engine)}${e.version ? ` ${e.version}` : ""}`)
      .join(" · ");
  }
  const llama = list.find((e) => e.engine === "llama_cpp");
  if (llama) return "llama.cpp not installed yet";
  return list.length === 0 ? "no engines" : `${engineLabel(list[0]!.engine)} not installed yet`;
}

function describeLibrary(library: LibraryModelList | null, failed: boolean): string {
  if (library === null) return failed ? "library did not answer" : "counting models…";
  const count = modelsOnDisk(library);
  return `${count} model${count === 1 ? "" : "s"} on disk`;
}

/** `32 GB`: what the box of a graphics card says, not GiB. A person
 * matching this against their own hardware wants the marketing figure. */
export function gb(bytes: number): string {
  const value = bytes / 1e9;
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} GB`;
}
