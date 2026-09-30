/**
 * What a machine runs, and what to say about updating it.
 *
 * In-app updates (2026-09-27; specs `docs/design/in-app-updates.md`).
 * Every agent checks its channel, `edge` or `releases`, a minute after it
 * starts and every six hours, and reports on `GET /v1/node`:
 *
 * - `install`: the commit each part (seven since P8) was built from, stamped
 *   into the code by git, and what keeps the install running;
 * - `update`: the newest found, whether this machine is behind, and
 *   whether it can update itself or needs a person to do it (a container
 *   pulls a new image).
 *
 * This turns one machine's answer into the words a page shows. It is pure,
 * so every sentence is tested without a network.
 */

import type { NodeIdentity, UpdateRun, UpdateStep } from "./types";

export type UpdateState =
  /** The machine did not answer. */
  | "unknown"
  /** It answered with no `update` at all: installed before it could update itself. */
  | "too-old"
  | "development"
  | "off"
  | "unchecked"
  | "current"
  | "available"
  /** Newer than its channel's newest: nothing is offered (2026-09-30). */
  | "ahead"
  /** Some parts newer, some older: updating would move some back. */
  | "mixed"
  /** An install from before the channel had a default, whose first check
   * has not yet said which channel it follows. */
  | "undecided"
  /** Behind, and cannot update itself: a person does it (a container). */
  | "manual"
  | "running"
  | "failed";

export interface UpdateView {
  state: UpdateState;
  headline: string;
  detail: string | null;
  /** What it runs now, in a few characters. */
  version: string;
  /** Whether the Update button belongs here, and what it installs. */
  canUpdate: boolean;
  target: string | null;
  /** What a person does instead, for a machine that cannot update itself. */
  steps: UpdateStep[];
  /** The last update, when it finished within the last week. */
  last: UpdateRun | null;
}

const WEEK_MS = 7 * 24 * 3600 * 1000;

function short(commit: string): string {
  return commit.slice(0, 7);
}

/** `edge 1a2b3c4` or `v0.1.0-alpha.4`: the newest, as a person reads it. */
export function targetLabel(update: NonNullable<NodeIdentity["update"]>): string | null {
  const newest = update.newest;
  if (!newest) return null;
  return newest.release ?? `edge ${short(newest.ref)}`;
}

/** What this machine runs, from the agent's own stamped commit. */
export function versionLabel(identity: NodeIdentity | null): string {
  const install = identity?.install;
  if (!install) return "version not recorded";
  if (install.development) return "development build";
  const agent = install.components.find((c) => c.name === "agent");
  if (agent?.state === "stamped" && agent.commit) {
    const update = identity?.update;
    const newest = update?.newest;
    // A release install says which release, when it is exactly that one --
    // nothing behind it AND nothing ahead of it. An install newer than the
    // release has nothing behind it too, and used to be named after it.
    if (
      newest?.release &&
      update &&
      update.behind.length === 0 &&
      (update.ahead ?? []).length === 0
    ) {
      return newest.release;
    }
    return `agent ${short(agent.commit)}`;
  }
  return "version not recorded";
}

