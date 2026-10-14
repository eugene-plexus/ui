/**
 * The tree model, against the topologies that actually occur.
 *
 * The fixtures are the ones this install produces: a single box before
 * enrollment, an enrolled box that is alone, the live two-machine
 * install, a worker whose control root is sealed, and the large install
 * the design's §0.1 sized (ten nodes, four drivers each) that the tab
 * strip could not hold. The first two are one machine and render
 * without the machine level under Backends and Library (hobbyist-ux.md
 * §6.4); the rest have it. Machines lists its one machine either way
 * (ui-settings-reorganisation.md, decision #3).
 *
 * `buildTree` is pure, so all of that is assertable with no browser and
 * no running fleet — which matters because the sealed-root case is the
 * one nobody can produce on demand.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildTree,
  configTabFor,
  DEFAULT_INSTALL_NAME,
  findNode,
  findSelected,
  flatten,
  formatSelection,
  hrefFor,
  defaultSelectionFor,
  pageRoutes,
  parseSelection,
  selectionFromConfigTab,
  THIS_MACHINE,
  activePage,
  type Topology,
  type TreeNode,
} from "./resourceTree";

/** A standalone box: nothing enrolled, all three singletons local. */
const STANDALONE: Topology = {
  localNode: null,
  nodes: [],
  components: [
    { name: "gateway", kind: "gateway", node: null },
    { name: "library", kind: "library", node: null },
    { name: "control", kind: "control", node: null },
  ],
};

/**
 * One box, first run, with a model launched — the commonest install
 * there is. Nothing is enrolled, so there is **no node name anywhere**:
 * `GET /v1/node` carries none and the registry is empty, and the
 * companion driver the agent declared locally has no `node` field.
 *
 * The first version of this file had no such fixture, and the first
 * version of `driverBranch` dropped every driver in this topology.
 */
const STANDALONE_WITH_DRIVER: Topology = {
  localNode: null,
  nodes: [],
  components: [
    { name: "gateway", kind: "gateway", node: null },
    { name: "library", kind: "library", node: null },
    { name: "control", kind: "control", node: null },
    { name: "qwen3-8b", kind: "inference-driver", node: null },
  ],
};

/**
 * An enrolled machine that is alone: the registry holds it and nothing
 * else, and a model is launched. This is a hobbyist's box after the
 * wizard, and the shape decision #10 of the hobbyist UX plan is about.
 */
const ONE_NODE: Topology = {
  localNode: "solo",
  nodes: ["solo"],
  components: [
    { name: "gateway", kind: "gateway", node: "solo" },
    { name: "library", kind: "library", node: "solo" },
    { name: "control", kind: "control", node: "solo" },
    { name: "qwen3-8b", kind: "inference-driver", node: "solo" },
  ],
};

/** The live install: a NAS holding the singletons, one GPU worker. */
const TWO_MACHINE: Topology = {
  localNode: "Amish_Station",
  nodes: ["nas", "Amish_Station"],
  installName: "Home",
  components: [
    { name: "gateway", kind: "gateway", node: "nas" },
    { name: "library", kind: "library", node: "nas" },
    { name: "control", kind: "control", node: "nas" },
    { name: "ollama-qwen", kind: "inference-driver", node: "Amish_Station" },
  ],
};

/**
 * A worker whose root is sealed or unreachable. `installPlacement` and
 * `installNodes` both return empty, which is what the config page's own
 * comment describes: "this host's own topology is the whole answer".
 */
const SEALED: Topology = {
  localNode: "Amish_Station",
  nodes: [],
  rootUnreachable: true,
  components: [{ name: "ollama-qwen", kind: "inference-driver", node: null }],
};

function largeInstall(nodeCount: number, driversEach: number): Topology {
  const nodes = Array.from({ length: nodeCount }, (_, i) => `node-${String(i).padStart(2, "0")}`);
  const components = [
    { name: "gateway", kind: "gateway", node: nodes[0]! },
    { name: "library", kind: "library", node: nodes[0]! },
    { name: "control", kind: "control", node: nodes[0]! },
    ...nodes.flatMap((n) =>
      Array.from({ length: driversEach }, (_, j) => ({
        name: `llama-${j}`,
        kind: "inference-driver",
        node: n,
      })),
    ),
  ];
  return { localNode: nodes[0]!, nodes, components };
}

const labels = (n: TreeNode) => n.children.map((c) => c.label);
const branchOf = (tree: TreeNode, label: string) => tree.children.find((c) => c.label === label);
const kinds = (tree: TreeNode) => new Set(flatten(tree).map((n) => n.kind));

