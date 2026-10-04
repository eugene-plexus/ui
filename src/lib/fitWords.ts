/**
 * What a fit verdict says on screen, and what sits where.
 *
 * **One word covered two machines an order of magnitude apart.** The
 * library's `split` means "needs system memory as well as the card", and
 * the UI wrote it as *partial offload* everywhere -- the dense-spill
 * wording. Measured on the same 8 GB budget (moe-aware-fit §0 M2), a
 * 30B-A3B with its experts in system memory decoded at 46.5 tok/s and a
 * dense 27B spilled by whole layers at 4.9. Since A3c the starter set
 * recommends the first of those to a small card, and a recommendation
 * labelled with the second's word reads as a warning about the model it
 * is recommending.
 *
 * `Fit.offload` (specs e318b03) says which kind a split is. So the words
 * follow it:
 * - `experts` -- *experts in RAM*, and a sentence saying the card holds
 *   everything else;
 * - `layers` -- *partial offload*, still the right word for a dense spill;
 * - unset -- *needs RAM too*, because the library could not read the
 *   file's expert share (a catalogue estimate before **check**, or a scan
 *   from before 2026-09-30), and calling that a dense spill would be the
 *   same guess in the other direction.
 *
 * **No speed is predicted, in words or in numbers.** The words say what
 * sits where; the profile builder is what measures how fast. A layer
 * spill still says it runs "more slowly", which is what *partial
 * offload* has always meant here; the experts wording says nothing
 * about speed at all.
 *
 * Pure, no React, so every verdict × offload pair is asserted without a
 * browser -- the same reason `starter.ts` and `home.ts` are.
 */

import type { Fit, FitVerdict } from "./types";
import { expertHint } from "./vocabulary";

/** The fields the words depend on. */
export type FitWords = Pick<Fit, "verdict"> &
  Partial<Pick<Fit, "offload" | "expertBytes" | "requiredBytes" | "budget" | "contextLength">>;

const PLAIN_WORD: Record<Exclude<FitVerdict, "split">, string> = {
  fits: "fits",
  tight: "tight",
  no: "too large",
  unknown: "can't tell",
};

/** The badge word: `fits`, `experts in RAM`, `partial offload`, ... */
export function verdictWord(fit: FitWords): string {
  if (fit.verdict !== "split") return PLAIN_WORD[fit.verdict] ?? fit.verdict;
  if (fit.offload === "experts") return "experts in RAM";
  if (fit.offload === "layers") return "partial offload";
  return "needs RAM too";
}

/**
 * One or two sentences: what the verdict means for this file.
 *
 * Hover text, marked as such: it carries the jargon decision #12 keeps
 * for experts, and the sentence a person reads without hovering is
 * `placementSentence`.
 */
export function verdictMeaning(fit: FitWords): string {
  switch (fit.verdict) {
    case "fits":
      return expertHint("Fits entirely in free GPU memory, fully offloaded.");
    case "tight":
      return expertHint(
        "Would fit on an idle GPU, but something is holding memory right now. Closing it is your call.",
      );
    case "no":
      return expertHint("Larger than this machine's GPU and host memory together.");
    case "unknown":
      return expertHint(
        "There is a graphics card here and nothing on this machine would say how much memory it has, so there is nothing to compare against. Install the card's own tool, or score against a budget you supply.",
      );
    case "split":
      if (fit.offload === "experts")
        return expertHint(
          "A mixture-of-experts model. Its experts sit in system memory and the rest runs on the graphics card.",
        );
      if (fit.offload === "layers")
        return expertHint(
          "Needs host memory as well as GPU memory. Some whole layers run from host memory, so it runs more slowly.",
        );
      return expertHint(
        "Needs host memory as well as GPU memory. Which part goes there is not known until the file is checked.",
      );
  }
  return "";
}

/** What sits where, when the library said how a split would run. */
export type Placement =
  /** Every layer on the card; experts in system memory as far as needed. */
  | { kind: "experts"; cardBytes: number; expertBytes: number }
  /** Whole layers in system memory; `systemBytes` null when the budget is
   * not on the fit, so the overflow cannot be worked out. */
  | { kind: "layers"; systemBytes: number | null };

export function placement(fit: FitWords): Placement | null {
  if (fit.verdict !== "tight" && fit.verdict !== "split") return null;
  const required = fit.requiredBytes ?? 0;
  if (fit.offload === "experts") {
    const experts = fit.expertBytes ?? 0;
    // `offload: experts` is only ever set with the expert share known; a
    // zero here would be a library that broke its own contract, and a
    // sentence built on it would say the experts weigh nothing.
    if (experts <= 0 || required <= experts) return null;
    return { kind: "experts", cardBytes: required - experts, expertBytes: experts };
  }
  if (fit.offload === "layers") {
    const free = fit.budget?.vramFreeBytes ?? 0;
    return { kind: "layers", systemBytes: free > 0 && required > free ? required - free : null };
  }
  return null;
}

/**
 * The placement in words, or null when nothing moves or nobody knows.
 *
 * *Up to* the expert share, because llama.cpp moves only as many experts
 * as the card cannot hold: every expert in system memory is the most it
 * takes, not what it always takes.
 */
export function placementSentence(fit: FitWords): string | null {
  const where = placement(fit);
  if (!where) return null;
  if (where.kind === "experts") {
    return `The card holds everything except the experts: ${formatMemory(where.cardBytes)} with the cache. Up to ${formatMemory(where.expertBytes)} of experts go to system memory.`;
  }
  return where.systemBytes
    ? `About ${formatMemory(where.systemBytes)} does not fit on the card, so some whole layers run from system memory.`
    : "Some whole layers run from system memory.";
}

/**
 * The longest conversation with the experts in system memory, said as the
 * number a profile takes. Null for a dense model, or where the library
 * found the experts do not fit in system memory either.
 *
 * *That way* because it is only ever written straight after
 * `placementSentence`, which has just said what the way is.
 */
export function expertsContextSentence(tokens: number | null | undefined): string | null {
  if (typeof tokens !== "number" || tokens <= 0) return null;
  return `That way it fits up to ${tokens.toLocaleString()} tokens.`;
}

/** `29.3 GiB` — binary, for memory, because that is how VRAM is quoted. */
export function formatMemory(count: number | null | undefined): string {
  if (!count) return "0";
  const gib = count / 1024 ** 3;
  return gib >= 10 ? `${gib.toFixed(1)} GiB` : `${gib.toFixed(2)} GiB`;
}
