"use client";

import { useState } from "react";

import {
  expertsContextSentence,
  formatMemory,
  placementSentence,
  verdictMeaning,
  verdictWord,
} from "@/lib/fitWords";
import { contextLabel } from "@/lib/starter";
import { ENGINE_FIT_CLASS, ENGINE_FIT_WORD, type EngineFit } from "@/lib/eligibility";
import type { Fit, FitVerdict, MemoryBudget } from "@/lib/types";

export { formatMemory };

/**
 * A fit verdict, and the arithmetic behind it on demand.
 *
 * Differentiator #6 is "show *why*". A bare badge would be the thing the
 * source complaint is complaining about — someone else's opinion with no
 * working shown — so every badge opens into the terms it was computed
 * from, and `basis` says outright whether those terms are the model's
 * own declared shape or a guess with a number on it.
 *
 * Five verdicts rather than a percentage, because a percentage *of what*
 * — VRAM, or VRAM plus RAM? — is exactly the ambiguity the operator is
 * trying to resolve, and they have different advice.
 *
 * `unknown` is the fifth, added 2026-09-18 (roadmap R2.3, review §6.2
 * #28): there is a graphics card here and no vendor tool would say how
 * much memory it has, so no comparison against it can be made. It has
 * to read as *we cannot tell*, never as a qualified yes — the defect it
 * replaces told a 16 GB Arc owner that a 30 GB model fits, which is an
 * out-of-memory error at load rather than a slow answer.
 *
 * **`split` is two words since A3c**, because `Fit.offload` says which
 * kind it is: *experts in RAM* for a mixture-of-experts model that keeps
 * every layer on the card, *partial offload* for a dense spill. The words
 * live in `lib/fitWords.ts`, so the badge, the starter set and the
 * Library's panel cannot drift apart.
 */

const VERDICT_CLASS: Record<FitVerdict, string> = {
  fits: "status-success",
  tight: "status-warn",
  split: "status-warn",
  no: "status-error",
  // Deliberately neither the green one nor the red one: the model is
  // not refused, the machine is unmeasured.
  unknown: "status-warn",
};

/**
 * `withContext` writes the context into the badge — `fits at 32k`.
 *
 * Off by default because in a table of twenty-five candidates every row
 * is scored at the same number and repeating it twenty-five times is
 * noise; the column header names it once instead. On wherever a verdict
 * stands alone — a recommendation, a starter card — because there the
 * bare word reads as a property of the model when it is a property of
 * the model *and a number the person can change*, which is what §0
 * measured: the context was a tooltip away from the verdict it decided.
 */