describe("the branches", () => {
  it("reads in the order of a hobbyist's questions: models, running, gateway, machines", () => {
    // 2026-09-29 (ui-settings-reorganisation.md, decision #5). It read
    // down the architecture page, gateway first, before; the layer map
    // still does.
    expect(labels(buildTree(TWO_MACHINE))).toEqual([
      "Library",
      "Backends",
      "Gateway",
      "Machines",
      "Job sites",
    ]);
  });

  it("carries the implementation noun on hover, not in the label", () => {
    // hobbyist-ux.md decision #12's condition: the jargon stays available
    // to an expert. `expert` is what the row's title carries.
    const tree = buildTree(TWO_MACHINE);
    expect(branchOf(tree, "Backends")?.expert).toBe("inference drivers");
    expect(branchOf(tree, "Machines")?.expert).toBe("control root and agents");
    expect(findNode(tree, "agent:nas")?.expert).toBe("agent");
    expect(findNode(tree, "driver:ollama-qwen@Amish_Station")?.expert).toBe("inference driver");
  });

  it("gives a singleton no node level, because there is exactly one", () => {
    const gateway = findNode(buildTree(TWO_MACHINE), "gateway");
    expect(gateway?.kind).toBe("leaf");
    expect(gateway?.children).toEqual([]);
    // It still says which machine it is on.
    expect(gateway?.node).toBe("nas");
  });

  it("omits a singleton the topology does not contain, and never Backends or Machines", () => {
    // Backends always exists: "running nothing" must not read as "no
    // such thing". Machines always exists: this machine has settings and
    // a log whether or not a root answered.
    const tree = buildTree({ ...TWO_MACHINE, components: [] });
    expect(labels(tree)).toEqual(["Backends", "Machines", "Job sites"]);
    expect(findNode(tree, "gateway")).toBeNull();
    expect(findNode(tree, "library")).toBeNull();
  });

  it("puts one machine leaf per machine under Machines, this one first", () => {
    const machines = branchOf(buildTree(TWO_MACHINE), "Machines");
    expect(machines?.sel).toBe("control");
    expect(machines?.kind).toBe("branch");
    expect(machines?.children.map((c) => c.label)).toEqual(["Amish_Station", "nas"]);
    expect(machines?.children[0]?.hint).toBe("this machine");
    expect(machines?.children[0]?.sel).toBe("agent:Amish_Station");
    expect(machines?.children[0]?.layer).toBe("agent");
  });

  it("makes the Backends branch selectable, with the Inference page as its Overview", () => {
    // Troy's report (2026-09-29): the branch called Inference drivers held
    // only each driver's config while the page that starts and stops a
    // model was on the install root. The branch owns the page now.
    const backends = branchOf(buildTree(TWO_MACHINE), "Backends");
    expect(backends?.sel).toBe("backends");
    expect(backends?.pages.map((p) => [p.label, p.route])).toEqual([
      ["Overview", "/inference"],
      ["Add a backend", "/backends/add"],
      ["Add a search account", "/backends/search"],
    ]);
  });
});

describe("drivers are grouped by machine", () => {
  it("keeps two same-named drivers on two machines distinct", () => {
    // The proxy resolves a bare name to the first it finds, so a leaf's
    // identity has to be name@node.
    const tree = buildTree({
      localNode: "a",
      nodes: ["a", "b"],
      components: [
        { name: "llama-1", kind: "inference-driver", node: "a" },
        { name: "llama-1", kind: "inference-driver", node: "b" },
      ],
    });
    const sels = flatten(tree)
      .map((n) => n.sel)
      .filter((s): s is string => !!s && s.startsWith("driver:"));
    expect(sels).toEqual(["driver:llama-1@a", "driver:llama-1@b"]);
    expect(new Set(sels).size).toBe(2);
  });

  it("shows a machine with no drivers as an empty group, not as absent", () => {
    // "running nothing" and "not in the install" must not look the same.
    const drivers = branchOf(buildTree(TWO_MACHINE), "Backends");
    const nas = drivers?.children.find((c) => c.label === "nas");
    expect(nas, "nas is missing from the driver branch").toBeTruthy();
    expect(nas?.children).toEqual([]);
    expect(nas?.hint).toBe("none");
    // A group is selectable: its Overview is the page opened on that
    // machine alone.
    expect(nas?.sel).toBe("backends:node:nas");
    expect(nas?.pages.map((p) => p.route)).toEqual(["/inference"]);
  });

  it("keeps a standalone box's drivers visible when nothing has a name", () => {
    // The defect this fixture exists for: with no node name anywhere,
    // grouping by label dropped every driver on the commonest install
    // shape there is. One machine, so the leaf hangs straight off the
    // type (§6.4), and its `sel` is the bare `driver:<name>` because
    // there is no machine name to qualify it with.
    const drivers = branchOf(buildTree(STANDALONE_WITH_DRIVER), "Backends");
    expect(drivers?.children.map((c) => c.sel)).toEqual(["driver:qwen3-8b"]);
    expect(drivers?.children[0]?.kind).toBe("leaf");
    expect(drivers?.children[0]?.pages.map((p) => p.label)).toEqual(["Overview", "Settings"]);
  });

  it("gives a standalone box a machine leaf under Machines with the token Config already uses", () => {
    // One machine: a leaf called This machine under Machines, with the
    // bare `agent` token a query-less /config used to ask for.
    const tree = buildTree(STANDALONE_WITH_DRIVER);
    const agent = findNode(tree, "agent");
    expect(agent?.kind).toBe("leaf");
    expect(agent?.label).toBe(THIS_MACHINE);
    expect(agent?.hint).toBe("this machine");
    expect(agent?.local).toBe(true);
    expect(branchOf(tree, "Machines")?.children).toContain(agent);
  });

  it("surfaces a driver whose node is not in the registry, as its own group", () => {
    const tree = buildTree({
      localNode: "a",
      nodes: ["a"],
      components: [{ name: "ghost", kind: "inference-driver", node: "gone" }],
    });
    const drivers = branchOf(tree, "Backends");
    const unplaced = drivers?.children.find((c) => c.label === "gone");
    expect(unplaced?.hint).toBe("no node in the registry");
    expect(unplaced?.children.map((c) => c.sel)).toEqual(["driver:ghost@gone"]);
  });

  it("attributes a node-less local driver to this machine", () => {
    // A worker's own /v1/components carries no `node` field. The root is
    // sealed, so the registry is empty and this is the only machine the
    // tree can see: no group row, but the machine is in the leaf's own
    // `sel` — the token carries it, not the row above.
    const drivers = branchOf(buildTree(SEALED), "Backends");
    expect(drivers?.children.map((c) => c.sel)).toEqual(["driver:ollama-qwen@Amish_Station"]);
    expect(drivers?.children[0]?.node).toBe("Amish_Station");
  });
});

