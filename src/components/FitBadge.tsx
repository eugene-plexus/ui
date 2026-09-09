"use client";

import { useState } from "react";

import type { Fit, FitVerdict, MemoryBudget } from "@/lib/types";

/**
 * A fit verdict, and the arithmetic behind it on demand.
 *
 * Differentiator #6 is "show *why*". A bare badge would be the thing the
 * source complaint is complaining about — someone else's opinion with no
 * working shown — so every badge opens into the terms it was computed
 * from, and `basis` says outright whether those terms are the model's
 * own declared shape or a guess with a number on it.
 *
 * Four verdicts rather than a percentage, because a percentage *of what*
 * — VRAM, or VRAM plus RAM? — is exactly the ambiguity the operator is
 * trying to resolve, and the four have different advice.
 */

const VERDICT_LABEL: Record<FitVerdict, string> = {
  fits: "fits",
  tight: "tight",
  split: "partial offload",
  no: "too large",
};

const VERDICT_CLASS: Record<FitVerdict, string> = {
  fits: "status-success",
  tight: "status-warn",
  split: "status-warn",
  no: "status-error",
};

const VERDICT_MEANING: Record<FitVerdict, string> = {
  fits: "Fits entirely in free GPU memory, fully offloaded.",
  tight:
    "Would fit on an idle GPU, but something is holding memory right now. Closing it is your call.",
  split:
    "Needs host memory as well as GPU memory. It will run, and generation will be materially slower.",
  no: "Larger than this machine's GPU and host memory together.",
};

export function FitBadge({ fit, compact = false }: { fit: Fit; compact?: boolean }) {
  const [open, setOpen] = useState(false);

  if (compact) {
    return (
      <span
        className={`${VERDICT_CLASS[fit.verdict]} font-ui rounded-[var(--radius)] border px-1.5 py-0.5 text-[10px] tracking-wide uppercase`}
        title={`${VERDICT_MEANING[fit.verdict]} Needs ${formatBytes(fit.requiredBytes)} at ${fit.contextLength.toLocaleString()} tokens.`}
      >
        {VERDICT_LABEL[fit.verdict]}
      </span>
    );
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${VERDICT_CLASS[fit.verdict]} font-ui inline-flex items-center gap-1.5 rounded-[var(--radius)] border px-2 py-0.5 text-[11px] tracking-wide uppercase`}
        aria-expanded={open}
      >
        {VERDICT_LABEL[fit.verdict]}
        <span className="opacity-60">{open ? "▾" : "▸"}</span>
      </button>
      {open && <FitBreakdown fit={fit} />}
    </div>
  );
}

export function FitBreakdown({ fit }: { fit: Fit }) {
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
    <div className="space-y-2 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-xs">
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

      {fit.budget && <BudgetLine budget={fit.budget} />}

      <p className="text-[color:var(--muted)]">
        {fit.basis === "metadata" ? (
          <>Computed from this model&rsquo;s own declared shape.</>
        ) : (
          <>
            <span className="text-status-warn">Estimated.</span> The KV-cache figure is a rough
            fraction of the weights, because the layer and attention counts were not available.
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
  return (
    <p className="text-[color:var(--muted)]">
      {gpus > 0 ? (
        <>
          measured against {formatBytes(budget.vramFreeBytes)} free of{" "}
          {formatBytes(budget.vramTotalBytes)} on {gpus === 1 ? "the GPU" : `${gpus} GPUs`}
          {gpus > 1 && <> (largest single card: {formatBytes(budget.largestGpuFreeBytes)} free)</>}
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

/** `29.3 GiB` — binary, for memory, because that is how VRAM is quoted. */
export function formatMemory(count: number | null | undefined): string {
  if (!count) return "0";
  const gib = count / 1024 ** 3;
  return gib >= 10 ? `${gib.toFixed(1)} GiB` : `${gib.toFixed(2)} GiB`;
}
