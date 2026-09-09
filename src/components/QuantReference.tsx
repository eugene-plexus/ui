"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { QuantTable, QuantTier } from "@/lib/types";

/**
 * "Q3_K_S vs Q2_K_M? No one knows." — this is the answer.
 *
 * Served from the library rather than hardcoded here, so there is one
 * copy to revise as upstream's quant families churn and a headless
 * install can print the same text.
 *
 * It explains the *schemes* and says nothing about any particular model.
 * Whether one family beats another on a given model is upstream research
 * and would have to be invented; the per-model numbers this product does
 * assert — size, measured bits per weight, whether it fits — are all
 * arithmetic and live on the candidate rows instead.
 *
 * Collapsed by default, and only fetched when opened: nobody needs a
 * reference table on every page load, and it never changes.
 */

const FAMILY_LABEL: Record<string, string> = {
  unquantized: "not quantized",
  legacy: "original scheme",
  k_quant: "K-quant",
  i_quant: "importance-matrix",
  dynamic: "publisher-tuned",
};

export function QuantReference() {
  const [open, setOpen] = useState(false);
  const [tiers, setTiers] = useState<QuantTier[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || tiers !== null) return;
    void (async () => {
      try {
        const table = await api.get<QuantTable>("library", "/v1/quants");
        setTiers(table.tiers ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [open, tiers]);

  return (
    <div className="rounded-[var(--radius)] border border-[color:var(--border)] text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="font-ui flex w-full items-center justify-between px-3 py-2"
        aria-expanded={open}
      >
        <span className="font-semibold">What do these version names mean?</span>
        <span className="text-[color:var(--muted)]">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-[color:var(--border)] px-3 py-3">
          <p className="text-[color:var(--muted)]">
            Quantization trades precision for size. A model&rsquo;s weights are stored at fewer bits
            each, so it takes less memory and runs faster, and it gets worse at doing its job. The
            names below describe how the bits are spent.
          </p>
          <p className="text-[color:var(--muted)]">
            The rule of thumb worth carrying:{" "}
            <strong>around 4 bits per weight is the sweet spot</strong>, below 4 the degradation
            becomes noticeable, and below 3 it becomes severe. Between two versions that both fit,
            the larger one is better.
          </p>

          {error && <p className="text-status-error">{error}</p>}
          {tiers === null && !error && <p className="text-[color:var(--muted)]">loading…</p>}

          {tiers && (
            <table className="w-full">
              <thead className="font-ui text-[11px] text-[color:var(--muted)]">
                <tr>
                  <th className="py-1 text-left font-medium">name</th>
                  <th className="py-1 text-right font-medium">bits/weight</th>
                  <th className="py-1 text-left font-medium">family</th>
                  <th className="py-1 text-left font-medium">what it is</th>
                </tr>
              </thead>
              <tbody>
                {tiers.map((tier) => (
                  <tr key={tier.tier} className="border-t border-[color:var(--border)] align-top">
                    <td className="font-mono-ui py-1.5 pr-3 whitespace-nowrap">{tier.tier}</td>
                    <td className="py-1.5 pr-3 text-right text-[color:var(--muted)] tabular-nums">
                      {tier.nominalBitsPerWeight ?? "—"}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-[color:var(--muted)]">
                      {tier.family ? (FAMILY_LABEL[tier.family] ?? tier.family) : "—"}
                    </td>
                    <td className="py-1.5">
                      <p>{tier.summary}</p>
                      {tier.guidance && (
                        <p className="mt-0.5 text-[color:var(--muted)]">{tier.guidance}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="text-[color:var(--muted)]">
            The bits-per-weight column is the tier&rsquo;s nominal width. The figure on each version
            above it is that file&rsquo;s <em>measured</em> width, which is routinely half a bit off
            the nominal because these schemes mix precisions from tensor to tensor.
          </p>
          <p className="text-[color:var(--muted)]">
            Two naming decorations you will meet: <code>UD-</code> means the publisher chose the
            width per tensor rather than taking the scheme&rsquo;s defaults, and the <code>_S</code>{" "}
            / <code>_M</code> / <code>_L</code> / <code>_XL</code> suffixes are the mixture within
            one tier, smallest to largest — not the bit width.
          </p>
        </div>
      )}
    </div>
  );
}