describe("the root is the install, not the control root", () => {
  it("labels itself from the install name, and falls back", () => {
    expect(buildTree(TWO_MACHINE).label).toBe("Home");
    expect(buildTree(STANDALONE).label).toBe(DEFAULT_INSTALL_NAME);
    expect(buildTree({ ...TWO_MACHINE, installName: "   " }).label).toBe(DEFAULT_INSTALL_NAME);
  });

  it("still renders this machine when the control root is sealed", () => {
    // The whole argument for decision #1. A restarted container comes
    // back sealed while every health check says ok; the operator must
    // not also lose the branch describing the box they are sitting at.
    const tree = buildTree(SEALED);
    expect(tree.hint).toBe("control root unreachable");
    // Alone as far as it can see, so its agent is the Agent leaf itself,
    // addressed by the name it does have.
    const agent = findNode(tree, "agent:Amish_Station");
    expect(agent?.kind).toBe("leaf");
    expect(agent?.local).toBe(true);
    expect(findNode(tree, "driver:ollama-qwen@Amish_Station")).toBeTruthy();
    // And says nothing it cannot know: no gateway, because a worker
    // declares none and the root could not be asked.
    expect(findNode(tree, "gateway")).toBeNull();
  });

  it("carries the install-wide pages and no layer", () => {
    const tree = buildTree(TWO_MACHINE);
    expect(tree.layer).toBeNull();
    // Home first (S1): a first-time user lands on what is running and
    // what to do next, not on a diagnostic. The Inference page left for
    // the Backends branch and Preferences folded into Settings
    // (2026-09-29).
    expect(tree.pages.map((p) => p.id)).toEqual([
      "home",
      "playground",
      "apps",
      "people",
      "logs",
      "config",
    ]);
    expect(tree.pages.map((p) => p.route)).toEqual([
      "/",
      "/playground",
      "/apps",
      "/people",
      "/logs",
      "/config",
    ]);
    expect(tree.pages.at(-1)?.label).toBe("Settings");
  });
});

describe("it holds the install the tab strip could not", () => {
  it("renders ten nodes with four drivers each as a bounded tree", () => {
    // §0.1: this topology is 54 buttons in a horizontal strip.
    const tree = buildTree(largeInstall(10, 4));
    expect(tree.children).toHaveLength(5);
    const drivers = branchOf(tree, "Backends");
    expect(drivers?.children).toHaveLength(10);
    expect(drivers?.children.every((g) => g.children.length === 4)).toBe(true);
    const leaves = flatten(tree).filter((n) => n.kind === "leaf");
    // 40 drivers, 10 machines, 2 singleton leaves (Machines is a branch),
    // and the 10 machines under Library.
    expect(leaves).toHaveLength(40 + 10 + 2 + 10);
    // The top level stays five whatever the install does.
    expect(tree.children).toHaveLength(5);
  });
});

