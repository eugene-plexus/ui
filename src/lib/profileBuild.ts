/**
 * The settings builder's page, as data (`docs/design/profile-builder.md`).
 *
 * PB1 built the job on the agent: it measures what each lower cache
 * precision costs on this model, asks llama.cpp's fit where each context
 * would be placed, measures each placement, and confirms the best in
 * llama-server. It writes no profile. This module is the half of PB2 that
 * turns a finished build into a choice a person can make and a profile the
 * library stores, and a stored profile back into honest words.
 *
 * Pure, no fetching, no React, for the reason `fitWords.ts` is: every
 * shape a build can finish in (one candidate, a frontier of five, a max
 * build with no quality step, a cancelled one with partial results) is
 * worth asserting without a browser.
 *
 * **The words say what a person gets, in the units it is measured in**
 * (§5). A stop on the slider reads *48 tok/s · 80,128 tokens of context*;
 * the depth the speed was measured at and the cache type are the expert
 * hint. It said *words a second* and *pages* until Troy's first build
 * (2026-10-01): tokens and tok/s are mainstream now, and a conversion
 * labelled *about* was a second number to doubt.
 */

import type {
  BuildCandidate,
  CacheType,
  MeasurementRestart,
  ModelProfile,
  ModelProfileSpec,
  ProfileBuild,
  ProfileBuildAccuracy,
  ProfileBuiltBy,
} from "./types";

/** Photoshop's order, most faithful first (§5). Max is the default (call 3). */
export const ACCURACY_LEVELS: readonly {
  id: ProfileBuildAccuracy;
  label: string;
  promise: string;
}[] = [
  {
    id: "max",
    label: "Max",
    promise: "Answers exactly as this file allows. Nothing that changes answers is tried.",
  },
  {
    id: "high",
    label: "High",
    promise: "Picks the same next token as Max at least 96 times in 100, on this model.",
  },
  {
    id: "medium",
    label: "Medium",
    promise: "Picks the same next token as Max at least 92 times in 100, on this model.",
  },
  {
    id: "low",
    label: "Low",
    promise: "Picks the same next token as Max at least 88 times in 100, on this model.",
  },
];

export const DEFAULT_ACCURACY: ProfileBuildAccuracy = "max";

/** The flags the builder sets, and the only ones (§6). `gpuLayers` never. */
export const BUILDER_FLAGS = [
  "contextSize",
  "cacheType",
  "flashAttention",
  "memoryMargin",
] as const;

// --- the slider -----------------------------------------------------------

/** One place the slider can rest: a measured candidate on the frontier. */
export interface Stop {
  /** Index into `build.candidates`, which is what `recommended` names. */
  index: number;
  candidate: BuildCandidate;
}

/** The speed candidates are compared by: at the common depth, else empty. */
export function comparedSpeed(candidate: BuildCandidate): number | null {
  return candidate.deepDecodeTokensPerSecond ?? candidate.decodeTokensPerSecond ?? null;
}

/**
 * The frontier, faster first: every measured candidate that is not both
 * slower and shorter than another, ordered by context. The slider only
 * moves over these, so it answers instantly and never starts work (§5).
 * A candidate that failed to load when confirmed is not a place to rest.
 */
export function frontier(build: ProfileBuild): Stop[] {
  return build.candidates
    .map((candidate, index) => ({ index, candidate }))
    .filter(
      ({ candidate }) =>
        candidate.onFrontier && comparedSpeed(candidate) !== null && candidate.confirmed !== false,
    )
    .sort(
      (a, b) =>
        a.candidate.contextSize - b.candidate.contextSize ||
        PRECISION.indexOf(a.candidate.cacheType) - PRECISION.indexOf(b.candidate.cacheType),
    );
}

/** Most precise first, so two stops at one context read faithful-then-smaller:
 * the real Medium build on the 5090 kept f16 and 8-bit at 8,192 both. */
const PRECISION: readonly CacheType[] = ["f16", "q8_0", "q4_0"];

/**
 * Where the slider starts: the build's own recommendation (the longest
 * memory that keeps 80% of the fastest speed, §5). The default is stated,
 * never silent, so the page says it is the suggestion.
 */
export function defaultStop(build: ProfileBuild, stops: Stop[]): number {
  const at = stops.findIndex((s) => s.index === build.recommended);
  return at >= 0 ? at : stops.length - 1;
}

export function stopLabel(candidate: BuildCandidate): string {
  const speed = comparedSpeed(candidate);
  const said = speed === null ? "Speed not measured" : `${Math.round(speed)} tok/s`;
  return `${said} · ${candidate.contextSize.toLocaleString()} tokens of context`;
}

