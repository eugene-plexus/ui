/**
 * The Nodes page's join command: which control-root address it names,
 * and whether the token in it can still be used.
 *
 * Pure and kept off the page so both halves are tested as data -- a Next
 * page module may export nothing but the page.
 */

import { isLoopbackHost } from "./diagnostic";

/** The control root's default port, and the agent's. */
const CONTROL_PORT = 8083;
const AGENT_PORT = 8079;

/**
 * Turn a node's agent address into the control root's.
 *
 * `Node.url` is where the *agent* listens; the control root is a
 * component on that same host, on its own port. The guess keeps the
 * agent's OFFSET rather than naming 8083: an install that publishes
 * every port shifted by the same amount (the container template's +200,
 * an acceptance run's +100) publishes the root shifted too, so 8279 means
 * 8283 there -- and a hard-coded 8083 named a port nothing listened on.
 * Still a guess, so the page shows it in an editable field.
 */
export function rootControlUrl(agentUrl: string): string {
  try {
    const parsed = new URL(agentUrl);
    const agentPort = parsed.port === "" ? null : Number(parsed.port);
    parsed.port = String(
      agentPort !== null && Number.isInteger(agentPort)
        ? agentPort + (CONTROL_PORT - AGENT_PORT)
        : CONTROL_PORT,
    );
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return agentUrl;
  }
}

/**
 * Whether an address can only be reached from the machine it names.
 * A join command naming one fails on the other machine with "connection
 * refused", and nothing on this page used to say so.
 */
export function isLoopbackUrl(url: string): boolean {
  try {
    return isLoopbackHost(new URL(url).hostname) || new URL(url).hostname.startsWith("127.");
  } catch {
    return false;
  }
}

export type JoinTokenState = "usable" | "used" | "expired";

/**
 * What a token shown on the page is good for now. A used or expired one
 * must stop offering its command: "It expires already passed." above a
 * Copy button was the old reading.
 */
export function joinTokenState(
  token: { expiresAt: string; used?: boolean | null },
  now: number = Date.now(),
): JoinTokenState {
  if (token.used) return "used";
  const expires = Date.parse(token.expiresAt);
  if (!Number.isNaN(expires) && expires <= now) return "expired";
  return "usable";
}
