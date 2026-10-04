"use client";

import { useEffect, useState } from "react";

import { describeWork, saysStillWorking, type WorkingState } from "@/lib/workingState";

export { STILL_WORKING_AFTER_SECONDS } from "@/lib/workingState";

/** `12 s`, `1 min 5 s`. */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/**
 * The model is working on an answer, and what it is doing.
 *
 * **Why it exists (2026-09-27).** A tester sent a prompt to a model on
 * the processor, saw one still line reading "Waiting on the backend…"
 * and nothing else, concluded it had failed, and left. The answer was
 * waiting when he came back. The first version of this was motion and a
 * clock, because the words were all the page received. The stream now
 * says what the backend is doing -- reading the prompt and how far,
 * holding the request, running a tool -- and `describeWork` says it.
 *
 * `since` is when the turn was sent, so the clock does not restart when
 * the indicator leaves and comes back (a Claude that writes a sentence,
 * runs a tool, and writes again). The clock is hidden from screen
 * readers so they are not read a number every second; the headline is
 * the status, and changes only when the work does.
 */
export function WorkingIndicator({ since, state = {} }: { since?: number; state?: WorkingState }) {
  const [mounted] = useState(() => Date.now());
  const start = since ?? mounted;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  const line = describeWork(state);
  return (
    <div
      role="status"
      data-testid="working-indicator"
      data-stage={state.progress?.stage ?? (state.thinking ? "thinking" : "waiting")}
      className="font-ui text-sm text-[color:var(--muted)]"
    >
      <p className="flex flex-wrap items-center gap-2">
        <span aria-hidden className="working-dots">
          <span />
          <span />
          <span />
        </span>
        <span data-testid="working-headline">{line.headline}</span>
        <span aria-hidden data-testid="working-elapsed" className="tabular-nums">
          {formatElapsed(seconds)}
        </span>
      </p>
      {line.fraction !== null && line.fraction < 1 && (
        <div
          role="progressbar"
          aria-label="Reading your message"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.floor(line.fraction * 100)}
          className="mt-1 h-1 w-full max-w-xs overflow-hidden rounded-full bg-[color:var(--panel-soft)]"
        >
          <div
            className="h-full bg-[color:var(--accent-left)] transition-[width] duration-500"
            style={{ width: `${Math.floor(line.fraction * 100)}%` }}
          />
        </div>
      )}
      {line.detail && (
        <p data-testid="working-detail" className="mt-1 tabular-nums">
          {line.detail}
        </p>
      )}
      {saysStillWorking(state, seconds) && (
        <p data-testid="working-still" className="mt-1">
          Still working. A large model, or one running on the processor, can take a few minutes to
          start. Keep this page open and the answer will appear here.
        </p>
      )}
    </div>
  );
}
