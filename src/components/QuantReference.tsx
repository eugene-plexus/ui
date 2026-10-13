"use client";

import { useEffect, useState } from "react";

import { api, describeError } from "@/lib/api";
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
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open || tiers !== null) return;
    void (async () => {
      setError(null);
      try {
        const table = await api.get<QuantTable>("library", "/v1/quants");
        setTiers(table.tiers ?? []);
      } catch (err) {
        // The library's own sentence, not the status line.
        setError(describeError(err));
      }
    })();
  }, [open, tiers, attempt]);

  return (
    <div className="rounded-[var(--radius)] border border-[color:var(--border)] text-sm">
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
            Quantization trades precision for size: fewer bits per weight means less memory and more
            speed, but worse answers. The names below say how the bits are spent.
          </p>
          <p className="text-[color:var(--muted)]">
            Rule of thumb: <strong>around 4 bits per weight is the sweet spot</strong>. Below 4
            quality drops noticeably, below 3 severely. Of two versions that fit, take the larger.
          </p>

          {error && (
            <p role="alert" className="text-status-error">
              {error}
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className="font-ui ml-2 rounded-[var(--radius)] border border-current px-2 py-0.5 text-[0.6875rem] hover:bg-[color:var(--panel-hover)]"
              >
                Try again
              </button>
            </p>
          )}
          {tiers === null && !error && <p className="text-[color:var(--muted)]">loading…</p>}

          {tiers && (
            <table className="w-full">
              <thead className="font-ui text-[0.6875rem] text-[color:var(--muted)]">
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
            The bits-per-weight column is the nominal width. Each version&rsquo;s own figure is its{" "}
            <em>measured</em> width, often half a bit off because these schemes mix precisions.
          </p>
          <p className="text-[color:var(--muted)]">
            <code>UD-</code> means the publisher chose each tensor&rsquo;s width. The{" "}
            <code>_S</code> / <code>_M</code> / <code>_L</code> / <code>_XL</code> suffixes are the
            mixture within one tier, smallest to largest, not the bit width.
          </p>
        </div>
      )}
    </div>
  );
}
