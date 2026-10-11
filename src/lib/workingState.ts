/**
 * What to say while a reply has not started, from what the backend said.
 *
 * **Why it exists (2026-09-27).** A tester sent a prompt to a model on
 * the processor, watched one still line for minutes, decided it had
 * failed and left; the answer was waiting when he came back. The first
 * fix was a clock and some moving dots -- honest, but it only said that
 * time was passing. Now the stream says what the backend is doing
 * (`stream_options.include_progress`), and this turns that into words:
 *
 * - llama.cpp reports how far it has read the prompt, so the line can
 *   say "Reading your message", how much, and roughly how long is left;
 * - a hosted API says it has the request, and keeps saying so;
 * - Claude Code and Codex say which of their own tools they are running;
 * - a reasoning model's thinking arrives as text, and is shown;
 * - llama.cpp counts the tokens it has written, thinking included, so the
 *   line says how many and how fast (2026-10-10). A backend that counts
 *   only at the end says nothing of the kind: nothing here is estimated.
 *
 * Nothing here is estimated beyond the one division the time left
 * needs, and that only once there is a rate to divide by.
 *
 * Pure, so every sentence is tested without a stream.
 */

import type { Model, StreamProgress } from "./types";

export interface WorkingState {
  /** The model was asleep when the message was sent and will be loaded
   * first. From the model list (`on_demand` with nothing ready). */
  starting?: boolean;
  /** The newest progress the stream carried, or null before any. */
  progress?: StreamProgress | null;
  /** The model is thinking: its reasoning is arriving and no answer yet. */
  thinking?: boolean;
}

export interface WorkingLine {
  /** What is happening, in a few words. */
  headline: string;
  /** How far, when the backend said: counts and time left. */
  detail: string | null;
  /** 0-1 for a progress bar, or null when there is nothing to measure. */
  fraction: number | null;
}

/** When the "still working" sentence joins a line with no measure. */
export const STILL_WORKING_AFTER_SECONDS = 20;

/** A rate is not trusted before this much reading has been timed. */
const MIN_RATE_MS = 1500;

function count(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** `about 20 s`, `about 3 min`: a rough figure, said as one. */
export function roughly(seconds: number): string {
  if (seconds < 55) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} s`;
  const minutes = Math.round(seconds / 60);
  return `about ${minutes} min`;
}

/** Reading the prompt: how much of the part that is not already cached. */
function reading(progress: StreamProgress): WorkingLine {
  const total = progress.prompt_tokens ?? 0;
  const cached = Math.min(progress.cached_tokens ?? 0, total);
  const processed = Math.min(Math.max(progress.processed_tokens ?? 0, cached), total);
  const todo = total - cached;
  const done = processed - cached;
  if (todo <= 0 || processed >= total) {
    return { headline: "Read your message. Starting to answer", detail: null, fraction: 1 };
  }
  const parts = [`${count(done)} of ${count(todo)} tokens`];
  const elapsed = progress.elapsed_ms ?? 0;
  if (done > 0 && elapsed >= MIN_RATE_MS) {
    const perMs = done / elapsed;
    parts.push(`${roughly((todo - done) / perMs / 1000)} left`);
  }
  if (cached > 0) parts.push("the rest was already read");
  return {
    headline: `Reading your message: ${Math.floor((done / todo) * 100)}%`,
    detail: parts.join(" · "),
    fraction: done / todo,
  };
}

export function describeWork(state: WorkingState): WorkingLine {
  const progress = state.progress ?? null;
  if (progress?.stage === "tool") {
    return {
      headline: progress.tool ? `Using a tool: ${progress.tool}` : "Using a tool",
      detail: null,
      fraction: null,
    };
  }
  if (progress?.stage === "prompt") return reading(progress);
  if (progress?.stage === "generating" && progress.generated_tokens) {
    const speed = progress.tokens_per_second;
    return {
      headline: state.thinking ? "Thinking" : "Writing",
      detail: `${count(progress.generated_tokens)} tokens${speed ? ` · ${speed.toFixed(1)} tok/s` : ""}`,
      fraction: null,
    };
  }
  if (state.thinking) return { headline: "Thinking", detail: null, fraction: null };
  if (progress?.stage === "working") {
    return {
      headline: "The model has your message and is working on it",
      detail: null,
      fraction: null,
    };
  }
  if (state.starting) {
    return {
      headline: "Starting the model. It was asleep, so it loads first",
      detail: null,
      fraction: null,
    };
  }
  return { headline: "Waiting for the model", detail: null, fraction: null };
}

/** Whether the "still working" sentence belongs under this state: past
 * the threshold, and only while nothing else is visibly happening. A
 * prompt being read says how long itself, thinking is on screen as it
 * arrives, and a tool is a named thing being done. */
export function saysStillWorking(state: WorkingState, seconds: number): boolean {
  if (seconds < STILL_WORKING_AFTER_SECONDS || state.thinking) return false;
  const stage = state.progress?.stage;
  return stage !== "prompt" && stage !== "tool" && stage !== "generating";
}

/** The model is asleep: listed, nothing ready, and it starts on demand, so
 * a message sent now waits for it to load. The gateway sends nothing at
 * all until it has (the wake happens before the stream opens), so this is
 * known only from the model list. */
export function isAsleep(model: Model | undefined | null): boolean {
  const info = model?.x_eugene_plexus;
  return info?.on_demand === true && (info.ready_backends ?? 0) === 0;
}
