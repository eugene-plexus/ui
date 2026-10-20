/**
 * The Access page's "Encrypted connections": each machine's client doors,
 * said as one line, and whether plain HTTP may be switched off (LT2-C4).
 */

import type { components } from "@/generated/agent";

export type ClientTls = components["schemas"]["ClientTls"];
export type ClientDoor = components["schemas"]["ClientDoor"];

export const PLAIN_WINDOW = "7 days";

export function doorLabel(name: string): string {
  if (name === "console") return "Console";
  if (name === "gateway") return "Gateway";
  if (name.startsWith("app:")) return `App ${name.slice(4)}`;
  return name;
}

function addressList(door: ClientDoor, max = 3): string {
  const addresses = door.plainClients.map((c) => c.address);
  const shown = addresses.slice(0, max).join(", ");
  const more = addresses.length - max;
  return more > 0 ? `${shown} and ${more} more` : shown;
}

/** "Gateway · 8080 · TLS · 3 plain connections in 7 days (a, b)" */
export function doorLine(door: ClientDoor): string {
  const parts = [doorLabel(door.name), String(door.port)];
  if (!door.listening) {
    parts.push(door.error ? `not listening: ${door.error}` : "not listening");
    return parts.join(" · ");
  }
  parts.push(door.tls ? "TLS" : "plain only");
  if (door.plainConnections === 0) {
    parts.push(`no plain connections in ${PLAIN_WINDOW}`);
  } else {
    const n = door.plainConnections;
    const who = addressList(door);
    parts.push(
      `${n} plain connection${n === 1 ? "" : "s"} in ${PLAIN_WINDOW}${who ? ` (${who})` : ""}`,
    );
  }
  return parts.join(" · ");
}

/** What a machine's certificate state says, or null when its doors speak for it. */
export function stateLine(tls: ClientTls | null | undefined): string | null {
  if (!tls) return "Not reported (this machine may need an update)";
  switch (tls.state) {
    case "pending":
      return "Waiting for a certificate from the root";
    case "error":
      return tls.error ?? "The root refused a certificate for this machine";
    case "none":
      return "Not part of an install; plain HTTP only";
    default:
      return null;
  }
}

export interface PlainSwitch {
  /** No door anywhere took a plain connection in the window. */
  canTurnOff: boolean;
  /** Distinct client addresses that did, most recent first across machines. */
  usedBy: string[];
}

/** Whether plain HTTP may be turned off, from every door of every machine. */
export function plainSwitch(machines: (ClientTls | null | undefined)[]): PlainSwitch {
  const seen = new Map<string, string>();
  let any = false;
  for (const tls of machines) {
    for (const door of tls?.doors ?? []) {
      if (door.plainConnections > 0) any = true;
      for (const client of door.plainClients) {
        const prior = seen.get(client.address);
        if (prior === undefined || client.lastSeen > prior)
          seen.set(client.address, client.lastSeen);
      }
    }
  }
  const usedBy = [...seen.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).map(([a]) => a);
  return { canTurnOff: !any, usedBy };
}
