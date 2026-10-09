/**
 * The settings builder's words and choices, against REAL builds.
 *
 * The two fixtures are PB1's acceptance runs on this box (a 5090 held to an
 * 8 GB margin, Qwen3-30B-A3B Q4_K_M), as the agent returned them, with the
 * paths scrubbed. They are why the frontier has a precision tiebreak: the
 * Medium build kept f16 and 8-bit at 8,192 both, and a slider over them
 * must not order them by chance.
 */

import { describe, expect, it } from "vitest";

import high from "./__fixtures__/profile-build-high.json";
import medium from "./__fixtures__/profile-build-medium.json";
import {
  ACCURACY_LEVELS,
  DEFAULT_ACCURACY,
  builtFieldLabel,
  builtFieldStates,
  builtFlags,
  builtName,
  builtSpec,
  defaultStop,
  editedSinceBuilt,
  estimateLine,
  frontier,
  latestBuildFor,
  measuredLine,
  phaseLine,
  qualityLine,
  restartLine,
  stopConsequence,
  stopDetail,
  stopLabel,
  stopQuestion,
} from "./profileBuild";
import type { ModelProfile, ProfileBuild } from "./types";

const MEDIUM = medium as unknown as ProfileBuild;
const HIGH = high as unknown as ProfileBuild;

describe("the accuracy levels", () => {
  it("run most faithful first and start at Max (call 3)", () => {
    expect(ACCURACY_LEVELS.map((l) => l.id)).toEqual(["max", "high", "medium", "low"]);
    expect(DEFAULT_ACCURACY).toBe("max");
    // Each promise states the agent's own threshold, never another.
    expect(ACCURACY_LEVELS.find((l) => l.id === "high")?.promise).toContain("96 times in 100");
    expect(ACCURACY_LEVELS.find((l) => l.id === "medium")?.promise).toContain("92 times in 100");
    expect(ACCURACY_LEVELS.find((l) => l.id === "low")?.promise).toContain("88 times in 100");
  });
});

describe("the slider over a real Medium build", () => {
  const stops = frontier(MEDIUM);

  it("rests only on the frontier, shortest first, most precise first at one context", () => {
    expect(stops.map((s) => [s.candidate.contextSize, s.candidate.cacheType])).toEqual([
      [8192, "f16"],
      [8192, "q8_0"],
      [16384, "q8_0"],
      [32768, "q8_0"],
      [65536, "q8_0"],
      [131072, "q8_0"],
      [262144, "q8_0"],
    ]);
  });

  it("starts on the build's own suggestion", () => {
    const at = defaultStop(MEDIUM, stops);
    expect(stops[at]!.index).toBe(MEDIUM.recommended);
    expect(stops[at]!.candidate.contextSize).toBe(65536);
  });

  it("says each stop in tokens and tok/s, with the depth and cache for experts", () => {
    const suggested = stops[defaultStop(MEDIUM, stops)]!.candidate;
    // 39.85 tok/s at the common depth. It said "About 30 words a second ·
    // holds about 101 pages" until Troy's first build (2026-10-01).
    expect(stopLabel(suggested)).toBe("40 tok/s · 65,536 tokens of context");
    expect(stopDetail(suggested)).toBe("39.8 tok/s measured 2,048 tokens deep, 8-bit cache");
  });

  it("says what the chosen cache does to answers, rounded down", () => {
    // 96.324 measured: 96, never a 97 the measurement did not reach.
    expect(qualityLine(MEDIUM, "q8_0")).toBe(
      "Picks the same next token as Max 96 times in 100, on this model.",
    );
    expect(qualityLine(MEDIUM, "f16")).toBe("Answers exactly as this file allows.");
    expect(qualityLine(MEDIUM, "q4_0")).toContain("88 times in 100");
  });

  it("orders one context's stops by precision, whatever order the agent listed them", () => {
    // The agent lists f16 first today, so the real fixture alone cannot
    // tell a precision order from a stable sort.
    const reversed = structuredClone(MEDIUM);
    [reversed.candidates[2], reversed.candidates[3]] = [
      reversed.candidates[3]!,
      reversed.candidates[2]!,
    ];
    expect(
      frontier(reversed)
        .slice(0, 2)
        .map((s) => s.candidate.cacheType),
    ).toEqual(["f16", "q8_0"]);
  });

  it("compares by the common depth, not the empty context", () => {
    // The fixture's two speeds round to the same figure; these do not.
    const candidate = {
      ...MEDIUM.candidates[9]!,
      decodeTokensPerSecond: 60,
      deepDecodeTokensPerSecond: 40,
    };
    expect(stopLabel(candidate)).toContain("40 tok/s");
    expect(stopLabel({ ...candidate, deepDecodeTokensPerSecond: null })).toContain("60 tok/s");
  });

  it("rounds a quality rate down, never up", () => {
    const rounded = structuredClone(MEDIUM);
    rounded.quality[0]!.sameTopTokenPercent = 97.6;
    expect(qualityLine(rounded, "q8_0")).toContain("97 times in 100");
  });

  it("does not rest on a candidate that failed to load when confirmed", () => {
    const broken = structuredClone(MEDIUM);
    broken.candidates[9]!.confirmed = false;
    expect(frontier(broken).some((s) => s.index === 9)).toBe(false);
    // With its suggestion gone, the slider starts at the longest left.
    const left = frontier(broken);
    expect(defaultStop(broken, left)).toBe(left.length - 1);
  });
});

