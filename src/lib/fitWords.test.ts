import { describe, expect, it } from "vitest";

import {
  expertsContextSentence,
  placement,
  placementSentence,
  verdictMeaning,
  verdictWord,
  type FitWords,
} from "./fitWords";

const GIB = 1024 ** 3;

/** The A3c case: a 30B-A3B on an 8 GB card, its experts in system memory. */
const EXPERTS: FitWords = {
  verdict: "split",
  offload: "experts",
  requiredBytes: 23 * GIB,
  expertBytes: 18.3 * GIB,
  budget: { vramFreeBytes: 7.5 * GIB } as FitWords["budget"],
};

/** A dense 27B on the same card, spilled by whole layers. */
const LAYERS: FitWords = {
  verdict: "split",
  offload: "layers",
  requiredBytes: 17 * GIB,
  expertBytes: 0,
  budget: { vramFreeBytes: 7.5 * GIB } as FitWords["budget"],
};

describe("verdictWord", () => {
  it("gives a split one word per kind, and a neutral one when nobody knows", () => {
    expect(verdictWord(EXPERTS)).toBe("experts in RAM");
    expect(verdictWord(LAYERS)).toBe("partial offload");
    // A catalogue estimate before the file is checked, or a scan from
    // before the tensor table was read: calling it a dense spill would be
    // a guess in the other direction.
    expect(verdictWord({ verdict: "split" })).toBe("needs RAM too");
    expect(verdictWord({ verdict: "split", offload: null })).toBe("needs RAM too");
  });

  it("leaves the other four verdicts as they were", () => {
    expect(verdictWord({ verdict: "fits" })).toBe("fits");
    expect(verdictWord({ verdict: "tight", offload: "experts" })).toBe("tight");
    expect(verdictWord({ verdict: "no" })).toBe("too large");
    expect(verdictWord({ verdict: "unknown" })).toBe("can't tell");
  });
});

describe("verdictMeaning", () => {
  it("never tells a mixture-of-experts split that it runs more slowly", () => {
    // No speed is predicted for the experts way; the builder measures it.
    expect(verdictMeaning(EXPERTS)).toContain("experts sit in system memory");
    expect(verdictMeaning(EXPERTS)).not.toMatch(/slow/i);
    expect(verdictMeaning(LAYERS)).toContain("more slowly");
    expect(verdictMeaning({ verdict: "split" })).toContain("not known until the file is checked");
  });
});

describe("placement", () => {
  it("puts everything but the experts on the card", () => {
    expect(placement(EXPERTS)).toEqual({
      kind: "experts",
      cardBytes: 23 * GIB - 18.3 * GIB,
      expertBytes: 18.3 * GIB,
    });
  });

  it("works out a dense spill from the free memory on the fit", () => {
    expect(placement(LAYERS)).toEqual({ kind: "layers", systemBytes: 9.5 * GIB });
    // No budget on the fit: the kind is known, the amount is not.
    expect(placement({ ...LAYERS, budget: undefined })).toEqual({
      kind: "layers",
      systemBytes: null,
    });
  });

  it("says nothing where nothing moves, or where nobody knows what would", () => {
    expect(placement({ ...EXPERTS, verdict: "fits" })).toBeNull();
    expect(placement({ ...EXPERTS, verdict: "no" })).toBeNull();
    expect(placement({ verdict: "split", requiredBytes: 9 * GIB })).toBeNull();
    // A library that set `experts` with no expert share broke its own
    // contract; a sentence saying the experts weigh nothing would be worse.
    expect(placement({ ...EXPERTS, expertBytes: 0 })).toBeNull();
    expect(placement({ ...EXPERTS, expertBytes: null })).toBeNull();
  });

  it("describes a tight verdict too, since it would run that way right now", () => {
    expect(placement({ ...EXPERTS, verdict: "tight" })?.kind).toBe("experts");
  });
});

describe("placementSentence", () => {
  it("says what sits where, with the sizes", () => {
    expect(placementSentence(EXPERTS)).toBe(
      "The card holds everything except the experts: 4.70 GiB with the cache. Up to 18.3 GiB of experts go to system memory.",
    );
    expect(placementSentence(LAYERS)).toBe(
      "About 9.50 GiB does not fit on the card, so some whole layers run from system memory.",
    );
    expect(placementSentence({ ...LAYERS, budget: undefined })).toBe(
      "Some whole layers run from system memory.",
    );
    expect(placementSentence({ verdict: "fits" })).toBeNull();
  });
});

describe("expertsContextSentence", () => {
  it("offers the number a profile takes, and nothing without one", () => {
    expect(expertsContextSentence(61440)).toBe("That way it fits up to 61,440 tokens.");
    expect(expertsContextSentence(null)).toBeNull();
    expect(expertsContextSentence(undefined)).toBeNull();
    expect(expertsContextSentence(0)).toBeNull();
  });
});
