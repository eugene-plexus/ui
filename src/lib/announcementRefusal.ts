/**
 * Why the control root refused a machine's new address (row 36).
 *
 * Before, the machine read "unreachable" with the probe error of its OLD
 * address, which sent the owner to firewalls and keys. The root now says
 * why, in its own words (`Node.announcementRefused`), and this module adds
 * the next step.
 *
 * **Re-enrollment is the only way to confirm a move onto the open
 * internet** (R36-ACCEPT, Troy 2026-10-22): there is no button here that
 * accepts the address. A stolen signing key could otherwise move a machine
 * onto the internet with nobody watching, and a join token is minted by a
 * person who is present.
 */

export type AnnouncementRefusalReason =
  | "open_internet"
  | "anothers_address"
  | "not_a_node"
  | "machine_port"
  | "stale_sequence"
  | "no_signing_key";

/** `Node.announcementRefused`, as the root sends it. */
export interface AnnouncementRefusal {
  at?: string;
  reason: AnnouncementRefusalReason;
  title: string;
  detail: string;
  announcedUrl?: string | null;
}

/** `Node.unverifiedAnnouncements`. */
export interface UnverifiedAnnouncements {
  count: number;
  lastAt: string;
}

/** Where a machine is enrolled again: the join token on Machines. */
export const RE_ENROLL_HREF = "/nodes#add-machine";

/** The reasons that end at re-enrollment, and say so. */
const NEEDS_RE_ENROLLMENT = new Set<AnnouncementRefusalReason>([
  "open_internet",
  "stale_sequence",
  "no_signing_key",
]);

export interface RefusalView {
  /** The root's own sentence, which names the addresses. */
  detail: string;
  /** What to do. Empty when the root's sentence already says it. */
  next: string;
  /** The action's label, when there is one. */
  action: string | null;
  href: string;
}

export function describeRefusal(refusal: AnnouncementRefusal): RefusalView {
  const reenroll = NEEDS_RE_ENROLLMENT.has(refusal.reason);
  return {
    detail: refusal.detail,
    next: nextStep(refusal.reason),
    action: reenroll ? "Re-enroll this machine" : null,
    href: reenroll ? RE_ENROLL_HREF : "/nodes",
  };
}

function nextStep(reason: AnnouncementRefusalReason): string {
  switch (reason) {
    case "open_internet":
      return "If you moved this machine onto the open internet, re-enroll it to confirm. If you did not, leave it: the address was not accepted.";
    case "anothers_address":
      return "If that machine moved, this clears when it says where. If it is gone, remove it.";
    case "not_a_node":
      return "Set another address for this machine in its Reach settings.";
    case "machine_port":
      // The root's sentence names the cause.
      return "";
    case "stale_sequence":
      return "Its identity was restored from a backup. Re-enroll it.";
    case "no_signing_key":
      return "Re-enroll it; its model files and runtimes are untouched.";
  }
}

/** "3 announcements not signed by this machine were refused, the last at 14:05." */
export function unverifiedLine(u: UnverifiedAnnouncements): string {
  const at = new Date(u.lastAt);
  const time = Number.isNaN(at.getTime())
    ? null
    : at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (u.count === 1) {
    return `1 announcement not signed by this machine was refused${time ? `, at ${time}` : ""}.`;
  }
  return `${u.count} announcements not signed by this machine were refused${
    time ? `, the last at ${time}` : ""
  }.`;
}

/** The refusal as one paragraph: the root's words, then the next step. */
export function refusalText(refusal: AnnouncementRefusal): string {
  const view = describeRefusal(refusal);
  return [view.detail, view.next].filter(Boolean).join(" ");
}
