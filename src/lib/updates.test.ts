/**
 * What a machine's update state says, from `GET /v1/node` as the agent
 * answers it (in-app updates, 2026-09-27).
 */

import { describe, expect, it } from "vitest";

import { issuesFrom, type NodeFacts } from "./issues";
import type { NodeIdentity } from "./types";
import { ago, describeUpdate, versionDifference, versionLabel } from "./updates";

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
      channelSource: "setting",
      checkedAt: "2026-09-27T17:55:00Z",
      available: false,
      behind: [],
      // An agent from 2026-09-30 on says what is newer, too.
      ahead: [],
      apply: { possible: true },
      ...update,
    },
  };
}

const NEWEST = { channel: "edge" as const, ref: EDGE, components: { agent: NEW_AGENT } };

/** A whole install: seven parts since P8 added the tool-driver. */
const SEVEN: NonNullable<NodeIdentity["install"]> = {
  mechanism: "windows_service",
  development: false,
  components: (
    ["agent", "control", "gateway", "inference-driver", "library", "tool-driver", "ui"] as const
  ).map((name) => ({ name, state: "stamped" as const, commit: "c".repeat(40) })),
};

describe("describeUpdate", () => {
  it("offers the update, and says what it costs", () => {
    const view = describeUpdate(
      identity({ available: true, behind: ["agent", "ui"], newest: NEWEST }, { install: SEVEN }),
      NOW,
    );
    expect(view.state).toBe("available");
    expect(view.headline).toBe("A newer version is ready: edge b8b30bd");
    // Counted from the install, not written into the sentence: "six"
    // outlived P8's seventh part by a day.
    expect(view.detail).toMatch(/^2 of the seven parts of Eugene are behind\. Updating restarts/);
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
    const view = describeUpdate(identity({ channelSource: "setting" }), NOW);
    expect(view.state).toBe("current");
    expect(view.headline).toBe("Up to date on edge");
    expect(view.detail).toBe("Checked 5 minutes ago.");
  });

  it("says when a channel was not chosen but is the default", () => {
    // Troy's worker, 2026-09-29: channel never set, so it followed releases
    // and read "up to date" while edge had moved.
    const view = describeUpdate(identity({ channel: "releases", channelSource: "default" }), NOW);
    expect(view.headline).toBe("Up to date on releases");
    expect(view.detail).toBe(
      "Checked 5 minutes ago. It follows releases, the default. To follow edge, set Update " +
        "channel under Settings › Updates.",
    );
  });

  it("says why a check could not finish", () => {
    const view = describeUpdate(
      identity({
        error: "GitHub's limit of 60 requests an hour for this network's address is used up",
      }),
      NOW,
    );
    expect(view.detail).toMatch(/^The last check could not finish: GitHub's limit/);
    expect(view.state).toBe("check-failed");
    expect(view.headline).not.toContain("Up to date");
  });

  it("does not call differing installations up to date when no update is offered yet", () => {
    const view = describeUpdate(identity({ newest: NEWEST }), NOW, true);
    expect(view.state).toBe("different");
    expect(view.headline).toBe("No newer update found on edge");
    expect(view.canUpdate).toBe(false);
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

  it("is unknown, with its own words, for a machine that answered without update status", () => {
    const view = describeUpdate(identity(null), NOW);
    expect(view.state).toBe("unknown");
    expect(view.detail).toBe("This machine did not report its update status.");
    expect(view.canUpdate).toBe(false);
  });
});

describe("only a newer version is called newer (settings never lie, 2026-09-30)", () => {
  const OLDER = {
    channel: "releases" as const,
    ref: "v0.1.0-alpha.5",
    release: "v0.1.0-alpha.5",
    components: {},
  };

  it("an available update is called newer, and offered", () => {
    const view = describeUpdate(
      identity({ available: true, behind: ["agent"], newest: NEWEST, ahead: [] }),
      NOW,
    );
    expect(view.headline).toBe(`A newer version is ready: edge ${EDGE.slice(0, 7)}`);
    expect(view.canUpdate).toBe(true);
  });

  it("a machine newer than its channel's newest is told so, and offered nothing", () => {
    // Installed from main, following releases: alpha.5 is OLDER.
    const view = describeUpdate(
      identity(
        {
          channel: "releases",
          channelSource: "default",
          available: false,
          behind: [],
          ahead: ["agent", "ui"],
          newest: OLDER,
        },
        { install: SEVEN },
      ),
      NOW,
    );
    expect(view.state).toBe("ahead");
    expect(view.headline).toBe("Newer than the newest on releases");
    expect(view.detail).toContain("Two of the seven parts are newer than v0.1.0-alpha.5");
    expect(view.detail).toContain("It follows releases, the default. To follow edge");
    expect(view.canUpdate).toBe(false);
    expect(versionLabel(identity({ ahead: ["agent"], newest: OLDER }))).toBe("agent 2dcf645");
  });

  it("a mixed install is offered nothing that would move a part back", () => {
    const view = describeUpdate(
      identity({ available: false, behind: ["gateway"], ahead: ["agent"], newest: NEWEST }),
      NOW,
    );
    expect(view.state).toBe("mixed");
    expect(view.canUpdate).toBe(false);
    expect(view.detail).toContain("would move the newer ones back");
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
  it("detects a UI-only release using full commits, without comparing absent components", () => {
    const local = identity({}, { install: structuredClone(SEVEN) });
    const remote = identity({}, { install: structuredClone(SEVEN) });
    remote.install!.components = remote.install!.components.filter(
      (part) => part.name !== "control",
    );
    expect(versionDifference([facts("NAS", local), facts("worker", remote)])).toBeNull();
    remote.install!.components.find((part) => part.name === "ui")!.commit = "c".repeat(39) + "d";
    const nodes = [facts("NAS", local), facts("worker", remote)];
    expect(versionDifference(nodes)?.detail).toContain("ui ccccccc");
    expect(issuesFrom(sources(nodes)).map((issue) => issue.kind)).toContain("versions-differ");
  });

  it("explains differing channels instead of implying an update is available", () => {
    const a = identity({ channel: "edge" }, { install: structuredClone(SEVEN) });
    const b = identity({ channel: "releases" });
    const difference = versionDifference([facts("NAS", a), facts("worker", b)]);
    expect(difference?.detail).toContain("different update channels");
    expect(difference?.detail).not.toContain("release checks finish");
  });

  it("does not offer an update in the badge when the card says it is already running", () => {
    const running = identity({
      available: true,
      newest: NEWEST,
      running: { target: EDGE, startedAt: new Date().toISOString(), outcome: "running" },
    });
    expect(issuesFrom(sources([facts("worker", running)]))).toEqual([]);
  });
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
