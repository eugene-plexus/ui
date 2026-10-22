import { describe, expect, it } from "vitest";

import { describeMachineKey, type MachineKeyInput } from "./machineKey";

const when = (iso: string | null | undefined) => (iso ? `[${iso}]` : null);
const monthOf = (iso: string) => `{${iso.slice(0, 7)}}`;
const NOW = Date.parse("2026-10-22T12:00:00Z");

function input(over: Partial<MachineKeyInput> = {}): MachineKeyInput {
  return {
    who: "NAS",
    machine: {
      pin: "p".repeat(43),
      listening: true,
      required: true,
      keyMadeAt: "2026-01-01T00:00:00Z",
      keyChangeDueAt: "2027-01-01T00:00:00Z",
    },
    observed: null,
    others: 2,
    labelOf: (name) => name.toUpperCase(),
    now: NOW,
    when,
    monthOf,
    ...over,
  };
}

describe("describeMachineKey", () => {
  it("says when the key was made and when it changes by itself", () => {
    const view = describeMachineKey(input())!;
    expect(view.lines.map((l) => l.text)).toEqual([
      "Machine key made [2026-01-01T00:00:00Z]",
      "Next key change: {2027-01}",
    ]);
    expect(view.canStart).toBe(true);
    expect(view.canStop).toBe(false);
  });

  it("says a key set to change only on request", () => {
    const view = describeMachineKey(
      input({ machine: { ...input().machine!, keyChangeDueAt: null } }),
    )!;
    expect(view.lines[1]?.text).toBe("Changes only when you ask");
  });

  it("counts the machines that have the new key, and names the offline ones", () => {
    const view = describeMachineKey(
      input({
        others: 3,
        machine: {
          ...input().machine!,
          keyChange: { state: "waiting", startedAt: "2026-10-22T11:59:00Z", nextPin: "n" },
        },
        observed: { nextPin: "n", waitingOn: ["gpu"], unreachable: ["laptop"], notReady: [] },
      }),
    )!;
    expect(view.lines.map((l) => l.text)).toEqual([
      "Changing machine key: 1 of 3 machines have the new key",
      "LAPTOP is offline; it takes the new key when it returns",
    ]);
    expect(view.canStart).toBe(false);
    expect(view.canStop).toBe(true);
  });

  it("says what a change waits for, in the machine's own words", () => {
    const view = describeMachineKey(
      input({
        machine: {
          ...input().machine!,
          keyChange: {
            state: "waiting",
            startedAt: "2026-10-22T11:59:00Z",
            nextPin: "n",
            error: "waiting for the root (connection refused)",
          },
        },
      }),
    )!;
    expect(view.lines.map((l) => l.text)).toContain("Waiting for the root (connection refused)");
  });

  it("says a change is no longer stoppable after the switch", () => {
    const view = describeMachineKey(
      input({
        machine: {
          ...input().machine!,
          keyChange: { state: "switched", startedAt: "2026-10-22T11:59:00Z", nextPin: "n" },
        },
      }),
    )!;
    expect(view.lines[0]?.text).toBe(
      "Changing machine key: NAS presents its new key; the root drops the old one next",
    );
    expect(view.canStop).toBe(false);
    expect(view.canStart).toBe(false);
  });

  it("says when a change finished, and why one failed", () => {
    const done = describeMachineKey(
      input({
        machine: {
          ...input().machine!,
          keyChange: {
            state: "done",
            reason: "scheduled",
            startedAt: "2026-10-22T11:00:00Z",
            finishedAt: "2026-10-22T11:03:00Z",
          },
        },
      }),
    )!;
    expect(done.lines[0]).toEqual({
      text: "Machine key changed by itself [2026-10-22T11:03:00Z]",
      tone: "good",
    });
    const failed = describeMachineKey(
      input({
        machine: {
          ...input().machine!,
          keyChange: {
            state: "failed",
            startedAt: "2026-10-22T11:00:00Z",
            finishedAt: "2026-10-22T11:00:05Z",
            error: "the root refused it (Machine port cannot be a node's)",
          },
        },
      }),
    )!;
    expect(failed.lines[0]).toEqual({
      text: "Machine key not changed: the root refused it (Machine port cannot be a node's)",
      tone: "bad",
    });
    expect(failed.canStart).toBe(true);
  });

  it("says a key past its age is changed within a minute, when it is", () => {
    const view = describeMachineKey(
      input({
        machine: {
          ...input().machine!,
          keyChangeDueAt: "2026-10-01T00:00:00Z",
          keyChangeNextAttemptAt: "2026-10-22T11:59:30Z",
        },
      }),
    )!;
    expect(view.lines[1]?.text).toBe("Due a change; it starts within a minute");
  });

  it("says when an overdue key's change starts, never sooner than the machine will", () => {
    // The catch-up after an update, or a day after a Stop: the machine's own
    // next attempt, not "within a minute" (the review of part 3b).
    const view = describeMachineKey(
      input({
        machine: {
          ...input().machine!,
          keyChangeDueAt: "2026-10-01T00:00:00Z",
          keyChangeNextAttemptAt: "2026-10-25T03:00:00Z",
        },
      }),
    )!;
    expect(view.lines[1]?.text).toBe("Due a change; it starts [2026-10-25T03:00:00Z]");
  });

  it("names why a scheduled change could not start, and when it tries again", () => {
    const view = describeMachineKey(
      input({
        machine: {
          ...input().machine!,
          keyChangeDueAt: "2026-10-01T00:00:00Z",
          keyChangeNextAttemptAt: "2026-10-22T13:00:00Z",
          keyChangeBlocked:
            "The root runs a version that does not take a next machine key. Update the " +
            "machine that runs the root first.",
        },
      }),
    )!;
    expect(view.lines.slice(1)).toEqual([
      {
        text:
          "Key change could not start: The root runs a version that does not take a next " +
          "machine key. Update the machine that runs the root first.",
        tone: "bad",
      },
      { text: "It is tried again [2026-10-22T13:00:00Z]", tone: "muted" },
    ]);
  });

  it("offers nothing on a machine without a listening machine port", () => {
    expect(describeMachineKey(input({ machine: null }))).toBeNull();
    const down = describeMachineKey(
      input({ machine: { ...input().machine!, listening: false, error: "port 8083 is in use" } }),
    )!;
    expect(down.canStart).toBe(false);
    expect(down.lines[0]?.text).toBe("No machine key change: its machine port is not listening");
  });
});

