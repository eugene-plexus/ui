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
  | "development"
  | "off"
  | "unchecked"
  | "current"
  | "different"
  | "check-failed"
  | "available"
  /** Newer than its channel's newest: nothing is offered (2026-09-30). */
  | "ahead"
  /** Some parts newer, some older: updating would move some back. */
  | "mixed"
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

const RESTART =
  "Updating restarts Eugene on this machine, and the models running on it stop until it is back, usually a minute or two.";

export function describeUpdate(
  identity: NodeIdentity | null,
  now: number,
  versionsDiffer = false,
): UpdateView {
  const base = {
    version: versionLabel(identity),
    canUpdate: false,
    target: null,
    steps: [] as UpdateStep[],
    last: null as UpdateRun | null,
  };
  const update = identity?.update;
  if (!identity || !update) {
    return {
      ...base,
      state: "unknown",
      headline: "Version unknown",
      detail: identity
        ? "This machine did not report its update status."
        : "This machine did not answer.",
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
  // **Only a newer version is called newer** (2026-09-30): `available` means
  // `newest` is newer, and what is ahead of it is never offered.
  const ahead = update.ahead ?? [];
  const parts = identity.install?.components.length || 7;
  const offer = `A newer version is ready: ${label}`;
  if (update.available && label) {
    if (!update.apply.possible) {
      return {
        ...base,
        last,
        state: failed ? "failed" : "manual",
        headline: failed ? "The last update did not finish" : offer,
        detail: failed?.detail ?? update.apply.reason ?? null,
        steps: update.apply.steps ?? [],
      };
    }
    return {
      ...base,
      last,
      state: failed ? "failed" : "available",
      headline: failed ? "The last update did not finish" : offer,
      detail: failed?.detail ?? `${partsBehind(update.behind.length, parts)} ${RESTART}`,
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
  if (update.error) {
    return {
      ...base,
      last,
      state: "check-failed",
      headline: "Could not check for updates",
      detail: checkNote,
    };
  }
  return {
    ...base,
    last,
    state: failed ? "failed" : versionsDiffer ? "different" : "current",
    headline: failed
      ? "The last update did not finish"
      : versionsDiffer
        ? `No newer update found on ${update.channel}`
        : `Up to date on ${update.channel}`,
    detail: failed?.detail ?? joined(checkNote, sourceNote(update)),
  };
}

/** The same explanation in Needs Attention and on Machines. Compare full
 * commits of shared components: a UI-only release need not change agent. */
export function versionDifference(
  nodes: { label: string; identity: NodeIdentity | null }[],
): { title: string; detail: string } | null {
  const installed = nodes.filter((n) => !n.identity?.install?.development);
  const versions = new Map<string, Set<string>>();
  for (const node of installed) {
    for (const part of node.identity?.install?.components ?? []) {
      if (part.state !== "stamped" || !part.commit) continue;
      const values = versions.get(part.name) ?? new Set<string>();
      values.add(part.commit);
      versions.set(part.name, values);
    }
  }
  const differing = [...versions].filter(([, values]) => values.size > 1).map(([name]) => name);
  if (!differing.length) return null;
  const which = installed
    .map((node) => {
      const parts = (node.identity?.install?.components ?? [])
        .filter((part) => differing.includes(part.name) && part.state === "stamped" && part.commit)
        .map(
          (part) =>
            `${differing.length === 1 && part.name === "agent" ? "" : `${part.name} `}${short(part.commit!)}`,
        );
      return parts.length ? `${node.label}: ${parts.join(", ")}` : null;
    })
    .filter(Boolean)
    .join("; ");
  const channels = new Set(installed.map((n) => n.identity?.update?.channel).filter(Boolean));
  const explanation =
    channels.size > 1
      ? "These machines follow different update channels. Choose the same channel under Settings › Updates if you want them to match."
      : channels.has("edge")
        ? "Enabled update checks refresh automatically while versions differ. An Edge container can arrive before the remaining release checks finish; if no newer update is offered yet, check again shortly."
        : "Check each machine’s update status below, and its channel under Settings › Updates. Different installed versions do not always mean a newer update is available.";
  return {
    title: "Machines in this install run different versions of Eugene",
    detail: `${which}. ${explanation}`,
  };
}

/**
 * Why this channel, when nobody chose it: an unset channel follows the
 * default, and the page says so rather than let it pass for a choice.
 */
function sourceNote(update: NonNullable<NodeIdentity["update"]>): string | null {
  if (update.channelSource === "default") {
    const other = update.channel === "releases" ? "edge" : "releases";
    return (
      `It follows ${update.channel}, the default. To follow ${other}, set Update channel ` +
      "under Settings › Updates."
    );
  }
  return null;
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
