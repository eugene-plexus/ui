/**
 * Row 13: the words for a checked engine update and a runtime's drain,
 * against the shapes the agent sends (`EngineRollout`, `RuntimeDrain`).
 */

import { describe, expect, it } from "vitest";

import { drainLine, engineBuildLine, rolloutActive, rolloutProgress } from "./engineRollout";
import type { EngineRollout, ManagedEngine, RuntimeDrain } from "./types";

const NOW = Date.parse("2026-11-15T12:00:00Z");

function drain(over: Partial<RuntimeDrain>): RuntimeDrain {
  return {
    reason: "update",
    when: "now",
    then: "restart",
    graceSeconds: 120,
    state: "draining",
    requestedAt: "2026-11-15T11:59:00Z",
    running: 0,
    ...over,
  };
}

function rollout(over: Partial<EngineRollout>): EngineRollout {
  return {
    id: "r",
    engine: "llama_cpp",
    version: "b11800",
    from: "b11719",
    state: "checking",
    switch: "auto",
    startedAt: "2026-11-15T11:58:00Z",
    runtimes: [
      { name: "a", state: "moved" },
      { name: "b", state: "measuring" },
      { name: "c", state: "waiting" },
    ],
    check: { models: [] },
    ...over,
  };
}

const MANAGED: ManagedEngine = {
  version: "b11719",
  binaryPath: "/e/llama-server",
  variant: "win-cuda-13.3-x64",
  installedAt: "2026-11-01T00:00:00Z",
  sizeBytes: 1,
  previousVersion: "b11600",
} as ManagedEngine;

describe("drainLine", () => {
  it("says why, how many answers run and how long is left", () => {
    const line = drainLine(
      drain({ running: 2, startedAt: "2026-11-15T11:59:35Z", deadline: "2026-11-15T12:01:35Z" }),
      NOW,
    );
    expect(line).toBe("Draining for an update · 2 answers running · 95 s left");
  });

  it("says what a waiting drain waits for", () => {
    expect(drainLine(drain({ state: "waiting_covered" }), NOW)).toBe(
      "Updates when its other copies can carry the load",
    );
    expect(drainLine(drain({ state: "waiting_idle", idleSeconds: 600 }), NOW)).toBe(
      "Updates after 600 s idle",
    );
  });

  it("names a cut and says nothing when there is no drain", () => {
    expect(
      drainLine(drain({ state: "cut", message: "2 answers were cut at the 120 s limit." }), NOW),
    ).toBe("2 answers were cut at the 120 s limit.");
    expect(drainLine(undefined, NOW)).toBeNull();
  });
});

describe("engineBuildLine", () => {
  it("leads with the build in use and says where an update stands", () => {
    expect(engineBuildLine(MANAGED, rollout({}))).toBe(
      "b11719 in use · b11800 checking, model 2 of 3",
    );
    expect(engineBuildLine(MANAGED, rollout({ state: "switching" }))).toBe(
      "b11719 in use · Updating: 1 of 3 runtimes on b11800",
    );
  });

  it("says a staged build is ready, and nothing more once a rollout ended", () => {
    expect(engineBuildLine({ ...MANAGED, stagedVersion: "b11800" }, null)).toBe(
      "b11719 in use · b11800 ready to use",
    );
    expect(engineBuildLine(MANAGED, rollout({ state: "done" }))).toBe("b11719 in use");
  });
});

describe("rolloutProgress and rolloutActive", () => {
  it("counts the runtimes moved", () => {
    expect(rolloutProgress(rollout({}))).toBe("Updating: 1 of 3 runtimes on b11800");
    expect(rolloutActive(rollout({}))).toBe(true);
    expect(rolloutActive(rollout({ state: "kept" }))).toBe(false);
    expect(rolloutActive(null)).toBe(false);
  });
});
