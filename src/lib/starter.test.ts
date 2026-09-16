import { describe, expect, it } from "vitest";

import {
  contextLabel,
  downloadSize,
  fitLabel,
  isStale,
  orderedModels,
  recommendedModel,
  reviewedOn,
  shortName,
} from "./starter";
import type { Fit, StarterSet } from "./types";

function fit(verdict: Fit["verdict"], contextLength: number): Fit {
  return {
    verdict,
    requiredBytes: 1,
    weightsBytes: 1,
    kvCacheBytes: 1,
    overheadBytes: 1,
    contextLength,
    basis: "metadata",
  } as Fit;
}

function model(sizeClass: string, sizeBytes: number) {
  return {
    sizeClass,
    baseModel: `Vendor/Model-${sizeClass}`,
    repo: `pub/Model-${sizeClass}-GGUF`,
    file: "m.gguf",
    label: "Q4_K_M",
    sizeBytes,
    why: "most downloaded",
  };
}

const SET = {
  reviewed: "2026-09-16",
  reviewedDaysAgo: 0,
  source: "shipped",
  engine: "llama_cpp b10999",
  models: [model("4B", 2e9), model("30B", 16e9), model("8B", 5e9)],
  recommended: { sizeClass: "30B", reason: "because" },
} as unknown as StarterSet;

describe("contextLabel", () => {
  it("writes powers of two the way people write them", () => {
    expect(contextLabel(32768)).toBe("32k");
    expect(contextLabel(262144)).toBe("256k");
    expect(contextLabel(4096)).toBe("4k");
  });

  it("keeps the digits of a number that is not a round multiple", () => {
    // 75,520 is what `maxContextLength` hands back, and it goes into a
    // profile's `-c`. A rounded `75k` would be a number nobody can type.
    expect(contextLabel(75520)).toBe("75,520");
    expect(contextLabel(512)).toBe("512");
  });
});

describe("fitLabel", () => {
  it("names the context the verdict depends on", () => {
    // §0: the badge read a bare `fits` while the context sat in a
    // tooltip, so the verdict looked like a property of the model rather
    // than of the model and a number the person can change.
    expect(fitLabel(fit("fits", 32768))).toBe("fits at 32k");
    expect(fitLabel(fit("split", 131072))).toBe("partial offload at 128k");
    expect(fitLabel(fit("no", 8192))).toBe("too large at 8k");
  });

  it("says unknown rather than inventing a verdict", () => {
    expect(fitLabel(null)).toBe("unknown");
    expect(fitLabel(undefined)).toBe("unknown");
  });
});

describe("reviewedOn", () => {
  it("renders the date a person judges the recommendation by", () => {
    expect(reviewedOn(SET)).toContain("2026");
  });

  it("is null rather than Invalid Date for a broken value", () => {
    expect(reviewedOn({ ...SET, reviewed: "not-a-date" } as StarterSet)).toBeNull();
    expect(reviewedOn(null)).toBeNull();
  });
});

describe("isStale", () => {
  it("is true past the window a release is allowed", () => {
    expect(isStale({ ...SET, reviewedDaysAgo: 31 } as StarterSet)).toBe(true);
    expect(isStale({ ...SET, reviewedDaysAgo: 30 } as StarterSet)).toBe(false);
  });

  it("treats a missing count as fresh rather than as stale", () => {
    // An older library that does not send the field must not paint every
    // install with a staleness warning it cannot substantiate.
    expect(isStale({ ...SET, reviewedDaysAgo: undefined } as StarterSet)).toBe(false);
  });
});

describe("recommendedModel", () => {
  it("resolves the recommendation against the list", () => {
    expect(recommendedModel(SET)?.sizeClass).toBe("30B");
  });

  it("is null when nothing fits, which is a recommendation with no class", () => {
    const nothing = { ...SET, recommended: { reason: "none of these fits" } } as StarterSet;
    expect(recommendedModel(nothing)).toBeNull();
  });

  it("is null for an empty set", () => {
    expect(recommendedModel(null)).toBeNull();
    expect(
      recommendedModel({ ...SET, models: [], recommended: undefined } as StarterSet),
    ).toBeNull();
  });
});

describe("orderedModels", () => {
  it("is largest first, which is how someone scans for the biggest they can run", () => {
    expect(orderedModels(SET).map((m) => m.sizeClass)).toEqual(["30B", "8B", "4B"]);
  });

  it("does not mutate the set it was given", () => {
    const before = SET.models.map((m) => m.sizeClass);
    orderedModels(SET);
    expect(SET.models.map((m) => m.sizeClass)).toEqual(before);
  });
});

describe("shortName", () => {
  it("drops the publisher, which is not what a person recognises", () => {
    expect(shortName("Qwen/Qwen3.5-4B")).toBe("Qwen3.5-4B");
    expect(shortName("no-slash")).toBe("no-slash");
  });
});

describe("downloadSize", () => {
  it("is decimal, because that is what the progress bar will count", () => {
    expect(downloadSize(2_740_937_888)).toBe("2.7 GB");
    expect(downloadSize(16_464_440_224)).toBe("16 GB");
  });
});
