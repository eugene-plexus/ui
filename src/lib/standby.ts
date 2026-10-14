/**
 * The warm standby, in words (specs `docs/design/warm-standby.md`).
 *
 * The control root says where its standby is from the standby's own pulls
 * (SB4): how far it had applied, and when it last pulled. Nothing here
 * probes anything; these functions only say what the root reported.
 */

import { timeAgo } from "./relativeTime";

/** `StandbyStatus`, as `GET /v1/control/status` lists it. */
export interface StandbyStatus {
  node: string;
  url?: string | null;
  appliedIndex?: number | null;
  lagEntries?: number | null;
  lastContactAt?: string | null;
  reachable?: boolean | null;
}

/** The grant a node holds while it is the standby. */
export const STANDBY_GRANT = "standby";

export function isStandby(grants: readonly string[] | null | undefined): boolean {
  return (grants ?? []).includes(STANDBY_GRANT);
}

/** One line for the standby's state, in the root's terms. */
export function standbyWords(status: StandbyStatus, now: number = Date.now()): string {
  const heard = status.lastContactAt ? timeAgo(status.lastContactAt, now) : null;
  if (!heard) {
    return "Not heard from yet. Its machine starts it within a minute of being chosen.";
  }
  if (!status.reachable) {
    return `Last heard ${heard}. Check that ${status.node} is on and can reach this machine.`;
  }
  const lag = status.lagEntries ?? 0;
  if (lag === 0) return `Up to date, last heard ${heard}.`;
  return `${lag} ${lag === 1 ? "change" : "changes"} behind, last heard ${heard}.`;
}

/** What making a machine the standby means, said before it is done. */
export function makeStandbyQuestion(node: string): string {
  return (
    `Make ${node} the standby? It keeps a copy of this install's locked keys. ` +
    "Someone who takes that machine could try to guess your passphrase offline."
  );
}

export function stopStandbyQuestion(node: string): string {
  return `Stop ${node} being the standby? Its copy is deleted from that machine.`;
}
