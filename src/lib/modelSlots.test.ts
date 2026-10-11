/**
 * The priority-list model: parsing, the edit ops, the server's own
 * validation rules mirrored, and resolution against the routing table.
 *
 * The fixtures are `RoutingTableView` bodies in the shape the gateway
 * serves — including the R3.3 case the self-tier rendering exists for: a
 * purely virtual alias has NO self tier, while a primary that is merely
 * down keeps its tier with an ineligible backend in it. Rendering those
 * two the same way is the misreading R3.3 was built to remove, so a test
 * here tells them apart.
 */

import { describe, expect, it } from "vitest";

import type { RoutingTableView } from "./types";

import {
  addSlot,
  addTarget,
  knownModelIds,
  moveTarget,
  parseModelSlots,
  removeSlot,
  removeTarget,
  renameSlot,
  resolveTarget,
  selfTier,
  serializeModelSlots,
  setTarget,
  slotProblems,
  slotWarnings,
  slotsEqual,
  unconfiguredServedModels,
  type ModelSlot,
} from "./modelSlots";

const slot = (model: string, targets: string[]): ModelSlot => ({ model, targets });

/** A routing table off the live shapes: a configured slot whose second
 * target nothing serves, an implicit slot for a served model, and a
 * primary that is down but still a primary. */
const ROUTING: RoutingTableView = {
  refreshed_at: "2026-09-21T12:00:00Z",
  slots: [
    {
      model: "coder",
      configured: true,
      tiers: [
        {
          target: "coder",
          backends: [{ driver: "coder-driver", eligible: false, ineligible_reason: "stopped" }],
        },
        {
          target: "qwen3-coder-30b",
          backends: [
            { driver: "qwen-driver", eligible: true, node: "nas" },
            { driver: "qwen-driver", eligible: false, node: "Amish_Station" },
          ],
        },
        { target: "missing-model", backends: [] },
      ],
    },
    {
      model: "qwen3-coder-30b",
      configured: false,
      tiers: [
        {
          target: "qwen3-coder-30b",
          backends: [
            { driver: "qwen-driver", eligible: true, node: "nas" },
            { driver: "qwen-driver", eligible: false, node: "Amish_Station" },
          ],
        },
      ],
    },
    {
      // A purely virtual alias: configured, and no self tier at all.
      model: "chat",
      configured: true,
      tiers: [{ target: "gemma-3-27b", backends: [{ driver: "gemma-driver", eligible: true }] }],
    },
    {
      model: "gemma-3-27b",
      configured: false,
      tiers: [{ target: "gemma-3-27b", backends: [{ driver: "gemma-driver", eligible: true }] }],
    },
  ],
};

describe("parseModelSlots", () => {
  it("reads the wire shape and tolerates an absent value", () => {
    expect(parseModelSlots(undefined)).toEqual({ slots: [], error: null });
    expect(parseModelSlots(null)).toEqual({ slots: [], error: null });
    expect(parseModelSlots([{ model: "coder", targets: ["a", "b"] }])).toEqual({
      slots: [{ model: "coder", targets: ["a", "b"] }],
      error: null,
    });
  });

  it("answers a malformed value with an error and NO slots", () => {
    // The structured editor would have to guess which entries to keep,
    // and silently dropping an operator's entry is worse than an error —
    // the page falls back to JSON with the raw value in it.
    expect(parseModelSlots("nope").error).toContain("expected a list");
    expect(parseModelSlots([{ model: 3, targets: [] }]).slots).toEqual([]);
    expect(parseModelSlots([{ model: "x", targets: "y" }]).error).toContain("targets");
    expect(parseModelSlots([{ model: "x", targets: [1] }]).error).toContain("targets");
  });
});

describe("the edit ops are pure and positional", () => {
  const base = [slot("coder", ["a", "b", "c"]), slot("chat", ["d"])];

  it("moves a target and leaves the input alone", () => {
    const moved = moveTarget(base, 0, 2, -1);
    expect(moved[0]!.targets).toEqual(["a", "c", "b"]);
    expect(base[0]!.targets).toEqual(["a", "b", "c"]);
    expect(moved[1]).toEqual(base[1]);
  });

  it("refuses to move past either edge", () => {
    expect(moveTarget(base, 0, 0, -1)).toBe(base);
    expect(moveTarget(base, 0, 2, 1)).toBe(base);
    expect(moveTarget(base, 9, 0, 1)).toBe(base);
  });

  it("adds, sets, renames and removes by index", () => {
    expect(addSlot(base, " new ").at(-1)).toEqual({ model: "new", targets: [] });
    expect(removeSlot(base, 0).map((s) => s.model)).toEqual(["chat"]);
    expect(renameSlot(base, 1, "talk")[1]!.model).toBe("talk");
    expect(addTarget(base, 1, " e ")[1]!.targets).toEqual(["d", "e"]);
    expect(addTarget(base, 1, "  ")).toBe(base);
    expect(setTarget(base, 0, 1, "B")[0]!.targets).toEqual(["a", "B", "c"]);
    expect(removeTarget(base, 0, 1)[0]!.targets).toEqual(["a", "c"]);
  });
});