describe("the machine level appears only once there is more than one machine", () => {
  // hobbyist-ux.md §6.4, decision #10 (Troy, 2026-09-15). Before it, the
  // standalone install showed four rows reading "This machine" under
  // three branches, describing a fleet the user does not have.

  it("hangs one machine's drivers straight off the type, with the same sel", () => {
    const tree = buildTree(ONE_NODE);
    const drivers = branchOf(tree, "Backends");
    expect(drivers?.children.map((c) => c.sel)).toEqual(["driver:qwen3-8b@solo"]);
    expect(drivers?.children.every((c) => c.kind === "leaf")).toBe(true);
    expect(drivers?.hint).toBeUndefined();
    expect(kinds(tree).has("nodeGroup")).toBe(false);
    // Selectable either way: the branch's Overview is the page.
    expect(drivers?.sel).toBe("backends");
  });

  it("lists the one machine under Machines by its name, with this machine's pages", () => {
    // Machines keeps its machine row on a one-box install
    // (ui-settings-reorganisation.md, decision #3): one row, replacing
    // the `Agent · this machine` leaf that stood on its own before, and
    // not the four rows §6.4 removed.
    const tree = buildTree(ONE_NODE);
    const agent = findNode(tree, "agent:solo");
    expect(agent?.kind).toBe("leaf");
    expect(agent?.label).toBe("solo");
    expect(agent?.hint).toBe("this machine");
    expect(agent?.local).toBe(true);
    expect(agent?.pages.map((p) => p.id)).toEqual(["config", "logs"]);
    const machines = branchOf(tree, "Machines");
    expect(machines?.children).toEqual([agent]);
    expect(machines?.pages.map((p) => [p.label, p.route])).toEqual([
      ["Overview", "/nodes"],
      ["Settings", "/config"],
    ]);
    expect(tree.children.map((c) => c.label)).not.toContain("Agents");
    expect(tree.children.map((c) => c.label)).not.toContain("Agent");
  });

  it("gives Library no machine rows, and keeps its Folders page", () => {
    const library = findNode(buildTree(ONE_NODE), "library");
    expect(library?.children).toEqual([]);
    expect(library?.pages.map((p) => p.id)).toContain("folders");
  });

  it("says a lone machine with no drivers is running nothing, on the branch", () => {
    // The empty group's `none` moves onto the branch: "running nothing"
    // and "not in the install" still do not look the same.
    const drivers = branchOf(buildTree(STANDALONE), "Backends");
    expect(drivers?.children).toEqual([]);
    expect(drivers?.hint).toBe("none");
  });

  it("restores the level everywhere the moment a second node enrolls", () => {
    const tree = buildTree({ ...ONE_NODE, nodes: ["solo", "nas"] });
    const drivers = branchOf(tree, "Backends");
    expect(drivers?.children.map((c) => [c.kind, c.label, c.hint, c.sel])).toEqual([
      ["nodeGroup", "solo", undefined, "backends:node:solo"],
      ["nodeGroup", "nas", "none", "backends:node:nas"],
    ]);
    expect(drivers?.children[0]?.children.map((c) => c.sel)).toEqual(["driver:qwen3-8b@solo"]);
    const machines = branchOf(tree, "Machines");
    expect(machines?.kind).toBe("branch");
    expect(machines?.children.map((c) => c.sel)).toEqual(["agent:solo", "agent:nas"]);
    expect(findNode(tree, "library")?.children.map((c) => c.sel)).toEqual([
      "library:node:solo",
      "library:node:nas",
    ]);
  });

  it("counts a machine a driver names that the registry lacks", () => {
    // Two machines as far as the operator can see, and the flagged group
    // is what says something is wrong; collapsing would hide it.
    const tree = buildTree({
      ...ONE_NODE,
      components: [
        ...ONE_NODE.components,
        { name: "ghost", kind: "inference-driver", node: "gone" },
      ],
    });
    const drivers = branchOf(tree, "Backends");
    expect(drivers?.children.map((c) => [c.kind, c.label, c.hint])).toEqual([
      ["nodeGroup", "solo", undefined],
      ["nodeGroup", "gone", "no node in the registry"],
    ]);
    // The registry is still the only source of machines (design §14.2).
    expect(branchOf(tree, "Machines")?.children.map((c) => c.sel)).toEqual(["agent:solo"]);
    expect(findNode(tree, "library")?.children.map((c) => c.sel)).toEqual(["library:node:solo"]);
  });

  it("names the nameless machine only once there is another to tell it from", () => {
    // An unenrolled box whose placement names a second machine: two
    // groups, and "This machine" finally has something to be
    // distinguished from.
    const tree = buildTree({
      ...STANDALONE_WITH_DRIVER,
      components: [
        ...STANDALONE_WITH_DRIVER.components,
        { name: "ghost", kind: "inference-driver", node: "gone" },
      ],
    });
    const drivers = branchOf(tree, "Backends");
    expect(drivers?.children.map((c) => c.label)).toEqual([THIS_MACHINE, "gone"]);
    expect(drivers?.children[0]?.children.map((c) => c.sel)).toEqual(["driver:qwen3-8b"]);
    // The nameless group's token, mirroring the Library's.
    expect(drivers?.children[0]?.sel).toBe("backends:node");
  });

  it("selects the direct driver leaf and the machine leaf by their tokens", () => {
    // §13.2's silent defect, on the new shape: the tree and the page
    // menu read one topology, so what the URL names must resolve to a
    // row here or the menu renders nothing.
    const tree = buildTree(ONE_NODE);
    const driver = findSelected(tree, "driver:qwen3-8b@solo");
    expect(driver?.sel).toBe("driver:qwen3-8b@solo");
    expect(branchOf(tree, "Backends")?.children).toContain(driver);
    // The bare tokens a query-less /config and a legacy ?tab= produce.
    expect(findSelected(tree, "agent")?.sel).toBe("agent:solo");
    expect(findSelected(tree, "agent:solo")?.sel).toBe("agent:solo");
    expect(findSelected(tree, "driver:qwen3-8b")?.sel).toBe("driver:qwen3-8b@solo");
  });

  it("lands a backends:node link on the branch when there are no groups", () => {
    // The same flip as the Library's: a group link from a two-machine
    // day resolves to the branch, whose Overview is the same page.
    expect(findSelected(buildTree(ONE_NODE), "backends:node:solo")?.sel).toBe("backends");
    expect(findSelected(buildTree(STANDALONE), "backends:node")?.sel).toBe("backends");
    expect(findSelected(buildTree(TWO_MACHINE), "backends:node:ghost")).toBeNull();
    expect(findSelected(buildTree(TWO_MACHINE), "backends:node")?.sel).toBe(
      "backends:node:Amish_Station",
    );
  });

  it("lands a library:node link on the Library leaf when there are no machine rows", () => {
    expect(findSelected(buildTree(ONE_NODE), "library:node:solo")?.sel).toBe("library");
    expect(findSelected(buildTree(STANDALONE), "library:node")?.sel).toBe("library");
    // With two machines a name no row carries is stale and selects
    // nothing, and the bare token is still this machine's row.
    expect(findSelected(buildTree(TWO_MACHINE), "library:node:ghost")).toBeNull();
    expect(findSelected(buildTree(TWO_MACHINE), "library:node")?.sel).toBe(
      "library:node:Amish_Station",
    );
  });

  it("keeps the two-machine install's machine level", () => {
    const tree = buildTree(TWO_MACHINE);
    expect(kinds(tree).has("nodeGroup")).toBe(true);
    expect(branchOf(tree, "Machines")?.children).toHaveLength(2);
    expect(findNode(tree, "library")?.children).toHaveLength(2);
  });
});

