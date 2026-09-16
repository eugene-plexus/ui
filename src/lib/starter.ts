/**
 * What the starter set says on screen, and how a context length is written.
 *
 * Hobbyist UX §6.3 and §6.5. Discovery answers "which version of this
 * model" once you have a model; nothing answered "which model", and a
 * person with no candidate cannot use a search box. The starter set is
 * that answer, and this module is the half of it that is words.
 *
 * Pure, no fetching, no React, for the same reason `home.ts` is: the
 * states a 32 GB card, a laptop, a CPU-only box and a stale list each
 * produce are worth asserting without a browser.
 *
 * **The context is written beside every verdict.** §0's measurement was
 * that the badge reads a bare `fits` while the context it was scored at
 * sits in a tooltip -- so the verdict looks like a property of the model
 * when it is a property of the model *and a number the person can
 * change*. `fitLabel` is why the badge can say `fits at 32k`.
 */

import type { Fit, StarterModel, StarterSet } from "./types";

/** `32k`, `262k`, `4,096`. Powers of two get the short form because that
 * is how everyone writes them; anything else keeps its digits, since a
 * rounded `75k` for 75,520 would be a number nobody could type back. */
export function contextLabel(tokens: number): string {
  if (tokens >= 1024 && tokens % 1024 === 0) return `${tokens / 1024}k`;
  return tokens.toLocaleString();
}

const VERDICT_WORD: Record<string, string> = {
  fits: "fits",
  tight: "tight",
  split: "partial offload",
  no: "too large",
};

/** `fits at 32k` — the verdict and the number it depends on, together. */
export function fitLabel(fit: Fit | null | undefined): string {
  if (!fit) return "unknown";
  const word = VERDICT_WORD[fit.verdict] ?? fit.verdict;
  return `${word} at ${contextLabel(fit.contextLength)}`;
}

/** `16 Sep 2026`. The date a person judges a recommendation by. */
export function reviewedOn(set: StarterSet | null): string | null {
  if (!set?.reviewed) return null;
  const parsed = new Date(`${set.reviewed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Past the window a release is allowed. Thirty days, the same number the
 * library uses and the release checklist enforces — said on screen
 * rather than only logged, because the person reading a recommendation
 * about a field that moves monthly is the one who can judge it.
 */
export const STALE_AFTER_DAYS = 30;

export function isStale(set: StarterSet | null): boolean {
  return (set?.reviewedDaysAgo ?? 0) > STALE_AFTER_DAYS;
}

/** The entry the set recommends, resolved against its own list. */
export function recommendedModel(set: StarterSet | null): StarterModel | null {
  const wanted = set?.recommended?.sizeClass;
  if (!set || !wanted) return null;
  return (set.models ?? []).find((m) => m.sizeClass === wanted) ?? null;
}

/**
 * The whole set, largest first — which is the order someone scanning for
 * "the biggest one I can run" reads in, and puts the recommendation near
 * the top without the list pretending to be ranked by quality.
 */
export function orderedModels(set: StarterSet | null): StarterModel[] {
  return [...(set?.models ?? [])].sort((a, b) => b.sizeBytes - a.sizeBytes);
}

/** `Qwen3.5-4B` — the model's own name without the publisher, which is
 * what a person recognises and what fits on a card. */
export function shortName(baseModel: string): string {
  return baseModel.split("/").pop() ?? baseModel;
}

/** `2.74 GB` for a download, decimal, because that is what publishers
 * quote and what the person will watch tick up. */
export function downloadSize(bytes: number): string {
  return `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)} GB`;
}
