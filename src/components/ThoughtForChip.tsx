"use client";

import { useState } from "react";

import type { PassRecord } from "@/lib/types";

interface VoicePassRecord {
  driverName: string;
  latencyMs?: number;
}

/**
 * ChatGPT-style "Thought for X.Xs ›" chip rendered above Eugene's
 * latest response. Click to expand into a compact inline trace —
 * per-pass agreement + decision, voice driver, voice latency.
 *
 * Why client-side wall-clock time:
 *   The orchestrator's `PassRecord` schema doesn't carry per-pass
 *   latency in v0.2 (only `VoicePassRecord.latencyMs` exists). Adding
 *   per-pass timings is a v0.3 spec change. For the badge we use
 *   the round-trip the user actually felt — start a timer in
 *   `chat()`, stop when the response lands. Closest match to
 *   ChatGPT's UX since that's also wall-clock-felt time, not pure
 *   model latency.
 *
 * Limited to the latest response in v0.2 — historical responses
 * don't store passes/voicePass alongside their message, so we have
 * no metadata to render there. Persisting per-message metadata is
 * a future polish item if operators ask for it.
 */
export function ThoughtForChip({
  passes,
  voicePass,
  totalLatencyMs,
}: {
  passes: PassRecord[];
  voicePass: VoicePassRecord | null;
  totalLatencyMs: number | null;
}) {
  const [expanded, setExpanded] = useState(false);

  // Don't render when there's nothing to show. Happens during the
  // first paint after page reload (passes + totalLatencyMs not yet
  // restored from localStorage) and on the empty-conversation state.
  if (passes.length === 0 && voicePass == null) return null;

  const seconds =
    totalLatencyMs != null ? (totalLatencyMs / 1000).toFixed(1) : null;
  const passCount = passes.length;
  const finalPass = passes[passes.length - 1];
  const finalDecision = finalPass?.callosum.decision;
  const finalAgreement = finalPass?.callosum.agreement;

  return (
    <div className="mb-2 flex flex-col items-start">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="font-ui flex items-center gap-1.5 rounded px-2 py-1 text-[11px] text-[color:var(--muted)] transition-colors hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--foreground)]"
        aria-expanded={expanded}
      >
        <span>
          {seconds != null ? `Thought for ${seconds}s` : "Thought"}
        </span>
        <span className="inline-block transition-transform" style={{ transform: expanded ? "rotate(90deg)" : "none" }}>
          ›
        </span>
      </button>
      {expanded && (
        <div className="mt-1 ml-2 flex flex-col gap-1.5 rounded border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-[11px] leading-relaxed text-[color:var(--muted)]">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            <span>
              <span className="text-[color:var(--foreground)]">{passCount}</span>{" "}
              {passCount === 1 ? "pass" : "passes"}
            </span>
            {finalDecision && (
              <span>
                decision:{" "}
                <span className="text-[color:var(--foreground)] font-mono">
                  {finalDecision}
                </span>
              </span>
            )}
            {finalAgreement != null && (
              <span>
                final agreement:{" "}
                <span className="text-[color:var(--foreground)] font-mono">
                  {finalAgreement.toFixed(2)}
                </span>
              </span>
            )}
            {voicePass?.driverName && (
              <span>
                voice:{" "}
                <span className="text-[color:var(--foreground)] font-mono">
                  {voicePass.driverName}
                </span>
                {voicePass.latencyMs != null && (
                  <>
                    {" "}
                    (
                    <span className="font-mono">
                      {(voicePass.latencyMs / 1000).toFixed(1)}s
                    </span>
                    )
                  </>
                )}
              </span>
            )}
          </div>
          {passes.length > 0 && (
            <div className="mt-1 flex flex-col gap-0.5 border-t border-[color:var(--border)] pt-1.5">
              {passes.map((p) => (
                <div key={p.passIndex} className="flex gap-2 font-mono">
                  <span>pass {p.passIndex}</span>
                  <span>·</span>
                  <span>agreement {p.callosum.agreement.toFixed(2)}</span>
                  <span>·</span>
                  <span>{p.callosum.decision}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