describe("describeMachineKey, the machine that runs the root", () => {
  it("names each machine that must be updated or removed first", () => {
    const view = describeMachineKey(
      input({
        runsRoot: true,
        machine: {
          ...input().machine!,
          keyChange: {
            state: "waiting",
            startedAt: "2026-10-22T11:59:00Z",
            nextPin: "n",
            error: "waiting: old-nas runs a version that cannot take this machine's new key",
          },
        },
        observed: { nextPin: "n", waitingOn: [], unreachable: [], notReady: ["old-nas", "pi"] },
      }),
    )!;
    const texts = view.lines.map((l) => l.text);
    expect(texts).toContain(
      "OLD-NAS and PI must be updated or removed first: they run a version that cannot " +
        "take the new key if they miss the change",
    );
    // Said once, not again in the agent's words.
    expect(texts.filter((t) => t.includes("old-nas") || t.includes("OLD-NAS"))).toHaveLength(1);
  });

  it("does not hold another machine's change for them", () => {
    const view = describeMachineKey(
      input({
        runsRoot: false,
        machine: {
          ...input().machine!,
          keyChange: { state: "waiting", startedAt: "2026-10-22T11:59:00Z", nextPin: "n" },
        },
        observed: { nextPin: "n", waitingOn: [], unreachable: [], notReady: ["old-nas"] },
      }),
    )!;
    expect(view.lines.map((l) => l.text).join(" ")).not.toMatch(/updated or removed/);
  });
});