const CACHE_WORDS: Record<CacheType, string> = {
  f16: "full-precision",
  q8_0: "8-bit",
  q4_0: "4-bit",
};

/** The exact figures, for the expert hint. */
export function stopDetail(candidate: BuildCandidate): string {
  const speed = comparedSpeed(candidate);
  const depth = candidate.deepDepth;
  const measured =
    speed === null
      ? "not measured"
      : `${speed.toFixed(1)} tok/s${depth ? ` measured ${depth.toLocaleString()} tokens deep` : ""}`;
  return `${measured}, ${CACHE_WORDS[candidate.cacheType]} cache`;
}

/**
 * What the chosen cache does to answers, as the promise it keeps. Rounded
 * DOWN: "97 times in 100" for 97.2, never a rate the measurement did not
 * reach.
 */
export function qualityLine(build: ProfileBuild, cacheType: CacheType): string | null {
  if (cacheType === "f16") return "Answers exactly as this file allows.";
  const measured = build.quality.find((q) => q.cacheType === cacheType);
  if (!measured) return null;
  return `Picks the same next token as Max ${Math.floor(measured.sameTopTokenPercent)} times in 100, on this model.`;
}

// --- saving ---------------------------------------------------------------

/** The flags a chosen candidate sets, and nothing else (§6). */
export function builtFlags(
  candidate: BuildCandidate,
  memoryMarginMiB: number | null | undefined,
): Record<string, unknown> {
  const flags: Record<string, unknown> = {
    contextSize: candidate.contextSize,
    cacheType: candidate.cacheType,
  };
  // The V cache needs it quantised; otherwise it is left to llama.cpp.
  if (candidate.cacheType !== "f16") flags.flashAttention = true;
  if (memoryMarginMiB != null) flags.memoryMargin = memoryMarginMiB;
  return flags;
}

export function builtByRecord(
  build: ProfileBuild,
  candidate: BuildCandidate,
  flags: Record<string, unknown>,
): ProfileBuiltBy {
  // The agent measures only the lower precisions against f16, so a
  // full-precision choice finds no entry and records null: nothing that
  // changes answers was set. (A guard for f16 here was a spare the
  // sabotage pass could not tell from this lookup, and was deleted.)
  const quality =
    build.quality.find((q) => q.cacheType === candidate.cacheType)?.sameTopTokenPercent ?? null;
  return {
    buildId: build.id,
    node: build.node,
    accuracy: build.accuracy,
    builtAt: build.finishedAt ?? build.startedAt,
    engineVersion: build.engineVersion ?? null,
    flags,
    decodeTokensPerSecond: candidate.decodeTokensPerSecond ?? null,
    deepDepth: candidate.deepDepth ?? null,
    deepDecodeTokensPerSecond: candidate.deepDecodeTokensPerSecond ?? null,
    graphicsMemoryBytes: candidate.graphicsMemoryBytes ?? null,
    sameTopTokenPercent: quality,
    evaluationSource: build.quality.length > 0 ? build.evaluation.source : null,
  };
}

/** `Built for laptop` — what Save proposes, editable (§6). */
export function builtName(node: string): string {
  return `Built for ${node}`;
}

/**
 * The profile Save writes. The base profile's other settings are kept --
 * the build measured with them -- except `gpuLayers`, which a built
 * profile never sets (placement is llama.cpp's at every launch, §2), and
 * the four builder flags, which come from the choice. `default` is the
 * base's when replacing it and false for a new one.
 */
export function builtSpec(args: {
  base: ModelProfile | null;
  build: ProfileBuild;
  candidate: BuildCandidate;
  name: string;
  replacing: boolean;
}): ModelProfileSpec {
  const { base, build, candidate, name, replacing } = args;
  const kept: Record<string, unknown> = { ...(base?.flags ?? {}) };
  delete kept.gpuLayers;
  for (const key of BUILDER_FLAGS) delete kept[key];
  const chosen = builtFlags(candidate, build.memoryMarginMiB);
  const spec: ModelProfileSpec = {
    name,
    engine: "llama_cpp",
    default: replacing ? (base?.default ?? false) : false,
    flags: { ...kept, ...chosen },
    builtBy: builtByRecord(build, candidate, chosen),
  };
  if (base?.extraArgs?.length) spec.extraArgs = base.extraArgs;
  if (base?.env && Object.keys(base.env).length) spec.env = base.env;
  if (base?.notes) spec.notes = base.notes;
  if (base?.maxTokens != null) spec.maxTokens = base.maxTokens;
  if (base?.temperature != null) spec.temperature = base.temperature;
  if (base?.topP != null) spec.topP = base.topP;
  return spec;
}

