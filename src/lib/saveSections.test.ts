/**
 * Save all (CX7): every section is saved before its process restarts, and
 * each process restarts once.
 */

import { describe, expect, it } from "vitest";

import type { SaveOutcome, SectionHandle } from "@/components/ConfigEditor";

import { saveSections } from "./saveSections";

function section(
  name: string,
  process: string,
  log: string[],
  outcome: SaveOutcome = { saved: true, restartNeeded: true },
  back = true,
): SectionHandle {
  return {
    dirty: 1,
    process,
    label: process,
    restartDirty: outcome.restartNeeded,
    save: async (opts) => {
      log.push(`save ${name}${opts?.deferRestart ? "" : " (restarting at once)"}`);
      return outcome;
    },
    restart: async () => {
      log.push(`restart ${process} by ${name}`);
      return back;
    },
    reload: async () => {
      log.push(`reload ${name}`);
    },
    discard: () => {},
  };
}

describe("saveSections", () => {
  it("saves both gateway sections, then restarts the gateway once", async () => {
    const log: string[] = [];
    await saveSections([
      section("routing", "gateway", log),
      section("limits", "gateway", log),
      section("folders", "library", log, { saved: true, restartNeeded: false }),
    ]);
    expect(log).toEqual([
      "save routing",
      "save limits",
      "restart gateway by limits",
      "reload routing",
      "save folders",
    ]);
  });

  it("still restarts for what was saved when a later section fails", async () => {
    const log: string[] = [];
    await saveSections([
      section("routing", "gateway", log),
      section("limits", "gateway", log, { saved: false, restartNeeded: false }),
    ]);
    expect(log).toEqual([
      "save routing",
      "save limits",
      "restart gateway by routing",
      "reload limits",
    ]);
  });

  it("reads nothing again when the process did not come back", async () => {
    const log: string[] = [];
    await saveSections([
      section("routing", "gateway", log, undefined, false),
      section("limits", "gateway", log, { saved: true, restartNeeded: false }),
    ]);
    expect(log).toEqual(["save routing", "save limits", "restart gateway by routing"]);
  });
});