describe("saving a real High build", () => {
  const stop = frontier(HIGH)[defaultStop(HIGH, frontier(HIGH))]!;

  it("sets only the builder's flags, never gpuLayers", () => {
    expect(builtFlags(stop.candidate, HIGH.memoryMarginMiB)).toEqual({
      contextSize: 32768,
      cacheType: "f16",
      memoryMargin: 23499,
    });
    // A quantised cache needs flash attention for its V half.
    const eight = frontier(MEDIUM).find((s) => s.candidate.cacheType === "q8_0")!;
    expect(builtFlags(eight.candidate, null)).toEqual({
      contextSize: 8192,
      cacheType: "q8_0",
      flashAttention: "on",
    });
  });

  it("keeps the base profile's other settings and drops its placement", () => {
    const base = {
      id: "p1",
      name: "default",
      default: true,
      engine: "llama_cpp",
      flags: { contextSize: 4096, gpuLayers: 99, threads: 8, flashAttention: true },
      extraArgs: ["--jinja"],
      env: { CUDA_VISIBLE_DEVICES: "0" },
      maxTokens: 400,
      temperature: 0.7,
    } as ModelProfile;
    const spec = builtSpec({
      base,
      build: HIGH,
      candidate: stop.candidate,
      name: "Built for Amish_Station",
      replacing: false,
    });
    expect(spec.flags).toEqual({
      threads: 8,
      contextSize: 32768,
      cacheType: "f16",
      memoryMargin: 23499,
    });
    expect(spec).toMatchObject({
      name: "Built for Amish_Station",
      engine: "llama_cpp",
      default: false,
      extraArgs: ["--jinja"],
      env: { CUDA_VISIBLE_DEVICES: "0" },
      maxTokens: 400,
      temperature: 0.7,
    });
    // Replacing keeps the base's default flag.
    expect(
      builtSpec({ base, build: HIGH, candidate: stop.candidate, name: "x", replacing: true })
        .default,
    ).toBe(true);
  });

  it("records what was measured, on which machine", () => {
    const spec = builtSpec({
      base: null,
      build: HIGH,
      candidate: stop.candidate,
      name: builtName(HIGH.node),
      replacing: false,
    });
    expect(spec.name).toBe("Built for Amish_Station");
    expect(spec.builtBy).toMatchObject({
      buildId: HIGH.id,
      node: "Amish_Station",
      accuracy: "high",
      builtAt: HIGH.finishedAt,
      engineVersion: "11215",
      flags: { contextSize: 32768, cacheType: "f16", memoryMargin: 23499 },
      deepDepth: 2048,
      // f16 was chosen: nothing that changes answers was set.
      sameTopTokenPercent: null,
      evaluationSource: "bundled",
    });
    expect(spec.builtBy!.decodeTokensPerSecond).toBeCloseTo(41.216, 2);
  });

  it("records the quality of a quantised choice", () => {
    const stops = frontier(MEDIUM);
    const spec = builtSpec({
      base: null,
      build: MEDIUM,
      candidate: stops[defaultStop(MEDIUM, stops)]!.candidate,
      name: "x",
      replacing: false,
    });
    expect(spec.builtBy!.sameTopTokenPercent).toBeCloseTo(96.324, 3);
  });
});