/** "5 minutes ago", "2 hours ago", from an ISO time and now. */
export function ago(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** The one-line install for a machine that cannot update itself yet. */
export function installerCommand(os: NodeIdentity["os"] | null | undefined): string {
  const base = "https://raw.githubusercontent.com/eugene-plexus/specs/main/scripts";
  return os === "windows" ? `irm ${base}/install.ps1 | iex` : `curl -fsSL ${base}/install.sh | sh`;
}

const RESTART =
  "Updating restarts Eugene on this machine, and the models running on it stop until it is back, usually a minute or two.";

export function describeUpdate(identity: NodeIdentity | null, now: number): UpdateView {
  const base = {
    version: versionLabel(identity),
    canUpdate: false,
    target: null,
    steps: [] as UpdateStep[],
    last: null as UpdateRun | null,
  };
  if (!identity) {
    return {
      ...base,
      state: "unknown",
      headline: "Version unknown",
      detail: "This machine did not answer.",
    };
  }
  const update = identity.update;
  if (!update) {
    return {
      ...base,
      state: "too-old",
      headline: "This machine cannot update itself yet",
      detail:
        "It runs a version from before Eugene could update itself. Run the installer on it once, and it can from then on.",
      steps: [{ text: "On that machine, run:", command: installerCommand(identity.os) }],
    };
  }
  const recent = update.last?.finishedAt
    ? now - Date.parse(update.last.finishedAt) < WEEK_MS
    : false;
  const last = recent ? (update.last ?? null) : null;
  const label = targetLabel(update);
  const checked = ago(update.checkedAt, now);
  const checkNote = update.error
    ? `The last check could not finish: ${update.error}`
    : checked
      ? `Checked ${checked}.`
      : null;

  if (identity.install?.development) {
    return {
      ...base,
      last,
      state: "development",
      headline: "Development build",
      detail: "It runs from a git checkout. Update it with git.",
    };
  }
  if (update.running) {
    const what = update.running.target;
    return {
      ...base,
      last,
      state: "running",
      headline: `Updating to ${label ?? short(what)}`,
      detail:
        "Eugene on this machine is restarting with the new version. This page picks it up again when it is back.",
    };
  }
  const failed = last?.outcome === "failed" ? last : null;
  // **Only a newer version is called newer** (2026-09-30). An agent from
  // before then sends no `ahead`, and its `available` means only "differs"
  // -- so for it the page says different, never newer.
  const knowsOrder = Array.isArray(update.ahead);
  const ahead = update.ahead ?? [];
  const parts = identity.install?.components.length || 7;
  const offer = knowsOrder
    ? `A newer version is ready: ${label}`
    : `${update.channel ?? "Its channel"} has a different version: ${label}`;
  const unordered = knowsOrder
    ? null
    : "This machine's version of Eugene cannot tell whether it is newer or older; updating installs it.";
  if (update.available && label) {
    if (!update.apply.possible) {
      return {
        ...base,
        last,
        state: failed ? "failed" : "manual",
        headline: failed ? "The last update did not finish" : offer,
        detail: failed?.detail ?? joined(unordered, update.apply.reason ?? null),
        steps: update.apply.steps ?? [],
      };
    }
    return {
      ...base,
      last,
      state: failed ? "failed" : "available",
      headline: failed ? "The last update did not finish" : offer,
      detail:
        failed?.detail ??
        joined(unordered, `${partsBehind(update.behind.length, parts)} ${RESTART}`),
      canUpdate: true,
      target: update.newest?.ref ?? null,
    };
  }
  if (ahead.length > 0 && label) {
    const newer = partsCount(ahead.length, parts);
    if (update.behind.length > 0) {
      return {
        ...base,
        last,
        state: "mixed",
        headline: `Parts of this machine are newer than ${label}`,
        detail: joined(
          `${newer} newer and ${update.behind.length} older than the newest on ${update.channel}, ` +
            "so nothing is offered: updating would move the newer ones back.",
          checkNote,
        ),
      };
    }
    return {
      ...base,
      last,
      state: "ahead",
      headline: `Newer than the newest on ${update.channel}`,
      detail: joined(
        `${newer} newer than ${label}, so nothing is offered.`,
        checkNote,
        sourceNote(update),
      ),
    };
  }
  if (!update.enabled) {
    return {
      ...base,
      last,
      state: "off",
      headline: "Update checks are off",
      detail: "Turn them on under Settings › Updates.",
    };
  }
  if (update.channelSource === "pending" || !update.channel) {
    return {
      ...base,
      last,
      state: "undecided",
      headline: "Update channel not decided yet",
      detail: joined(
        "This machine was installed before the channel had a default. At its first update " +
          "check it saves the channel it was installed from -- Releases for a release, Edge " +
          "for anything else -- and nothing is offered until then.",
        update.error ? `The last check could not finish: ${update.error}` : null,
      ),
    };
  }
  if (!update.checkedAt) {
    return {
      ...base,
      last,
      state: "unchecked",
      headline: "Not checked yet",
      detail: update.error
        ? `The check could not finish: ${update.error}`
        : "It checks a minute after it starts.",
    };
  }
  return {
    ...base,
    last,
    state: failed ? "failed" : "current",
    headline: failed ? "The last update did not finish" : `Up to date on ${update.channel}`,
    detail: failed?.detail ?? joined(checkNote, sourceNote(update)),
  };
}

/**
 * Why this channel, when nobody chose it. An unset channel follows how the
 * machine was installed, so a release install reads "up to date on
 * releases" while edge moves on -- and until 2026-09-29 nothing on the page
 * said the channel was a guess (found on Troy's worker, installed from
 * alpha.5, whose Settings dropdown showed Edge for an unset value).
 */
function sourceNote(update: NonNullable<NodeIdentity["update"]>): string | null {
  if (update.channelSource === "default") {
    const other = update.channel === "releases" ? "edge" : "releases";
    return (
      `It follows ${update.channel}, the default. To follow ${other}, set Update channel ` +
      "under Settings › Updates."
    );
  }
  // Sent only by agents from before 2026-09-30, which worked the channel out
  // at every check.
  if (update.channelSource !== "inferred") return null;
  const from =
    update.channel === "releases"
      ? "it was installed from a release"
      : "it was not installed from a release";
  return (
    `It follows ${update.channel} because ${from}. ` +
    "To choose, set Update channel under Settings › Updates."
  );
}

function joined(...parts: (string | null)[]): string | null {
  const kept = parts.filter((p): p is string => Boolean(p));
  return kept.length ? kept.join(" ") : null;
}

/** "Two of the seven parts" -- the words `partsBehind` uses, without "behind". */
function partsCount(count: number, total: number): string {
  if (count >= total) return `All ${numberWord(total)} parts are`;
  if (count === 1) return `One of the ${numberWord(total)} parts is`;
  return `${numberWord(count)[0]?.toUpperCase()}${numberWord(count).slice(1)} of the ${numberWord(total)} parts are`;
}

function partsBehind(count: number, total: number): string {
  const all = numberWord(total);
  if (count >= total) return `All ${all} parts of Eugene are behind.`;
  if (count === 1) return `One of the ${all} parts of Eugene is behind.`;
  return `${count} of the ${all} parts of Eugene are behind.`;
}

function numberWord(n: number): string {
  return (
    ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][n] ?? `${n}`
  );
}