describe("the page menu", () => {
  it("gives each object the pages the design lists", () => {
    // ui-settings-reorganisation.md §1: Settings everywhere Config was,
    // Overview where the object's page is an existing screen.
    const tree = buildTree(TWO_MACHINE);
    const pagesOf = (sel: string) => findNode(tree, sel)?.pages.map((p) => p.label);
    expect(pagesOf("gateway")).toEqual(["Metrics", "Routing", "Settings"]);
    expect(pagesOf("library")).toEqual(["Models", "Discover", "Folders", "Settings"]);
    expect(pagesOf("library:node:nas")).toEqual(["Folders"]);
    expect(pagesOf("backends")).toEqual(["Overview", "Add a backend", "Add a search account"]);
    expect(pagesOf("backends:node:nas")).toEqual(["Overview"]);
    expect(pagesOf("control")).toEqual(["Overview", "Settings"]);
    expect(pagesOf("agent:nas")).toEqual(["Settings", "Logs"]);
    expect(pagesOf("driver:ollama-qwen@Amish_Station")).toEqual(["Overview", "Settings"]);
  });

  it("says Config nowhere: the word a person reads is Settings", () => {
    for (const node of flatten(buildTree(TWO_MACHINE))) {
      for (const page of node.pages) expect(page.label).not.toBe("Config");
    }
  });

  it("points every page at a route that exists", () => {
    // By page file, not by top-level directory: `/library/folders` is a
    // nested route (2026-09-14), and a directory listing one level deep
    // would have called it missing.
    const appDir = resolve(process.cwd(), "src", "app");
    const missing = pageRoutes().filter(
      (r) => r !== "/" && !existsSync(join(appDir, ...r.split("/").filter(Boolean), "page.tsx")),
    );
    expect(missing, `page routes with no page: ${missing.join(", ")}`).toEqual([]);
  });

  it("resolves which page a pathname is showing", () => {
    const pages = findNode(buildTree(TWO_MACHINE), "library")!.pages;
    expect(activePage(pages, "/library/")?.id).toBe("models");
    expect(activePage(pages, "/discover/?q=qwen")?.id).toBe("discover");
    expect(activePage(pages, "/config/")?.id).toBe("config");
    expect(activePage(pages, "/metrics/")).toBeNull();
    // `/` is exact: as a prefix it would match every path. Home is `/`
    // and the playground is `/playground` (S1), so the two do not shadow
    // each other.
    const install = findNode(buildTree(TWO_MACHINE), "install")!.pages;
    expect(activePage(install, "/library/")?.id).toBe(undefined);
    expect(activePage(install, "/")?.id).toBe("home");
    expect(activePage(install, "/playground/")?.id).toBe("playground");
  });
});