describe("a built profile, read back", () => {
  const built = builtSpec({
    base: null,
    build: MEDIUM,
    candidate: frontier(MEDIUM)[4]!.candidate,
    name: "Built for Amish_Station",
    replacing: false,
  });
  const profile = { ...built, id: "p", default: false } as ModelProfile;

  it("says which fields the builder set, and when", () => {
    expect(builtFieldStates(profile)).toEqual({
      contextSize: "built",
      cacheType: "built",
      flashAttention: "built",
      memoryMargin: "built",
    });
    expect(editedSinceBuilt(profile)).toBe(false);
    expect(builtFieldLabel(profile.builtBy!, "built")).toMatch(
      /^Set by the settings builder on .+\.$/,
    );
  });

  it("marks a field edited since, and the numbers as no longer describing it", () => {
    const edited = { ...profile, flags: { ...profile.flags, contextSize: 16384 } };
    expect(builtFieldStates(edited).contextSize).toBe("edited");
    expect(editedSinceBuilt(edited)).toBe(true);
    expect(builtFieldLabel(edited.builtBy!, "edited")).toContain("and edited since");
    expect(measuredLine(edited)).toContain("before this profile was edited");
    expect(measuredLine(edited)).toContain("may no longer describe it");
  });

  it("counts gpuLayers set by hand as an edit: it takes placement away from fit", () => {
    expect(editedSinceBuilt({ ...profile, flags: { ...profile.flags, gpuLayers: 20 } })).toBe(true);
  });

  it("says what was measured while it still describes the profile", () => {
    expect(measuredLine(profile)).toBe(
      "Measured on Amish_Station: 40 tok/s, 65,536 tokens of context. Same next token as Max 96 times in 100.",
    );
    expect(measuredLine({ ...profile, builtBy: null })).toBeNull();
  });
});

describe("asking before stopping", () => {
  it("names exactly what would stop, and says it comes back", () => {
    expect(stopQuestion([])).toBeNull();
    expect(stopQuestion(["qwen3-14b"])).toBe(
      "Stop qwen3-14b while this runs? It starts again when it finishes.",
    );
    expect(stopQuestion(["a", "b", "c"])).toBe(
      "Stop a, b and c while this runs? They start again when it finishes.",
    );
    expect(stopConsequence(["a"])).toBe("Apps using it get an error until then.");
    expect(stopConsequence(["a", "b"])).toBe("Apps using them get an error until then.");
  });

  it("says the estimate plainly", () => {
    expect(estimateLine(null)).toBeNull();
    expect(estimateLine(45)).toBe("About a minute.");
    expect(estimateLine(400)).toBe("About 7 minutes.");
  });

  it("says what came back after the job, by name", () => {
    expect(restartLine(HIGH.restarts[0]!)).toBe("busy started again.");
    expect(restartLine({ name: "q", state: "refused", detail: "It would not fit" })).toBe(
      "q was not started again: It would not fit",
    );
    expect(restartLine({ name: "q", state: "skipped" })).toBe("q was left stopped, as asked.");
  });
});

describe("the build the page shows", () => {
  it("is the newest for this model", () => {
    const older = { ...MEDIUM, id: "old", startedAt: "2026-09-29T10:00:00Z" };
    const other = { ...HIGH, id: "other", modelId: "another-model" };
    expect(latestBuildFor([older, MEDIUM, other], MEDIUM.modelId)?.id).toBe(MEDIUM.id);
    expect(latestBuildFor([other], MEDIUM.modelId)).toBeNull();
  });

  it("says its phase in plain words", () => {
    expect(phaseLine(MEDIUM)).toBe("Finished");
    expect(phaseLine({ ...MEDIUM, state: "running", phase: "measuring" })).toBe("Measuring speed");
    expect(phaseLine({ ...MEDIUM, state: "cancelled" })).toBe("Cancelled");
  });
});