export function FitBadge({
  fit,
  compact = false,
  withContext = false,
  expertsContext = null,
}: {
  fit: Fit;
  compact?: boolean;
  withContext?: boolean;
  /** `maxContextExpertsInRam`, where the caller has one. */
  expertsContext?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const word = verdictWord(fit);
  const label = withContext ? `${word} at ${contextLabel(fit.contextLength)}` : word;

  if (compact) {
    return (
      <span
        data-testid="fit-badge"
        className={`${VERDICT_CLASS[fit.verdict]} font-ui badge rounded-[var(--radius)] border px-1.5 py-0.5 text-[0.625rem] tracking-wide uppercase`}
        data-offload={fit.offload ?? undefined}
        title={`${verdictMeaning(fit)} Needs ${formatBytes(fit.requiredBytes)} at ${fit.contextLength.toLocaleString()} tokens.`}
      >
        {label}
      </span>
    );
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        data-testid="fit-badge"
        data-offload={fit.offload ?? undefined}
        title={verdictMeaning(fit)}
        onClick={() => setOpen((v) => !v)}
        className={`${VERDICT_CLASS[fit.verdict]} font-ui badge gap-1.5 rounded-[var(--radius)] border px-2 py-0.5 text-[0.6875rem] tracking-wide uppercase`}
        aria-expanded={open}
      >
        {label}
        <span className="opacity-60">{open ? "▾" : "▸"}</span>
      </button>
      {open && <FitBreakdown fit={fit} expertsContext={expertsContext} />}
    </div>
  );
}

/**
 * The arithmetic behind a verdict, and where the bytes go.
 *
 * `expertsContext` is `maxContextExpertsInRam` where the caller has it
 * (a model on disk, a starter entry); a catalogue candidate's fit does
 * not carry one. `withPlacement` is off where the caller already says
 * what sits where in its own words, as the Library's panel does.
 */
export function FitBreakdown({
  fit,
  expertsContext = null,
  withPlacement = true,
}: {
  fit: Fit;
  expertsContext?: number | null;
  withPlacement?: boolean;
}) {
  const where = withPlacement ? placementSentence(fit) : null;
  const longest = fit.offload === "experts" ? expertsContextSentence(expertsContext) : null;
  const rows: [string, string][] = [
    ["weights", formatBytes(fit.weightsBytes)],
    [
      fit.attentionLayers
        ? `KV cache (${fit.contextLength.toLocaleString()} tokens, ${fit.attentionLayers} attention layers, ${fit.kvCacheType ?? "f16"})`
        : `KV cache (${fit.contextLength.toLocaleString()} tokens)`,
      formatBytes(fit.kvCacheBytes),
    ],
    ["compute buffers and context", formatBytes(fit.overheadBytes)],
    ["total needed", formatBytes(fit.requiredBytes)],
  ];

  return (
    <div className="space-y-2 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm">
      <dl className="space-y-0.5">
        {rows.map(([label, value], index) => (
          <div
            key={label}
            className={
              index === rows.length - 1
                ? "flex justify-between gap-4 border-t border-[color:var(--border)] pt-0.5 font-semibold"
                : "flex justify-between gap-4"
            }
          >
            <dt className="text-[color:var(--muted)]">{label}</dt>
            <dd className="font-mono-ui tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {where && (
        <p data-testid="fit-placement">
          {where}
          {longest && <> {longest}</>}
        </p>
      )}

      {fit.budget && <BudgetLine budget={fit.budget} />}

      <p className="text-[color:var(--muted)]">
        {fit.basis === "metadata" ? (
          <>Computed from this model&rsquo;s own declared shape.</>
        ) : (
          <>
            <span className="text-status-warn">Estimated.</span> The model lacks the layer and
            attention counts needed for a precise cache size. We estimate it from weight size and
            context length.
          </>
        )}
      </p>

      {(fit.notes ?? []).length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-[color:var(--muted)]">
          {(fit.notes ?? []).map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What the verdict was measured against.
 *
 * Free *and* total, because free is what decides the verdict and total
 * is what tells you what quitting something would buy back. On an idle
 * desktop nearly 3 GiB of a 32 GiB card is already gone.
 */
export function BudgetLine({ budget }: { budget: MemoryBudget }) {
  const gpus = budget.gpuCount ?? 0;
  // **A card counted with no bytes is not a card with no memory.** The
  // library reports `vramTotalBytes: 0` for a GPU whose size no vendor
  // tool would state, and this line rendered that as "measured against
  // 0 B free of 0 B on the GPU" — printed beside the word `fits`, which
  // is review §6.2 #28 in one sentence.
  const unmeasured = gpus > 0 && !(budget.vramTotalBytes ?? 0);
  return (
    <p className="text-[color:var(--muted)]">
      {unmeasured ? (
        <>
          {gpus === 1 ? "a graphics card is" : `${gpus} graphics cards are`} here and its memory
          could not be read — nothing on this machine would say how much it has
        </>
      ) : gpus > 0 ? (
        <>
          measured against {formatBytes(budget.vramFreeBytes)} free of{" "}
          {formatBytes(budget.vramTotalBytes)} on {gpus === 1 ? "the GPU" : `${gpus} GPUs`}
          {gpus > 1 && <> (largest single card: {formatBytes(budget.largestGpuFreeBytes)} free)</>}
          {budget.unifiedMemory && <>, memory it shares with the rest of the machine</>}
        </>
      ) : (
        <>
          no GPU detected — measured against {formatBytes(budget.ramAvailableBytes)} of available
          host memory
        </>
      )}
      {budget.source === "override" && <> · a budget you supplied, not this machine&rsquo;s</>}
    </p>
  );
}

/** `16.46 GB` — decimal, because that is what publishers quote sizes in. */
export function formatBytes(count: number | null | undefined): string {
  if (!count) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log10(count) / 3), units.length - 1);
  if (index === 0) return `${count} B`;
  return `${(count / 1000 ** index).toFixed(2)} ${units[index]}`;
}

/**
 * One engine's own fit, named (LS6, Troy's L11): for an engine whose fit is
 * not the Library's arithmetic (Strata's own table, vLLM's share), or that
 * has none. The engine's reason is on hover; *not estimated* says so,
 * never a number from another engine.
 */
export function EngineFitBadge({ engine, fit }: { engine: string; fit: EngineFit }) {
  if (!fit.estimated || !fit.verdict) {
    return (
      <span
        data-testid="engine-fit-badge"
        className="font-ui text-[0.6875rem] text-[color:var(--muted)]"
        title={fit.reason}
      >
        {engine}: not estimated
      </span>
    );
  }
  return (
    <span
      data-testid="engine-fit-badge"
      className={`${ENGINE_FIT_CLASS[fit.verdict]} font-ui rounded px-1 text-[0.6875rem]`}
      title={fit.reason}
    >
      {engine}: {ENGINE_FIT_WORD[fit.verdict]}
      {fit.approximate ? " (approx.)" : ""}
    </span>
  );
}