describe("selection round-trips", () => {
  it.each([
    ["install", { type: "install", node: null, name: null }],
    ["gateway", { type: "gateway", node: null, name: null }],
    ["library", { type: "library", node: null, name: null }],
    ["control", { type: "control", node: null, name: null }],
    ["sites", { type: "sites", node: null, name: null }],
    [
      "site:s-abcdefghijklmnopqrstuvwxyz",
      { type: "site", node: null, name: "s-abcdefghijklmnopqrstuvwxyz" },
    ],
    ["agent", { type: "agent", node: null, name: null }],
    ["agent:Amish_Station", { type: "agent", node: "Amish_Station", name: null }],
    ["library:node", { type: "libraryNode", node: null, name: null }],
    ["library:node:nas", { type: "libraryNode", node: "nas", name: null }],
    ["backends", { type: "backends", node: null, name: null }],
    ["backends:node", { type: "backendsNode", node: null, name: null }],
    ["backends:node:nas", { type: "backendsNode", node: "nas", name: null }],
    ["driver:qwen3-8b", { type: "driver", node: null, name: "qwen3-8b" }],
    ["driver:llama-1@node-b", { type: "driver", node: "node-b", name: "llama-1" }],
  ])("parses %s", (raw, expected) => {
    expect(parseSelection(raw)).toEqual(expected);
    expect(formatSelection(expected as never)).toBe(raw);
  });

  it("selects nothing for a malformed or stale value, rather than the wrong thing", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "   ",
      "nope",
      "agent:",
      "driver:",
      "driver:@n",
      "site:",
    ]) {
      expect(parseSelection(bad), `"${bad}" should select nothing`).toBeNull();
    }
  });

  it("keeps an @ inside a driver name", () => {
    // The node is after the LAST @, so a driver called `a@b` on `n`
    // still resolves.
    expect(parseSelection("driver:a@b@n")).toEqual({ type: "driver", node: "n", name: "a@b" });
  });

  it("every leaf in every fixture round-trips its own sel", () => {
    const every = [
      STANDALONE,
      STANDALONE_WITH_DRIVER,
      ONE_NODE,
      TWO_MACHINE,
      SEALED,
      largeInstall(3, 2),
    ];
    for (const node of every.flatMap((t) => flatten(buildTree(t)))) {
      if (!node.sel) continue;
      const parsed = parseSelection(node.sel);
      expect(parsed, `${node.sel} did not parse`).toBeTruthy();
      expect(formatSelection(parsed!)).toBe(node.sel);
    }
  });
});

describe("hrefs and the Config page's existing addressing", () => {
  it("appends the selection as a query parameter", () => {
    const page = { id: "config", label: "Config", route: "/config", icon: "Server" as const };
    expect(hrefFor(page, "agent:nas")).toBe("/config?sel=agent%3Anas");
    expect(hrefFor(page, null)).toBe("/config");
  });

  it("translates a selection into the proxy target Config already understands", () => {
    // Config predates the tree and addresses its subject by proxy
    // target. Keeping the translation pure is what lets the tree write
    // URLs the existing page understands with no rewrite.
    const local = "Amish_Station";
    expect(configTabFor(parseSelection("gateway")!, local)).toBe("gateway");
    expect(configTabFor(parseSelection("agent:Amish_Station")!, local)).toBe("agent");
    expect(configTabFor(parseSelection("agent:nas")!, local)).toBe("node:nas");
    expect(configTabFor(parseSelection("driver:ollama-qwen@nas")!, local)).toBe("ollama-qwen");
    expect(configTabFor(parseSelection("install")!, local)).toBeNull();
    // The Backends rows have no settings of their own.
    expect(configTabFor(parseSelection("backends")!, local)).toBeNull();
    expect(configTabFor(parseSelection("backends:node:nas")!, local)).toBeNull();
  });

  it("calls the local agent 'agent' even before this node has a name", () => {
    expect(configTabFor({ type: "agent", node: null, name: null }, null)).toBe("agent");
  });
});

