/**
 * The line on the Inference screen that says where the gateway's node
 * list came from, and whether the control root answered.
 *
 * Until 2026-09-13 nothing set the gateway's `controlUrl`, so a
 * two-machine install came up with its worker enrolled, reachable and
 * invisible to routing, while every surface said "fine" or "nothing
 * here" and none said "I am not looking there". A control root sealed
 * after a container restart did the same: this screen went empty and
 * nothing on it said why. The gateway derives the root from its own
 * agent now and reports what it found on `RoutingTableView.control_root`;
 * this turns that into the sentence an operator needs when the screen is
 * emptier than it should be.
 *
 * Pure, and tested against the shapes the gateway really sends -- a
 * trailing slash on the URL, `error: null` when there is none -- rather
 * than fixtures invented to match the code.
 */

import type { ControlRootView } from "./types";

export type ControlRootLine = {
  /** `warn` when the root did not answer; `muted` for the ordinary line. */
  tone: "muted" | "warn";
  text: string;
  /** A tooltip: what to do about it, when there is something to do. */
  detail: string | null;
};

export function describeControlRoot(
  root: ControlRootView | null | undefined,
): ControlRootLine | null {
  // A gateway older than the field: nothing to say rather than a guess.
  if (!root) return null;

  const url = root.url ? String(root.url).replace(/\/$/, "") : null;
  const nodes = typeof root.nodes === "number" ? root.nodes : null;
  const nodesText = nodes === null ? "" : ` · ${nodes} node${nodes === 1 ? "" : "s"}`;

  if (root.source === "none") {
    return {
      tone: "muted",
      text: "No control root: the gateway reads only this host's agent, which is not enrolled and runs none.",
      detail: "Set the gateway's Control root under Config to override that.",
    };
  }

  const from = root.source === "config" ? "set under Config" : "found through this node's agent";
  const where = url ? `Control root ${url}` : "Control root";

  if (!root.reachable) {
    const why = root.error ? ` (${root.error})` : "";
    const sealed = typeof root.error === "string" && /locked/i.test(root.error);
    return {
      tone: "warn",
      text: `${where} did not answer on the gateway's last refresh${why}: showing the last node list it had${nodesText}.`,
      detail: sealed
        ? "The root is sealed, as it is after every restart of a container: unlock it on the Nodes page, or set up the passphrase file so it comes back on its own."
        : `${where.charAt(0).toUpperCase()}${where.slice(1)} was ${from}. Backends on the nodes it last listed stay routable; a node that joined since will not appear until it answers.`,
    };
  }

  return { tone: "muted", text: `${where} · ${from}${nodesText}`, detail: null };
}
