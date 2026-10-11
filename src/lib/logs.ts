/**
 * Reading every machine's log from one console (2026-09-27).
 *
 * Troy: *"Like a Docker environment, I should be able to read all node logs
 * from the UI."* Each agent serves its own machine's stream at
 * `GET /v1/logs` (history) and `GET /v1/logs/stream` (a follow), stamped at
 * receipt in UTC and tagged with a source. This module is the pure half:
 * the query, the SSE framing, putting several machines on one timeline,
 * and the text a Download writes. The page does the reading.
 */

import { formatSelection } from "./resourceTree";
import type { LogLine } from "./types";

/** A line and the machine it came from. */
export interface MachineLine extends LogLine {
  machine: string;
}

export interface LogFilters {
  /** Only these sources; empty for all. */
  sources: readonly string[];
  contains: string;
  tail: number;
}

export const TAILS = [500, 2000, 5000] as const;

/** The history is capped where the agent caps it. */
export const MAX_KEPT = 5000;

/** The query string both reads share, `?source=a&source=b&...`. */
export function logsQuery(filters: Partial<LogFilters>, withTail = true): string {
  const params = new URLSearchParams();
  for (const source of filters.sources ?? []) params.append("source", source);
  const contains = filters.contains?.trim();
  if (contains) params.set("contains", contains);
  if (withTail && filters.tail) params.set("tail", String(filters.tail));
  const text = params.toString();
  return text ? `?${text}` : "";
}

export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Complete SSE events in `buffer`, and whatever trails them unfinished.
 * Comments (`: keepalive`) are dropped; an event without a name is
 * `message`, as the spec says.
 */
export function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: SseEvent[] = [];
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length > 0) events.push({ event, data: data.join("\n") });
  }
  return { events, rest };
}

/**
 * Several machines' lines on one timeline, oldest first.
 *
 * A line with no time of its own (written before stamping, or the
 * updater's log) stays right after the line before it from the same
 * machine, rather than sinking to the start: it was written then. The
 * sort is stable, so equal times keep each machine's own order.
 */
export function mergeByTime(streams: readonly (readonly MachineLine[])[]): MachineLine[] {
  const keyed: { line: MachineLine; at: number; machine: number; index: number }[] = [];
  streams.forEach((lines, machine) => {
    let last = Number.NEGATIVE_INFINITY;
    lines.forEach((line, index) => {
      const own = line.time ? Date.parse(line.time) : Number.NaN;
      if (!Number.isNaN(own)) last = own;
      keyed.push({ line, at: last, machine, index });
    });
  });
  keyed.sort((a, b) => a.at - b.at || a.machine - b.machine || a.index - b.index);
  return keyed.map((k) => k.line);
}

/** The newest `max`, oldest first: what a view keeps as a follow runs. */
export function keepNewest<T>(lines: readonly T[], max = MAX_KEPT): T[] {
  return lines.length > max ? lines.slice(lines.length - max) : [...lines];
}

/** A stamp as this browser's clock reads it, to the millisecond. */
export function timeOf(time: string | null | undefined): string {
  if (!time) return "";
  const moment = new Date(time);
  if (Number.isNaN(moment.getTime())) return "";
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `${pad(moment.getHours())}:${pad(moment.getMinutes())}:${pad(moment.getSeconds())}` +
    `.${pad(moment.getMilliseconds(), 3)}`
  );
}

/** Lines that read as trouble, for a colour; the words are the engines' own. */
export function looksLikeTrouble(text: string): boolean {
  return /\b(error|failed|traceback|exception|fatal|refus(ed|ing))\b/i.test(text);
}

/**
 * What Download writes: one line each, the full UTC stamp first so the
 * file sorts and greps, the machine when there are several.
 */
export function downloadText(lines: readonly MachineLine[], withMachine: boolean): string {
  return lines
    .map((line) => {
      const parts = [line.time ?? "-"];
      if (withMachine) parts.push(line.machine);
      parts.push(`[${line.source}]`, line.text);
      return parts.join(" ");
    })
    .join("\n")
    .concat(lines.length > 0 ? "\n" : "");
}

/** `eugene-logs-Amish_Station-2026-09-27T19-51-54.txt` */
export function downloadName(scope: string, now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/:/g, "-");
  return `eugene-logs-${scope.replace(/[^A-Za-z0-9_.-]+/g, "_")}-${stamp}.txt`;
}

/**
 * A supervised model's own lines: its machine's log opened on its engine.
 * The source is the supervisor's prefix for an engine, `engine: <name>`.
 */
export function engineLogsHref(node: string | null, runtime: string): string {
  const sel = formatSelection({ type: "agent", node, name: null });
  return `/logs?sel=${encodeURIComponent(sel)}&source=${encodeURIComponent(`engine: ${runtime}`)}`;
}
