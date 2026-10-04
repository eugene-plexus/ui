/**
 * Has the control root actually looked at this node yet?
 *
 * Reported by Troy on 2026-09-17: update the container, unlock the root,
 * and the Nodes page shows every machine as **down** — then a manual
 * refresh a few seconds later shows them all up.
 *
 * Two causes, and this module is the second. The first is that the page
 * did not poll. The second is that **"nothing has looked" and "we looked
 * and it was not there" arrive as the same field.** A locked root does
 * not poll — correctly, since it cannot mint a service token and every
 * node would answer 401 — so the moment it is unlocked it holds no
 * observations at all, and `GET /v1/nodes` reports `reachable: false`
 * for every one of them.
 *
 * That default is honest about the *field*: nothing is reassigned on the
 * strength of it, and a node is `down`, never `out`. It is not honest as
 * a word on a screen, because the operator reads "down" as a report and
 * it is an absence of one.
 *
 * **The signature that separates them is already on the wire**, and it
 * is exact rather than a heuristic: every `reachable: false` the probe
 * client produces carries an `error` — there is no branch that fails
 * without one. So no error *and* no `lastSeenAt` means no probe record
 * exists, which means no pass has run since this root started.
 *
 * The third instance in one day of a missing observation being rendered
 * as a negative one; see the Library's "will not fit" about a model that
 * was serving.
 */

export type Liveness = "reachable" | "down" | "unchecked";

export interface LivenessInput {
  reachable: boolean;
  lastError?: string | null;
  lastSeenAt?: string | null;
}

export function nodeLiveness(node: LivenessInput): Liveness {
  if (node.reachable) return "reachable";
  // A probe that failed always says why. Nothing said, and never seen,
  // means nothing has asked.
  if (!node.lastError && !node.lastSeenAt) return "unchecked";
  return "down";
}

/**
 * The word, and the tooltip behind it.
 *
 * `unchecked` deliberately does not say "down" in any voice: an operator
 * who has just unlocked a root is deciding whether something is broken,
 * and a wrong answer there sends them to the worker's logs.
 */
export function describeLiveness(liveness: Liveness): { label: string; title: string } {
  switch (liveness) {
    case "reachable":
      return {
        label: "reachable",
        title: "This root reached the node's agent on its last pass.",
      };
    case "unchecked":
      return {
        label: "checking…",
        title:
          "This root has not polled since it started — a sealed root cannot poll, so an " +
          "unlock leaves it with no observations for up to one poll interval. This is not " +
          "a report that the node is down.",
      };
    default:
      return {
        label: "down",
        title: "This root tried to reach the node and could not. The reason is below.",
      };
  }
}