describe("an old link still lands on the right object", () => {
  it("maps every route the UI had before the tree", () => {
    expect(defaultSelectionFor("/")).toBe("install");
    expect(defaultSelectionFor("/playground/")).toBe("install");
    // The Inference page is the Backends branch's own (2026-09-29): a
    // bare `/inference` -- Home's Running card, every script -- lights
    // that row and gets that menu.
    expect(defaultSelectionFor("/inference/")).toBe("backends");
    expect(defaultSelectionFor("/backends/add/")).toBe("backends");
    expect(defaultSelectionFor("/metrics/")).toBe("gateway");
    // The Routing page is the gateway's (2026-09-21): a bare `/routing`
    // link — a bookmark, the Config page's cross-link — must light the
    // gateway row, or the page menu renders nothing, silently.
    expect(defaultSelectionFor("/routing/")).toBe("gateway");
    expect(defaultSelectionFor("/library/?model=x")).toBe("library");
    expect(defaultSelectionFor("/discover/")).toBe("library");
    expect(defaultSelectionFor("/nodes/")).toBe("control");
  });

  it("resolves /config from the ?tab= it has always taken", () => {
    // The launch panel's "map it" link writes `?tab=node:<name>`, and
    // that link exists in a shipped build.
    expect(defaultSelectionFor("/config/", "node:Amish_Station")).toBe("agent:Amish_Station");
    expect(defaultSelectionFor("/config/", "gateway")).toBe("gateway");
    expect(defaultSelectionFor("/config/", "ui")).toBe("install");
    expect(defaultSelectionFor("/config/", "ollama-qwen")).toBe("driver:ollama-qwen");
    // Bare, every setting on the install (2026-09-29); it was this
    // machine's agent, which is the object a hobbyist is least likely to
    // mean.
    expect(defaultSelectionFor("/config/")).toBe("install");
  });

  it("round-trips a legacy tab through the selection and back", () => {
    for (const tab of ["ui", "agent", "gateway", "library", "control", "node:nas", "ollama-qwen"]) {
      const sel = selectionFromConfigTab(tab);
      const parsed = parseSelection(sel!);
      expect(parsed, `${tab} produced an unparseable selection`).toBeTruthy();
      // `ui` is the one that does not round-trip: it is browser
      // preferences, which the tree hangs on the install root.
      if (tab === "ui") continue;
      expect(configTabFor(parsed!, "Amish_Station")).toBe(tab === "node:nas" ? "node:nas" : tab);
    }
  });

  it("selects nothing for a route that is not a page", () => {
    expect(defaultSelectionFor("/login/")).toBeNull();
    expect(defaultSelectionFor("/setup/")).toBeNull();
    expect(defaultSelectionFor("/nope")).toBeNull();
    expect(defaultSelectionFor(null)).toBeNull();
  });

  it("keeps browser preferences reachable through the install root's Settings", () => {
    // Nothing may become unreachable in the move: the old `ui` tab held
    // the theme and font-size controls, then a Preferences page, and now
    // the Appearance card of Settings -- the same route, the same
    // selection, so a `?tab=ui` link still arrives.
    const install = findNode(buildTree(TWO_MACHINE), "install");
    expect(install?.pages.map((p) => p.id)).toEqual([
      "home",
      "playground",
      "apps",
      "people",
      "logs",
      "config",
    ]);
    expect(selectionFromConfigTab("ui")).toBe("install");
  });
});

describe("installed apps", () => {
  const withApps = (apps: Topology["apps"]): Topology => ({ ...TWO_MACHINE, apps });

  it("adds no branch until something is installed", () => {
    // The catalogue is the install root's Apps page; an empty branch is a
    // thing to click that holds nothing, like a missing singleton.
    expect(labels(buildTree(TWO_MACHINE))).not.toContain("Apps");
    expect(labels(buildTree(withApps([])))).not.toContain("Apps");
  });

  it("draws Apps first, the layer above the front door, grouped by machine", () => {
    const tree = buildTree(
      withApps([
        { id: "chat", name: "Chat", node: "nas" },
        { id: "connector", name: "Discord", node: "Amish_Station" },
      ]),
    );
    expect(labels(tree)[0]).toBe("Apps");
    const apps = tree.children[0]!;
    expect(apps.layer).toBe("tools");
    // Only machines with an app get a group, in the tree's machine order.
    expect(apps.children.map((g) => g.label)).toEqual(["Amish_Station", "nas"]);
    expect(apps.children.map((g) => g.children.map((c) => c.sel))).toEqual([
      ["app:connector@Amish_Station"],
      ["app:chat@nas"],
    ]);
    const chat = findNode(tree, "app:chat@nas");
    expect(chat?.pages.map((p) => p.route)).toEqual(["/apps/app", "/apps/settings"]);
  });

  it("hangs apps straight off the branch on a one-machine install", () => {
    const tree = buildTree({
      localNode: "solo",
      nodes: ["solo"],
      components: [],
      apps: [{ id: "chat", name: "Chat", node: "solo" }],
    });
    const apps = tree.children.find((c) => c.label === "Apps");
    expect(apps?.children.map((c) => c.sel)).toEqual(["app:chat@solo"]);
  });

  it("round-trips an app selection, and finds a machine-less one", () => {
    const sel = parseSelection("app:chat@nas");
    expect(sel).toEqual({ type: "app", node: "nas", name: "chat" });
    expect(formatSelection(sel!)).toBe("app:chat@nas");
    expect(parseSelection("app:@nas")).toBeNull();
    const tree = buildTree(withApps([{ id: "chat", name: "Chat", node: "nas" }]));
    expect(findSelected(tree, "app:chat")?.sel).toBe("app:chat@nas");
    expect(configTabFor(sel!, "nas")).toBeNull();
    expect(defaultSelectionFor("/apps")).toBe("install");
    expect(defaultSelectionFor("/people")).toBe("install");
  });
});