describe("serialization", () => {
  it("trims names and drops empty target rows, keeping empty lists", () => {
    expect(serializeModelSlots([slot(" coder ", [" a ", "", "b"]), slot("x", [])])).toEqual([
      { model: "coder", targets: ["a", "b"] },
      // Kept: slotProblems names it and Save is blocked, so serialization
      // never silently discards an operator's entry.
      { model: "x", targets: [] },
    ]);
  });

  it("compares drafts by what would be PATCHed", () => {
    expect(slotsEqual([slot("a", ["b "])], [slot("a ", ["b"])])).toBe(true);
    expect(slotsEqual([slot("a", ["b"])], [slot("a", ["c"])])).toBe(false);
    expect(slotsEqual([slot("a", ["b", "c"])], [slot("a", ["c", "b"])])).toBe(false);
  });
});

describe("slotProblems mirrors what the gateway rejects", () => {
  it("names an empty model, a duplicate, and a list with no targets", () => {
    const problems = slotProblems([
      slot("", ["a"]),
      slot("coder", ["a"]),
      slot("coder", ["b"]),
      slot("empty", []),
      slot("blank", ["  "]),
    ]);
    expect(problems.some((p) => p.includes("List 1 has no name"))).toBe(true);
    expect(problems.some((p) => p.includes('"coder"') && p.includes("Two lists"))).toBe(true);
    expect(problems.some((p) => p.includes('"empty"') && p.includes("no fallbacks"))).toBe(true);
    expect(problems.some((p) => p.includes('"blank"') && p.includes("no fallbacks"))).toBe(true);
    expect(slotProblems([slot("coder", ["a"])])).toEqual([]);
  });
});

describe("slotWarnings names what the gateway accepts but is a mistake", () => {
  it("flags a self-target and a duplicate target", () => {
    const warnings = slotWarnings([slot("coder", ["coder", "a", "a"])]);
    expect(warnings.some((w) => w.includes("lists itself"))).toBe(true);
    expect(warnings.some((w) => w.includes("twice"))).toBe(true);
    expect(slotWarnings([slot("coder", ["a", "b"])])).toEqual([]);
  });
});

describe("resolution against the routing table", () => {
  it("answers unknown, not empty, when the table is missing", () => {
    expect(resolveTarget(null, "coder")).toBeNull();
    expect(selfTier(null, "coder")).toBeNull();
  });

  it("says which drivers serve a target, and how many are ready", () => {
    const r = resolveTarget(ROUTING, "qwen3-coder-30b")!;
    expect(r.servedBy).toEqual(["qwen-driver @ nas", "qwen-driver @ Amish_Station"]);
    expect(r.eligibleCount).toBe(1);
  });

  it("reports a target nothing serves as empty", () => {
    expect(resolveTarget(ROUTING, "missing-model")).toEqual({ servedBy: [], eligibleCount: 0 });
    expect(resolveTarget(ROUTING, "never-heard-of-it")).toEqual({ servedBy: [], eligibleCount: 0 });
  });

  it("keeps a primary that is down as a primary (R3.3)", () => {
    // `coder` is declared and stopped: the self tier is present with an
    // ineligible backend. Reading that as "alias" is the R3.3 misreading.
    const self = selfTier(ROUTING, "coder")!;
    expect(self.declared).toBe(true);
    expect(self.servedBy).toEqual(["coder-driver"]);
    expect(self.eligibleCount).toBe(0);
  });

  it("tells a virtual alias apart from a declared model", () => {
    expect(selfTier(ROUTING, "chat")!.declared).toBe(false);
    expect(selfTier(ROUTING, "gemma-3-27b")!.declared).toBe(true);
    // A name the table has never seen — a draft list for a model not
    // launched yet — reads as not declared, with nothing serving it.
    expect(selfTier(ROUTING, "brand-new")!.declared).toBe(false);
  });

  it("collects every id the table knows, for the pickers", () => {
    expect(knownModelIds(ROUTING)).toEqual([
      "chat",
      "coder",
      "gemma-3-27b",
      "missing-model",
      "qwen3-coder-30b",
    ]);
    expect(knownModelIds(null)).toEqual([]);
  });

  it("offers served models with no list, minus what the draft already has", () => {
    expect(unconfiguredServedModels(ROUTING, [])).toEqual(["gemma-3-27b", "qwen3-coder-30b"]);
    expect(unconfiguredServedModels(ROUTING, [slot("qwen3-coder-30b", [])])).toEqual([
      "gemma-3-27b",
    ]);
    expect(unconfiguredServedModels(null, [])).toEqual([]);
  });
});
