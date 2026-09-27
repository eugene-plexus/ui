/**
 * What a machine's update state says, from `GET /v1/node` as the agent
 * answers it (in-app updates, 2026-09-27).
 */

import { describe, expect, it } from "vitest";

import { issuesFrom, type NodeFacts } from "./issues";
import type { NodeIdentity } from "./types";
import { ago, describeUpdate, installerCommand, versionLabel } from "./updates";

const NOW = Date.parse("2026-09-27T18:00:00Z");
const EDGE = "b8b30bd18a790a4af55e9b44786b61be4783adaa";
const OLD_AGENT = "2dcf64522a5cdd5d6756cb89ed2fc832994e5dc9";
const NEW_AGENT = "06c321b6c9599419a602c6d6d7c5773eb53cdff2";

type Update = NonNullable<NodeIdentity["update"]>;

function identity(update: Partial<Update> | null, extra: Partial<NodeIdentity> = {}): NodeIdentity {
  const base: NodeIdentity = {
    enrolled: true,
    name: "Amish_Station",
    os: "windows",
    install: {
      mechanism: "windows_service",
      development: false,
      components: [
        { name: "agent", state: "stamped", commit: OLD_AGENT },
        { name: "control", state: "stamped", commit: "c".repeat(40) },
      ],
    },
    ...extra,
  };
  if (update === null) return base;
  return {
    ...base,
    update: {
      enabled: true,
      channel: "edge",
      channelSource: "inferred",
      checkedAt: "2026-09-27T17:55:00Z",
      available: false,
      behind: [],
      apply: { possible: true },
      ...update,
    },
  };
}

const NEWEST = { channel: "edge" as const, ref: EDGE, components: { agent: NEW_AGENT } };

