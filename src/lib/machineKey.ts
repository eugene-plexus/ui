/**
 * One machine's key, on Machines: when it was made, when it changes by
 * itself, and a change under way (row 3 and part 3b).
 *
 * `specs/docs/design/rows/row-03.md`. A machine key is self-signed and
 * pinned, so it never expires; the machine changes it once a year by itself
 * (`machineKeyChangeDays`), or when someone asks. The change keeps both keys
 * listed until every machine has the new one, so nothing stops. The
 * machine's own agent says where its change stands (`machine.keyChange`); the
 * root says which machines it still waits on (`Node.machineKeyChange`).
 */

import type { components as AgentComponents } from "@/generated/agent";
import type { components as ControlComponents } from "@/generated/control";

import { formatTimestamp } from "./relativeTime";

export type MachinePortView = Pick<
  AgentComponents["schemas"]["MachinePort"],
  | "listening"
  | "keyChange"
  | "keyMadeAt"
  | "keyChangeDueAt"
  | "keyChangeNextAttemptAt"
  | "keyChangeBlocked"
  | "error"
> & { pin?: string; required?: boolean };

export type ObservedKeyChange = Pick<
  ControlComponents["schemas"]["NodeMachineKeyChange"],
  "waitingOn" | "unreachable"
> & { nextPin?: string; notReady?: string[] | null };

export interface MachineKeyInput {
  /** The machine as people see it (its label). */
  who: string;
  /** Its machine port, from its own agent (`GET /v1/node`); null when it has none. */
  machine: MachinePortView | null | undefined;
  /** What the root sees of a change under way; null outside one. */
  observed?: ObservedKeyChange | null;
  /** How many other machines hold a machine key. */
  others: number;
  /** A machine's name as people see it. */
  labelOf?: (name: string) => string;
  now?: number;
  /** How a time is written; the console's own format by default. */
  when?: (iso: string | null | undefined, now?: number) => string | null;
  /** How the month of the next change is written ("March 2027"). */
  monthOf?: (iso: string) => string;
  /** This machine runs the install's root: its change waits for every
   * machine whose agent cannot take its new key after missing the change. */
  runsRoot?: boolean;
}

export interface MachineKeyLine {
  text: string;
  tone: "good" | "bad" | "muted";
}

export interface MachineKeyView {
  lines: MachineKeyLine[];
  /** "Change this machine's key now" is offered. */
  canStart: boolean;
  /** "Stop" is offered: only before the switch. */
  canStop: boolean;
}

function sentence(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function monthYear(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function listed(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function describeMachineKey(input: MachineKeyInput): MachineKeyView | null {
  const machine = input.machine;
  if (!machine) return null;
  const now = input.now ?? Date.now();
  const when = input.when ?? formatTimestamp;
  const monthOf = input.monthOf ?? monthYear;
  const label = input.labelOf ?? ((name: string) => name);
  const change = machine.keyChange ?? null;
  const lines: MachineKeyLine[] = [];

  if (!machine.listening) {
    return {
      lines: [{ text: "No machine key change: its machine port is not listening", tone: "muted" }],
      canStart: false,
      canStop: false,
    };
  }

  const running = change?.state === "waiting" || change?.state === "switched";
  if (change?.state === "waiting") {
    const observed = input.observed;
    if (observed && input.others > 0) {
      const behind = (observed.waitingOn?.length ?? 0) + (observed.unreachable?.length ?? 0);
      const have = Math.max(0, input.others - behind);
      lines.push({
        text: `Changing machine key: ${have} of ${input.others} machines have the new key`,
        tone: "muted",
      });
    } else {
      lines.push({ text: "Changing machine key", tone: "muted" });
    }
    const offline = (observed?.unreachable ?? []).map(label);
    if (offline.length > 0) {
      const one = offline.length === 1;
      lines.push({
        text:
          `${listed(offline)} ${one ? "is" : "are"} offline; ` +
          `${one ? "it takes" : "they take"} the new key when ${one ? "it returns" : "they return"}`,
        tone: "muted",
      });
    }
  } else if (change?.state === "switched") {
    lines.push({
      text: `Changing machine key: ${input.who} presents its new key; the root drops the old one next`,
      tone: "muted",
    });
  } else if (change?.state === "done") {
    const how = change.reason === "scheduled" ? "changed by itself" : "changed";
    lines.push({
      text: `Machine key ${how} ${when(change.finishedAt ?? null, now) ?? ""}`.trim(),
      tone: "good",
    });
  } else if (change?.state === "failed") {
    lines.push({
      text: `Machine key not changed: ${change.error ?? "the change failed"}`,
      tone: "bad",
    });
  } else if (change?.state === "stopped") {
    lines.push({
      text: `Machine key change stopped ${when(change.finishedAt ?? null, now) ?? ""}`.trim(),
      tone: "muted",
    });
  } else if (machine.keyMadeAt) {
    lines.push({ text: `Machine key made ${when(machine.keyMadeAt, now)}`, tone: "muted" });
  }

  // The root's change waits for every machine that cannot take its new key
  // after missing the change: named, with what to do (Troy's call).
  const notReady = input.runsRoot ? (input.observed?.notReady ?? []).map(label) : [];
  if (change?.state === "waiting" && notReady.length > 0) {
    const one = notReady.length === 1;
    lines.push({
      text:
        `${listed(notReady)} must be updated or removed first: ` +
        `${one ? "it runs" : "they run"} a version that cannot take the new key if ` +
        `${one ? "it misses" : "they miss"} the change`,
      tone: "bad",
    });
  } else if (running && change?.error) {
    // What the change waits for, in the machine's own words.
    lines.push({ text: sentence(change.error), tone: "bad" });
  }

  if (!running) {
    // The machine's own next attempt (`keyChangeNextAttemptAt`), never a
    // promise it will not keep: an overdue key catches up within a week, a
    // stopped change waits a day, and a start that could not happen is tried
    // again an hour later, with its cause shown.
    const due = machine.keyChangeDueAt ?? null;
    const next = machine.keyChangeNextAttemptAt ?? due;
    const blocked = machine.keyChangeBlocked ?? null;
    if (due === null) {
      lines.push({ text: "Changes only when you ask", tone: "muted" });
    } else if (blocked) {
      lines.push({ text: `Key change could not start: ${blocked}`, tone: "bad" });
      if (next) lines.push({ text: `It is tried again ${when(next, now)}`, tone: "muted" });
    } else if (Date.parse(due) > now) {
      lines.push({ text: `Next key change: ${monthOf(due)}`, tone: "muted" });
    } else if (next === null || Date.parse(next) <= now + 60_000) {
      lines.push({ text: "Due a change; it starts within a minute", tone: "muted" });
    } else {
      lines.push({ text: `Due a change; it starts ${when(next, now)}`, tone: "muted" });
    }
  }

  return { lines, canStart: !running, canStop: change?.state === "waiting" };
}

/** What the button's question says (row 3's design). */
export const CHANGE_KEY_PROMPT =
  "This machine gets a new key. The others take it within a few minutes; nothing stops.";
