"use client";

import { useEffect, useState } from "react";

/** When the second line appears. A first reply from a small model on a
 * card takes a second or two; past twenty, a person starts to wonder. */
export const STILL_WORKING_AFTER_SECONDS = 20;

/** `12 s`, `1 min 5 s`. */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/**
 * The model is working on an answer that has not started yet.
 *
 * **Why it exists (2026-09-27).** A tester sent a prompt to a model running
 * on the processor, saw one still line reading "Waiting on the backend…"
 * and nothing else, concluded it had failed, and left. The answer was
 * waiting when he came back. Until the first word arrives, reading the
 * prompt and thinking look exactly like a dead request. The words are all
 * the page receives (a reasoning model's thinking is not streamed to it),
 * so the only honest signs of life are motion and a clock. After
 * `STILL_WORKING_AFTER_SECONDS` a sentence says why it can take this long.
 *
 * It counts from when it first appears, which is when the turn starts
 * waiting. The clock is hidden from screen readers so they are not read a
 * number every second; the sentence that appears later is announced once.
 */
export function WorkingIndicator() {
  const [since] = useState(() => Date.now());
  const [now, setNow] = useState(since);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <div
      role="status"
      data-testid="working-indicator"
      className="font-ui text-sm text-[color:var(--muted)]"
    >
      <p className="flex items-center gap-2">
        <span aria-hidden className="working-dots">
          <span />
          <span />
          <span />
        </span>
        <span>The model is working on it</span>
        <span aria-hidden data-testid="working-elapsed" className="tabular-nums">
          {formatElapsed(seconds)}
        </span>
      </p>
      {seconds >= STILL_WORKING_AFTER_SECONDS && (
        <p data-testid="working-still" className="mt-1">
          Still working. On the processor, a first reply can take a few minutes. Keep this page open
          and the answer will appear here.
        </p>
      )}
    </div>
  );
}
