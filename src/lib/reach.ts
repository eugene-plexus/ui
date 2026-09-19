/**
 * "Reach it from other devices": three answers, and the sentence each one earns.
 *
 * Hobbyist UX §6.1 and §7 S5, decision #8. Everything here is a function
 * of one `NodeReach`, so the states a loopback-only box, a half-changed
 * box and a firewalled box each produce can be asserted without a
 * browser — which matters here more than on most cards, because the
 * whole failure mode being designed against is a card that says the
 * wrong confident thing.
 *
 * **The rule the card is built on: never claim reach we have not got,
 * and never blame the wrong thing.** A person told "you are reachable"
 * who is not will go and look for the fault in their phone, their
 * router, their app. A person told "restart Eugene" when the real
 * problem is a firewall rule will restart it, see no change, and have
 * learnt nothing. So each of the three conditions gets its own line and
 * its own remedy, and `unknown` is a first-class answer that reads as
 * *we could not check* rather than as either verdict.
 *
 * **The words are the person's** (P5). "This PC", "your phone", "your
 * network" — not "bind host", "advertise URL", "inbound rule". The
 * jargon lives in the detail line for the expert.
 */

import type { FirewallPort, NodeReach } from "./types";

// --- the headline -----------------------------------------------------

export type ReachState =
  /** The agent has not answered yet. Nothing is shown. */
  | { kind: "loading" }
  /** Loopback only: nothing else can reach this machine, and that is the setting. */
  | { kind: "off"; proposed: string | null }
  /**
   * The setting says on and the agent's own socket has not caught up.
   * The one state where a restart is the honest advice.
   */
  | { kind: "restart-needed"; url: string; canSelfRestart: boolean; command: string | null }
  /** On, and the firewall is in the way. */
  | { kind: "blocked"; url: string; remedy: string | null; profiles: string[] }
  /** On, and we could not check the firewall. Not an error. */
  | { kind: "unchecked"; url: string; detail: string | null }
  /** On, listening, and nothing known is in the way. */
  | { kind: "on"; url: string };

export function reachState(reach: NodeReach | null): ReachState {
  if (reach === null) return { kind: "loading" };
  if (!reach.enabled) return { kind: "off", proposed: trimmed(reach.proposedUrl) };

  const url = trimmed(reach.advertiseUrl) ?? trimmed(reach.proposedUrl) ?? "";

  // Order matters, and it is the order a person would fix things in.
  // A restart comes first because until the socket moves, the firewall's
  // answer is about a port nothing is listening on — true, and not the
  // thing to act on.
  if (reach.restartRequired) {
    return {
      kind: "restart-needed",
      url,
      canSelfRestart: reach.restart?.canSelfRestart ?? false,
      command: reach.restart?.command ?? null,
    };
  }

  const verdicts = reach.firewall?.ports ?? [];
  if (verdicts.some((p) => p.verdict === "blocked")) {
    const worst = verdicts.find((p) => p.verdict === "blocked") as FirewallPort;
    return {
      kind: "blocked",
      url,
      remedy: worst.remedy ?? null,
      profiles: reach.firewall?.activeProfiles ?? [],
    };
  }
  if (verdicts.length === 0 || verdicts.some((p) => p.verdict === "unknown")) {
    return { kind: "unchecked", url, detail: reach.firewall?.detail ?? null };
  }
  return { kind: "on", url };
}

/** The one sentence under the switch, in the person's words. */
export function headline(state: ReachState): string {
  switch (state.kind) {
    case "loading":
      return "";
    case "off":
      return state.proposed
        ? `Only this PC can reach Eugene. Turn this on to open it from your laptop or phone at ${state.proposed}.`
        : "Only this PC can reach Eugene. This machine is not on a network, so there is nothing to turn on yet.";
    case "restart-needed":
      return `Eugene needs to restart before ${state.url} starts working.`;
    case "blocked":
      return `${state.url} is set up, but this PC's firewall is turning the connections away.`;
    case "unchecked":
      return `Open ${state.url} on your phone. If the page loads, it works.`;
    case "on":
      return `Open ${state.url} on your phone or laptop.`;
  }
}

/**
 * The proof, when there is any — and there is only one kind.
 *
 * Static inspection of a firewall says what *should* happen. A
 * connection that arrived says what did. `reach.card` never dresses the
 * firewall verdict up as proof, because a `blocked` verdict on a machine
 * that works (a third-party firewall already allowing us, a rule we
 * could not read) and an `allowed` one on a machine that does not (the
 * router, the wrong subnet, a VPN) are both real.
 */
export function evidence(reach: NodeReach | null): string | null {
  if (!reach?.lastReachedFrom) return null;
  const when = reach.lastReachedAt ? ` ${relative(reach.lastReachedAt)}` : "";
  return `Something at ${reach.lastReachedFrom} reached this machine${when}.`;
}

/** What is listening where, for the expert line under the card. */
export function listening(reach: NodeReach | null): string | null {
  const bound = reach?.boundAddresses ?? [];
  if (bound.length === 0) return null;
  return bound.map((b) => `${b.process} on ${b.host}:${b.port}`).join(", ");
}

/**
 * Why the firewall answer is what it is, when it is worth saying.
 *
 * A network Windows has classified as Public is the commonest cause of
 * "it worked here yesterday", so the classification is surfaced even
 * when every verdict is `allowed` — it is the thing that will change
 * under the person tomorrow.
 */
export function firewallNote(reach: NodeReach | null): string | null {
  const fw = reach?.firewall;
  if (!fw) return null;
  if (fw.detail) return fw.detail;
  if ((fw.activeProfiles ?? []).includes("Public")) {
    return (
      "Windows treats this network as Public, which blocks more by default. " +
      "Change it to Private in Settings → Network, or allow Eugene on Public networks too."
    );
  }
  return null;
}

/**
 * What starts Eugene on this machine, in one sentence, always.
 *
 * **`restart.detail` and `restart.mechanism` have been on the wire since
 * S5 and no screen has ever printed either.** The fixture at
 * `app/page.test.tsx` supplies `mechanism: "logon_task"` and nothing
 * asserted it, which is this project's wiring lesson in its purest form:
 * the producer was right, the consumer never existed, and the test
 * passed.
 *
 * It matters now because R2.6 changed the answer. A Windows install is a
 * service and comes back at boot before anyone signs in; an install made
 * before that is a logon task and does not, and **the two are
 * indistinguishable from every screen in the product** — which is how
 * somebody's phone gets connection refused at 7 am with nothing
 * anywhere to explain it.
 *
 * Shown in every state rather than only when a restart is pending: the
 * question *"will this still be here after I reboot?"* is not one a
 * person asks at the moment they are being asked to restart.
 *
 * `null` when the agent said nothing, which is honest. An invented
 * sentence about how a machine boots is worse than no sentence.
 */
export function startsWhen(reach: NodeReach | null): string | null {
  const detail = reach?.restart?.detail?.trim();
  return detail ? detail : null;
}

/**
 * Whether the switch may offer to restart Eugene itself.
 *
 * False is not a failure. It is the install nothing supervises — an
 * agent somebody started in a terminal — where stopping it would end the
 * install until they typed the command again. A browser click must never
 * be able to do that, so the card prints the command instead.
 */
export function canRestartHere(reach: NodeReach | null): boolean {
  return reach?.restart?.canSelfRestart === true;
}

// --- helpers ----------------------------------------------------------

function trimmed(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/\/+$/, "");
}

function relative(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}