// --- a built profile, read back (settings never lie) -----------------------

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** For each flag the builder set: still as built, or edited since. */
export function builtFieldStates(profile: ModelProfile): Record<string, "built" | "edited"> {
  const record = profile.builtBy;
  if (!record) return {};
  const states: Record<string, "built" | "edited"> = {};
  for (const [key, value] of Object.entries(record.flags ?? {})) {
    states[key] = same(profile.flags?.[key], value) ? "built" : "edited";
  }
  return states;
}

/**
 * Whether the measured numbers still describe this profile. A builder flag
 * changed, or `gpuLayers` set by hand (which takes placement away from the
 * fit the build measured), and they no longer do -- so they are labelled,
 * not deleted (§6).
 */
export function editedSinceBuilt(profile: ModelProfile): boolean {
  if (!profile.builtBy) return false;
  if (profile.flags?.gpuLayers != null) return true;
  return Object.values(builtFieldStates(profile)).includes("edited");
}

/** `30 Sep`. The day, because a build is an event and not a version. */
export function builtOn(record: ProfileBuiltBy): string {
  const at = new Date(record.builtAt);
  if (Number.isNaN(at.getTime())) return "an unknown date";
  return at.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The label on every field the builder set (§6). */
export function builtFieldLabel(record: ProfileBuiltBy, state: "built" | "edited"): string {
  return state === "built"
    ? `Set by the settings builder on ${builtOn(record)}.`
    : `Set by the settings builder on ${builtOn(record)}, and edited since.`;
}

/** What the build measured, said once on the profile's row. */
export function measuredLine(profile: ModelProfile): string | null {
  const record = profile.builtBy;
  if (!record) return null;
  const speed = record.deepDecodeTokensPerSecond ?? record.decodeTokensPerSecond ?? null;
  const context = Number(record.flags?.contextSize);
  const parts = [
    speed === null ? null : `${Math.round(speed)} tok/s`,
    Number.isFinite(context) && context > 0
      ? `${context.toLocaleString()} tokens of context`
      : null,
  ].filter(Boolean);
  const measured = parts.length ? `: ${parts.join(", ")}` : "";
  const quality =
    record.sameTopTokenPercent != null
      ? ` Same next token as Max ${Math.floor(record.sameTopTokenPercent)} times in 100.`
      : "";
  return editedSinceBuilt(profile)
    ? `Measured on ${record.node} before this profile was edited${measured}. These numbers may no longer describe it.${quality}`
    : `Measured on ${record.node}${measured}.${quality}`;
}

// --- asking before stopping (shared with Benchmark) ------------------------

function listed(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The question asked before a measurement stops anything (Troy,
 * 2026-09-30), with the names the preflight gave -- exactly the ones
 * Start will pass as `stopRuntimes`. Null when nothing is running.
 */
export function stopQuestion(names: string[]): string | null {
  if (names.length === 0) return null;
  const again = names.length === 1 ? "It starts" : "They start";
  return `Stop ${listed(names)} while this runs? ${again} again when it finishes.`;
}

export function stopConsequence(names: string[]): string | null {
  if (names.length === 0) return null;
  return names.length === 1
    ? "Apps using it get an error until then."
    : "Apps using them get an error until then.";
}

/** `About 6 minutes.` from the preflight's estimate. */
export function estimateLine(seconds: number | null | undefined): string | null {
  if (seconds == null) return null;
  if (seconds < 90) return "About a minute.";
  return `About ${Math.round(seconds / 60)} minutes.`;
}

/** What happened to each model the job stopped, once it ended. */
export function restartLine(restart: MeasurementRestart): string {
  const why = restart.detail ? `: ${restart.detail}` : ".";
  switch (restart.state) {
    case "restarted":
      return `${restart.name} started again.`;
    case "pending":
      return `${restart.name} is stopped while this runs.`;
    case "skipped":
      return `${restart.name} was left stopped, as asked.`;
    case "refused":
      return `${restart.name} was not started again${why}`;
    case "failed":
      return `${restart.name} could not start again${why}`;
  }
  return restart.name;
}

/** The build's phase, in the person's words. */
export function phaseLine(build: ProfileBuild): string {
  switch (build.phase) {
    case "quality":
      return "Measuring how each setting changes answers";
    case "candidates":
      return "Asking llama.cpp where each setting fits";
    case "measuring":
      return "Measuring speed";
    case "confirming":
      return "Loading the best one to check it";
    case "finished":
      return build.state === "completed"
        ? "Finished"
        : build.state === "cancelled"
          ? "Cancelled"
          : "Stopped";
  }
  return build.phase;
}

/** The newest build for this model on this node, the one the page shows. */
export function latestBuildFor(builds: ProfileBuild[], modelId: string): ProfileBuild | null {
  return (
    [...builds]
      .filter((b) => b.modelId === modelId)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0] ?? null
  );
}
