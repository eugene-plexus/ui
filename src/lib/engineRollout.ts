/**
 * Row 13: what the console says about a checked engine update and about a
 * runtime's drain. Pure, so each line is tested against the shapes the agent
 * sends (`EngineRollout`, `RuntimeDrain`).
 *
 * The agent holds both. A rollout moves one machine's runtimes to another
 * build, one at a time, each drained first; a drain takes one runtime out of
 * routing and lets its answers finish (at most 120 s, then they are cut).
 */

import type { EngineRollout, ManagedEngine, RuntimeDrain } from "./types";

const ENDED = new Set(["done", "kept", "failed", "cancelled"]);

const WHY: Record<string, string> = {
  update: "for an update",
  check: "for a check",
  maintenance: "for maintenance",
  operator: "",
};

/** Whether a rollout is still working (or waiting for an answer). */
export function rolloutActive(rollout: EngineRollout | null | undefined): boolean {
  return rollout != null && !ENDED.has(rollout.state);
}

/** "Updating: 1 of 3 runtimes on b11800". */
export function rolloutProgress(rollout: EngineRollout): string {
  const total = rollout.runtimes.length;
  const moved = rollout.runtimes.filter((r) => r.state === "moved").length;
  return `Updating: ${moved} of ${total} runtime${total === 1 ? "" : "s"} on ${rollout.version}`;
}

/**
 * The engine card's build line: the build in use first, then what an
 * update is doing, or a staged build that is ready.
 * "b11719 in use · b11800 checking, model 2 of 3".
 */
export function engineBuildLine(
  managed: ManagedEngine,
  rollout: EngineRollout | null | undefined,
): string {
  const parts = [`${managed.version} in use`];
  if (rollout && rolloutActive(rollout)) {
    if (rollout.state === "checking") {
      const total = rollout.runtimes.length;
      const at = rollout.runtimes.findIndex(
        (r) => r.state === "measuring" || r.state === "draining",
      );
      parts.push(`${rollout.version} checking, model ${Math.max(at, 0) + 1} of ${total}`);
    } else if (rollout.state === "installing") {
      parts.push(`getting ${rollout.version}`);
    } else if (rollout.state === "asking") {
      parts.push(`${rollout.version} ready, waiting for your answer`);
    } else {
      parts.push(rolloutProgress(rollout));
    }
  } else if (managed.stagedVersion) {
    parts.push(`${managed.stagedVersion} ready to use`);
  }
  return parts.join(" · ");
}

/**
 * A runtime row's drain line: "Draining for an update · 2 answers running
 * · 95 s left". Null when no drain is open.
 */
export function drainLine(drain: RuntimeDrain | null | undefined, now: number): string | null {
  if (!drain) return null;
  const why = WHY[drain.reason] ?? "";
  switch (drain.state) {
    case "waiting_covered":
      return "Updates when its other copies can carry the load";
    case "waiting_idle":
      return `Updates after ${drain.idleSeconds ?? 600} s idle`;
    case "draining": {
      const parts = [`Draining${why ? ` ${why}` : ""}`];
      parts.push(`${drain.running} answer${drain.running === 1 ? "" : "s"} running`);
      if (drain.deadline) {
        const left = Math.max(0, Math.round((Date.parse(drain.deadline) - now) / 1000));
        parts.push(`${left} s left`);
      }
      return parts.join(" · ");
    }
    case "drained":
      return drain.message ?? "Every answer finished.";
    case "cut":
      return drain.message ?? "Answers were cut at the time limit.";
    default:
      return null;
  }
}