describe("a selection that under-specifies still finds its row", () => {
  it("resolves a bare `agent` to this machine's agent on an enrolled node", () => {
    // The defect this exists for: `defaultSelectionFor("/config")` gives
    // `agent`, the tree's row on an enrolled node is `agent:<name>`, and
    // without this the two never meet — the page menu rendered nothing
    // and the tree highlighted nothing, silently.
    const tree = buildTree(TWO_MACHINE);
    expect(findNode(tree, "agent"), "exact match should not exist here").toBeNull();
    const row = findSelected(tree, "agent");
    expect(row?.sel).toBe("agent:Amish_Station");
    expect(row?.local).toBe(true);
  });

  it("resolves a bare `agent` on a machine that has no name either", () => {
    const row = findSelected(buildTree(STANDALONE_WITH_DRIVER), "agent");
    expect(row?.sel).toBe("agent");
  });

  it("resolves a legacy driver tab, which never carried a machine", () => {
    const row = findSelected(buildTree(TWO_MACHINE), "driver:ollama-qwen");
    expect(row?.sel).toBe("driver:ollama-qwen@Amish_Station");
  });

  it("still returns nothing for a selection no row matches", () => {
    const tree = buildTree(TWO_MACHINE);
    expect(findSelected(tree, "driver:not-here")).toBeNull();
    expect(findSelected(tree, "agent:not-a-node")).toBeNull();
    expect(findSelected(tree, "nonsense")).toBeNull();
    expect(findSelected(tree, null)).toBeNull();
  });

  it("prefers an exact match over the fallback", () => {
    const tree = buildTree(STANDALONE_WITH_DRIVER);
    expect(findSelected(tree, "driver:qwen3-8b")?.sel).toBe("driver:qwen3-8b");
  });

  it("marks exactly one agent row as local", () => {
    for (const t of [
      STANDALONE,
      STANDALONE_WITH_DRIVER,
      ONE_NODE,
      TWO_MACHINE,
      SEALED,
      largeInstall(4, 1),
    ]) {
      const locals = flatten(buildTree(t)).filter((n) => n.local);
      expect(locals, "there is one machine the browser is talking to").toHaveLength(1);
    }
  });
});

describe("search accounts (P8)", () => {
  it("lists a search account under Backends with its settings, and no Inference row", () => {
    const tree = buildTree({
      ...STANDALONE,
      components: [
        ...STANDALONE.components,
        { name: "ollama-qwen", kind: "inference-driver", node: null },
        { name: "searxng", kind: "tool-driver", node: null },
      ],
    });
    const backends = branchOf(tree, "Backends")!;
    expect(labels(backends)).toEqual(["ollama-qwen", "searxng"]);
    const search = backends.children.find((c) => c.label === "searxng")!;
    expect(search.sel).toBe("driver:searxng");
    expect(search.icon).toBe("Search");
    expect(search.hint).toBe("web search");
    expect(search.pages.map((p) => p.label)).toEqual(["Settings"]);
    // Its settings page reaches it through the proxy by name.
    expect(configTabFor(parseSelection(search.sel)!, null)).toBe("searxng");
  });
});

describe("the Job sites branch (J19)", () => {
  const WITH_SITES: Topology = {
    ...TWO_MACHINE,
    sites: [
      { id: "s-b", label: "Work laptop" },
      { id: "s-a", label: "Amish_Station" },
    ],
  };

  it("sits right after Machines, and is there with no sites so the first can be added", () => {
    const names = labels(buildTree(WITH_SITES));
    expect(names.indexOf("Job sites")).toBe(names.indexOf("Machines") + 1);
    const empty = branchOf(buildTree(TWO_MACHINE), "Job sites")!;
    expect(empty.sel).toBe("sites");
    expect(empty.children).toEqual([]);
    expect(empty.pages.map((p) => [p.label, p.route])).toEqual([["Overview", "/sites"]]);
  });

  it("lists each site by label under its own id, never as a machine", () => {
    const tree = buildTree(WITH_SITES);
    const branch = branchOf(tree, "Job sites")!;
    expect(branch.children.map((c) => [c.label, c.sel])).toEqual([
      ["Amish_Station", "site:s-a"],
      ["Work laptop", "site:s-b"],
    ]);
    // One machine that is both a node and a site is two rows in two branches.
    expect(findNode(tree, "agent:Amish_Station")).toBeTruthy();
    expect(branchOf(tree, "Machines")!.children.some((c) => c.sel?.startsWith("site:"))).toBe(
      false,
    );
  });

  it("round-trips a site leaf's sel and finds the row", () => {
    const tree = buildTree(WITH_SITES);
    const leaf = findSelected(tree, "site:s-b")!;
    expect(leaf.label).toBe("Work laptop");
    expect(formatSelection(parseSelection(leaf.sel)!)).toBe("site:s-b");
    expect(configTabFor(parseSelection("site:s-b")!, "a")).toBeNull();
  });

  it("makes /sites select the branch, and a site link keep its own page", () => {
    expect(defaultSelectionFor("/sites")).toBe("sites");
    expect(defaultSelectionFor("/sites/")).toBe("sites");
    const leaf = findNode(buildTree(WITH_SITES), "site:s-a")!;
    expect(hrefFor(leaf.pages[0]!, leaf.sel)).toBe("/sites?sel=site%3As-a");
  });
});
