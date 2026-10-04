"use client";

import { estimateLine, stopConsequence, stopQuestion } from "@/lib/profileBuild";
import type { MeasurementPreflight } from "@/lib/types";

/**
 * The one step both measurement jobs take before they start (Troy,
 * 2026-09-30): say what would stop, and start only with the person's yes.
 *
 * R6.1's Benchmark refused while anything ran, which sent the person to
 * Inference and back. The agent now stops exactly the runtimes the
 * request lists (`stopRuntimes`) and starts them again afterwards, so the
 * page asks with the names the preflight gave and Start passes exactly
 * those. A model started between the question and the click is not in
 * the list, so the agent refuses with 409 and the caller asks again --
 * nothing is ever stopped that nobody was asked about.
 */
export function AskBeforeStopping({
  preflight,
  asking,
  busy,
  startLabel,
  onStart,
}: {
  /** The dry run's answer; null while it has not answered. */
  preflight: MeasurementPreflight | null;
  /** True while the dry run is in flight. */
  asking: boolean;
  busy: boolean;
  /** Lower case, as it follows "Stop them and": `start the build`. */
  startLabel: string;
  onStart: (stopRuntimes: string[]) => void;
}) {
  if (asking && !preflight) {
    return <p className="text-[color:var(--muted)]">Checking this machine…</p>;
  }
  if (!preflight) return null;
  const running = preflight.runningRuntimes ?? [];
  const problems = preflight.problems ?? [];
  const question = stopQuestion(running);
  const consequence = stopConsequence(running);
  const estimate = estimateLine(preflight.estimateSeconds);
  return (
    <div className="space-y-2" data-testid="ask-before-stopping">
      {problems.length > 0 && (
        <ul
          role="alert"
          className="status-error list-disc space-y-0.5 rounded-[var(--radius)] border py-2 pr-3 pl-7"
        >
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {estimate && (
        <p title={preflight.detail || undefined} data-testid="measurement-estimate">
          {estimate}
        </p>
      )}
      {question && (
        <p data-testid="stop-question">
          {question} {consequence}
        </p>
      )}
      <button
        type="button"
        className="action-button action-button--primary font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1.5 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={busy || asking || problems.length > 0}
        onClick={() => onStart(running)}
        data-testid="measurement-start"
      >
        {question
          ? `Stop ${running.length === 1 ? "it" : "them"} and ${startLabel}`
          : `${startLabel[0]?.toUpperCase() ?? ""}${startLabel.slice(1)}`}
      </button>
    </div>
  );
}