describe("describeUpdate", () => {
  it("offers the update, and says what it costs", () => {
    const view = describeUpdate(
      identity({ available: true, behind: ["agent", "ui"], newest: NEWEST }),
      NOW,
    );
    expect(view.state).toBe("available");
    expect(view.headline).toBe("A newer version is ready: edge b8b30bd");
    expect(view.detail).toMatch(/^2 of the six parts of Eugene are behind\. Updating restarts/);
    expect(view.canUpdate).toBe(true);
    // What the button sends is exactly what the agent found.
    expect(view.target).toBe(EDGE);
  });

  it("names a release by its tag", () => {
    const view = describeUpdate(
      identity({
        channel: "releases",
        available: true,
        behind: ["agent"],
        newest: {
          channel: "releases",
          ref: "v0.1.0-alpha.4",
          release: "v0.1.0-alpha.4",
          components: {},
        },
      }),
      NOW,
    );
    expect(view.headline).toBe("A newer version is ready: v0.1.0-alpha.4");
  });

  it("gives a container its steps instead of a button", () => {
    const view = describeUpdate(
      identity({
        available: true,
        behind: ["agent"],
        newest: NEWEST,
        apply: {
          possible: false,
          reason: "This machine runs in a container, which cannot update itself.",
          steps: [{ text: "On Unraid's Docker tab, choose Force Update for this container." }],
        },
      }),
      NOW,
    );
    expect(view.state).toBe("manual");
    expect(view.canUpdate).toBe(false);
    expect(view.detail).toMatch(/container/);
    expect(view.steps[0]?.text).toMatch(/Force Update/);
  });

  it("says up to date, and when it last looked", () => {
    const view = describeUpdate(identity({}), NOW);
    expect(view.state).toBe("current");
    expect(view.headline).toBe("Up to date on edge");
    expect(view.detail).toBe("Checked 5 minutes ago.");
  });

  it("says why a check could not finish", () => {
    const view = describeUpdate(
      identity({
        error: "GitHub's limit of 60 requests an hour for this network's address is used up",
      }),
      NOW,
    );
    expect(view.detail).toMatch(/^The last check could not finish: GitHub's limit/);
  });

  it("says an update is running while it is", () => {
    const view = describeUpdate(
      identity({
        available: true,
        newest: NEWEST,
        running: { target: EDGE, startedAt: "2026-09-27T17:59:00Z", outcome: "running" },
      }),
      NOW,
    );
    expect(view.state).toBe("running");
    expect(view.canUpdate).toBe(false);
  });

  it("puts a failed update's own words first, and still offers to try again", () => {
    const view = describeUpdate(
      identity({
        available: true,
        behind: ["agent"],
        newest: NEWEST,
        last: {
          target: EDGE,
          startedAt: "2026-09-27T17:40:00Z",
          finishedAt: "2026-09-27T17:42:00Z",
          outcome: "failed",
          detail: "The installer exited with 1. Its last lines: error: package install failed",
        },
      }),
      NOW,
    );
    expect(view.state).toBe("failed");
    expect(view.detail).toMatch(/exited with 1/);
    expect(view.canUpdate).toBe(true);
  });

  it("tells a machine from before updates existed how to get them", () => {
    const view = describeUpdate(identity(null), NOW);
    expect(view.state).toBe("too-old");
    expect(view.steps[0]?.command).toBe(installerCommand("windows"));
    expect(installerCommand("linux")).toMatch(/^curl -fsSL .*install\.sh \| sh$/);
  });

  it("never offers a development checkout anything", () => {
    const dev = identity(
      { available: true, newest: NEWEST },
      {
        install: {
          mechanism: "none",
          development: true,
          components: [{ name: "agent", state: "development" }],
        },
      },
    );
    const view = describeUpdate(dev, NOW);
    expect(view.state).toBe("development");
    expect(view.canUpdate).toBe(false);
    expect(versionLabel(dev)).toBe("development build");
  });

  it("says nothing it does not know about a machine that did not answer", () => {
    expect(describeUpdate(null, NOW).state).toBe("unknown");
  });
});

describe("versionLabel and ago", () => {
  it("is the agent's own commit, or the release it is exactly", () => {
    expect(versionLabel(identity({}))).toBe("agent 2dcf645");
    expect(
      versionLabel(
        identity({
          channel: "releases",
          newest: {
            channel: "releases",
            ref: "v0.1.0-alpha.3",
            release: "v0.1.0-alpha.3",
            components: {},
          },
        }),
      ),
    ).toBe("v0.1.0-alpha.3");
  });

  it("reads as a person says it", () => {
    expect(ago("2026-09-27T17:59:40Z", NOW)).toBe("just now");
    expect(ago("2026-09-27T16:00:00Z", NOW)).toBe("2 hours ago");
    expect(ago(null, NOW)).toBeNull();
  });
});

function facts(label: string, id: NodeIdentity | null): NodeFacts {
  return {
    name: label,
    label,
    local: false,
    identity: id,
    readWindow: null,
    runtimes: null,
    engines: null,
    folders: null,
    components: null,
  };
}

function sources(perNode: NodeFacts[]) {
  return { controlRoot: null, controlLocked: false, nodes: null, perNode };
}

describe("the issues", () => {
  it("lists a machine that is behind, with where to fix it", () => {
    const issues = issuesFrom(
      sources([
        facts("Amish_Station", identity({ available: true, behind: ["agent"], newest: NEWEST })),
      ]),
    );
    const found = issues.find((i) => i.kind === "update-available");
    expect(found?.title).toBe("A newer version of Eugene is ready for Amish_Station: edge b8b30bd");
    expect(found?.href).toBe("/nodes");
    expect(found?.severity).toBe("warning");
  });

  it("lists a failed update instead, in its own words", () => {
    const issues = issuesFrom(
      sources([
        facts(
          "Amish_Station",
          identity({
            available: true,
            behind: ["agent"],
            newest: NEWEST,
            last: {
              target: EDGE,
              startedAt: "x",
              outcome: "failed",
              detail: "The installer exited with 3.",
            },
          }),
        ),
      ]),
    );
    expect(issues.map((i) => i.kind)).toContain("update-failed");
    expect(issues.map((i) => i.kind)).not.toContain("update-available");
    expect(issues.find((i) => i.kind === "update-failed")?.detail).toBe(
      "The installer exited with 3.",
    );
  });

  it("says machines differ only when none of them is simply behind", () => {
    const other = identity(
      {},
      {
        name: "unraid",
        install: {
          mechanism: "container",
          development: false,
          components: [{ name: "agent", state: "stamped", commit: NEW_AGENT }],
        },
      },
    );
    const differ = issuesFrom(
      sources([facts("Amish_Station", identity({})), facts("unraid", other)]),
    );
    const found = differ.find((i) => i.kind === "versions-differ");
    expect(found?.detail).toMatch(/Amish_Station: 2dcf645; unraid: 06c321b/);
    const behind = issuesFrom(
      sources([
        facts("Amish_Station", identity({ available: true, behind: ["agent"], newest: NEWEST })),
        facts("unraid", other),
      ]),
    );
    expect(behind.map((i) => i.kind)).not.toContain("versions-differ");
  });

  it("says nothing about a development checkout", () => {
    const dev = identity(
      { available: true, newest: NEWEST },
      { install: { mechanism: "none", development: true, components: [] } },
    );
    expect(issuesFrom(sources([facts("dev", dev)]))).toEqual([]);
  });
});
