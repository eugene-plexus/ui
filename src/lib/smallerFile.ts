/**
 * Low's second lever: a smaller file of the same model, offered after a
 * build (A3d, `docs/design/moe-aware-fit.md` §6 and call C).
 *
 * The builder tunes the settings a file allows; it never changes the file.
 * At Low, when the file on disk does not fit entirely on the card at the
 * context the person chose, a smaller quant from the same repository might,
 * and that is worth one sentence and a Download button. It is never
 * automatic: the builder runs on demand only (Troy), so the rebuild is a
 * press the person makes once the file lands.
 *
 * Pure, no fetching, for the reason the other word modules are.
 */

import { contextLabel } from "./starter";
import type { CatalogueCandidate, Download, Fit } from "./types";

/**
 * Where a model on disk came from: its own finished download names the
 * entry it produced (`Download.modelId`) and the repository. A file copied
 * in by hand has none, and the page says so rather than guessing a
 * repository from a file name.
 */
export function originOf(
  downloads: Download[],
  modelId: string,
): { repo: string; revision: string | null } | null {
  const found = downloads
    .filter((d) => d.state === "done" && d.modelId === modelId && d.repo)
    .sort((a, b) => Date.parse(b.finishedAt ?? "") - Date.parse(a.finishedAt ?? ""))[0];
  if (!found) return null;
  return { repo: found.repo, revision: found.resolvedCommit ?? found.revision ?? null };
}

/**
 * The room a smaller file of this model has on the card: free graphics
 * memory less the cache and overhead the file on disk needs at the chosen
 * context and cache type.
 *
 * **Quants of one model share its shape, so they share its cache.** Only
 * the weights differ. So the file on disk's own fit, which the library
 * computed from its real layers and heads, is the arithmetic for every
 * quant in its repository. The catalogue's own verdicts are NOT used: a
 * candidate that has not been read is scored from its size alone, and at
 * a long context that guess is far off -- on an 8 GB card at 64k it called
 * the 18.56 GB Q4_K_M "no", the file PB1 had just run there with its
 * experts in system memory (2026-09-30).
 */
export function roomForWeights(fit: Fit): number | null {
  const free = fit.budget?.vramFreeBytes;
  const { kvCacheBytes: cache, overheadBytes: overhead } = fit;
  // Any term missing is "cannot say", never zero: a zero cache would make
  // every smaller file look like it fits.
  if (!free || free <= 0 || cache == null || overhead == null) return null;
  return free - cache - overhead;
}

/**
 * The largest candidate smaller than the file on disk whose weights fit in
 * that room, so the whole model sits on the card. Null when none does:
 * then no smaller version of this model helps here, or the machine's
 * memory is not on the fit to say.
 */
export function pickSmaller(
  candidates: CatalogueCandidate[],
  fit: Fit,
  currentBytes: number,
): CatalogueCandidate | null {
  const room = roomForWeights(fit);
  if (room === null || room <= 0) return null;
  return (
    candidates
      .filter((c) => c.sizeBytes < currentBytes && c.sizeBytes <= room)
      .sort((a, b) => b.sizeBytes - a.sizeBytes)[0] ?? null
  );
}

/** `12.9 GB`, decimal, as the download is quoted. */
function size(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

export function offerLine(candidate: CatalogueCandidate, contextLength: number): string {
  return `A smaller version, ${candidate.label} (${size(candidate.sizeBytes)}), fits entirely on the card at ${contextLabel(contextLength)}.`;
}

/** Said beside every offer: the builder measured the settings, not the file. */
export const SMALLER_CAVEAT =
  "A smaller file changes answers more than any memory setting, and the builder does not measure how much.";

export function noneLine(contextLength: number): string {
  return `No smaller version of this model fits entirely on the card at ${contextLabel(contextLength)}.`;
}

export const UNKNOWN_ORIGIN =
  "A smaller version might fit entirely on the card. This file was not downloaded here, so Discover is where to look for one.";
