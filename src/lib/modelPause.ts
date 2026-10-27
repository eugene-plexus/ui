/**
 * Pause the models on a machine, and keep serving (row 35).
 *
 * The agent reports the pause on `GET /v1/node` (`NodeIdentity.pause`),
 * present on every agent that can pause and absent on an older one. The
 * console's Pause and Resume go through that machine's agent with the
 * operator's session; the tray icon on a Windows machine asks over its own
 * channel. These are the words for both, one line each.
 */

import type { NodeIdentity } from "./types";

export type NodePause = NonNullable<NodeIdentity["pause"]>;

export interface PauseRuntimeResult {
  name: string;
  state: "stopped" | "started" | "refused" | "gone" | "failed";
  detail?: string | null;
}

export interface PauseResult {
  pause: NodePause;
  results: PauseRuntimeResult[];
}

/** "20:14", or "Oct 26, 20:14" for a pause from another day. */
export function pausedSince(since: string, now: Date = new Date()): string {
  const at = new Date(since);
  if (Number.isNaN(at.getTime())) return since;
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (at.toDateString() === now.toDateString()) return time;
  const day = at.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${day}, ${time}`;
}

/** The machine card's line while paused, or null when it is not. */
export function pauseLine(pause: NodePause | null | undefined, now?: Date): string | null {
  if (!pause?.paused) return null;
  const from = pause.by === "tray" ? "from the tray icon" : "from the console";
  return pause.since
    ? `Models paused ${from} since ${pausedSince(pause.since, now)}`
    : `Models paused ${from}`;
}

/** What the confirm asks before a pause. */
export function pausePrompt(machine: string): string {
  return `Pause the models on ${machine}? Answers in progress there stop. Eugene keeps serving everything else.`;
}

/** After Resume: how many came back, and why each other did not. The tray says the same. */
export function resumeSentence(results: PauseRuntimeResult[]): string {
  if (results.length === 0) return "Resumed. No models were stopped by the pause.";
  const started = results.filter((r) => r.state === "started").length;
  const others = results
    .filter((r) => r.state !== "started")
    .map((r) => ` ${r.name}: ${(r.detail || r.state).replace(/\.+$/, "")}.`)
    .join("");
  return `Resumed ${started} of ${results.length} models.${others}`;
}

/** After Pause: what it stopped, or what it could not. */
export function pauseSentence(results: PauseRuntimeResult[]): string {
  const failed = results.filter((r) => r.state === "failed");
  if (failed.length > 0) {
    return failed
      .map((r) => `${r.name}: ${(r.detail || "not stopped").replace(/\.+$/, "")}.`)
      .join(" ");
  }
  if (results.length === 0) return "Models paused. None was running.";
  return results.length === 1
    ? "Models paused. 1 model stopped."
    : `Models paused. ${results.length} models stopped.`;
}

/** A warning for the card when the tray cannot pause here; null otherwise. */
export function trayChannelLine(pause: NodePause | null | undefined): string | null {
  if (pause?.trayChannel === "taken") {
    return "Tray pause unavailable: another program holds its channel.";
  }
  return null;
}
