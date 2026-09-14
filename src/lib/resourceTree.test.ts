/**
 * The tree model, against the topologies that actually occur.
 *
 * The fixtures are the four this install produces: a single box before
 * enrollment, the live two-machine install, a worker whose control root
 * is sealed, and the large install the design's §0.1 sized (ten nodes,
 * four drivers each) that the tab strip could not hold.
 *
 * `buildTree` is pure, so all of that is assertable with no browser and
 * no running fleet — which matters because the sealed-root case is the
 * one nobody can produce on demand.
 */

import { readdirSync, statSync } from "node:fs";
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

describe("the branches", () => {
  it("reads down the architecture page, gateway first", () => {
    expect(labels(buildTree(TWO_MACHINE))).toEqual([
      "Gateway",
      "Inference drivers",
      "Agents",
      "Library",
      "Control root",
    ]);
  });

  it("gives a singleton no node level, because there is exactly one", () => {
    const gateway = findNode(buildTree(TWO_MACHINE), "gateway");
    expect(gateway?.kind).toBe("leaf");
    expect(gateway?.children).toEqual([]);
    // It still says which machine it is on.
    expect(gateway?.node).toBe("nas");
  });

  it("omits a singleton the topology does not contain", () => {
    const tree = buildTree({ ...TWO_MACHINE, components: [] });
    expect(labels(tree)).toEqual(["Inference drivers", "Agents"]);
    expect(findNode(tree, "gateway")).toBeNull();
  });

  it("puts one agent leaf per machine, this one first", () => {
    const agents = buildTree(TWO_MACHINE).children.find((c) => c.label === "Agents");
    expect(agents?.children.map((c) => c.label)).toEqual(["Amish_Station", "nas"]);
    expect(agents?.children[0]?.hint).toBe("this machine");
    expect(agents?.children[0]?.sel).toBe("agent:Amish_Station");
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
    const drivers = buildTree(TWO_MACHINE).children.find((c) => c.label === "Inference drivers");
    const nas = drivers?.children.find((c) => c.label === "nas");
    expect(nas, "nas is missing from the driver branch").toBeTruthy();
    expect(nas?.children).toEqual([]);
    expect(nas?.hint).toBe("none");
  });

  it("keeps a standalone box's drivers visible when nothing has a name", () => {
    // The defect this fixture exists for: with no node name anywhere,
    // grouping by label dropped every driver on the commonest install
    // shape there is.
    const drivers = buildTree(STANDALONE_WITH_DRIVER).children.find(
      (c) => c.label === "Inference drivers",
    );
    expect(drivers?.children.map((c) => c.label)).toEqual([THIS_MACHINE]);
    expect(drivers?.children[0]?.children.map((c) => c.sel)).toEqual(["driver:qwen3-8b"]);
  });

  it("gives a standalone box an agent leaf with the token Config already uses", () => {
    const agents = buildTree(STANDALONE_WITH_DRIVER).children.find((c) => c.label === "Agents");
    expect(agents?.children.map((c) => c.sel)).toEqual(["agent"]);
    expect(agents?.children[0]?.label).toBe(THIS_MACHINE);
  });

  it("surfaces a driver whose node is not in the registry, as its own group", () => {
    const tree = buildTree({
      localNode: "a",
      nodes: ["a"],
      components: [{ name: "ghost", kind: "inference-driver", node: "gone" }],
    });
    const drivers = tree.children.find((c) => c.label === "Inference drivers");
    const unplaced = drivers?.children.find((c) => c.label === "gone");
    expect(unplaced?.hint).toBe("no node in the registry");
    expect(unplaced?.children.map((c) => c.sel)).toEqual(["driver:ghost@gone"]);
  });

  it("attributes a node-less local driver to this machine", () => {
    // A worker's own /v1/components carries no `node` field.
    const drivers = buildTree(SEALED).children.find((c) => c.label === "Inference drivers");
    expect(drivers?.children.map((c) => c.label)).toEqual(["Amish_Station"]);
    expect(drivers?.children[0]?.children.map((c) => c.sel)).toEqual([
      "driver:ollama-qwen@Amish_Station",
    ]);
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
    const agents = tree.children.find((c) => c.label === "Agents");
    expect(agents?.children.map((c) => c.sel)).toEqual(["agent:Amish_Station"]);
    expect(findNode(tree, "driver:ollama-qwen@Amish_Station")).toBeTruthy();
    // And says nothing it cannot know: no gateway, because a worker
    // declares none and the root could not be asked.
    expect(findNode(tree, "gateway")).toBeNull();
  });

  it("carries the install-wide pages and no layer", () => {
    const tree = buildTree(TWO_MACHINE);
    expect(tree.layer).toBeNull();
    expect(tree.pages.map((p) => p.id)).toEqual(["playground", "inference", "preferences"]);
  });
});

describe("it holds the install the tab strip could not", () => {
  it("renders ten nodes with four drivers each as a bounded tree", () => {
    // §0.1: this topology is 54 buttons in a horizontal strip.
    const tree = buildTree(largeInstall(10, 4));
    expect(tree.children).toHaveLength(5);
    const drivers = tree.children.find((c) => c.label === "Inference drivers");
    expect(drivers?.children).toHaveLength(10);
    expect(drivers?.children.every((g) => g.children.length === 4)).toBe(true);
    const leaves = flatten(tree).filter((n) => n.kind === "leaf");
    expect(leaves).toHaveLength(40 + 10 + 3);
    // The top level stays five whatever the install does.
    expect(tree.children).toHaveLength(5);
  });
});

describe("the page menu", () => {
  it("gives each object the pages the design lists", () => {
    const tree = buildTree(TWO_MACHINE);
    const pagesOf = (sel: string) => findNode(tree, sel)?.pages.map((p) => p.label);
    expect(pagesOf("gateway")).toEqual(["Metrics", "Config"]);
    expect(pagesOf("library")).toEqual(["Models", "Discover", "Config"]);
    expect(pagesOf("control")).toEqual(["Nodes", "Config"]);
    expect(pagesOf("agent:nas")).toEqual(["Config"]);
    expect(pagesOf("driver:ollama-qwen@Amish_Station")).toEqual(["Config"]);
  });

  it("points every page at a route that exists", () => {
    const appDir = resolve(process.cwd(), "src", "app");
    const routes = new Set(
      readdirSync(appDir)
        .filter((e) => !e.startsWith("_") && !e.startsWith("."))
        .filter((e) => statSync(join(appDir, e)).isDirectory())
        .map((e) => `/${e}`),
    );
    const missing = pageRoutes().filter((r) => r !== "/" && !routes.has(r));
    expect(missing, `page routes with no page: ${missing.join(", ")}`).toEqual([]);
  });

  it("resolves which page a pathname is showing", () => {
    const pages = findNode(buildTree(TWO_MACHINE), "library")!.pages;
    expect(activePage(pages, "/library/")?.id).toBe("models");
    expect(activePage(pages, "/discover/?q=qwen")?.id).toBe("discover");
    expect(activePage(pages, "/config/")?.id).toBe("config");
    expect(activePage(pages, "/metrics/")).toBeNull();
    // `/` is exact: as a prefix it would match every path.
    expect(activePage(findNode(buildTree(TWO_MACHINE), "install")!.pages, "/library/")?.id).toBe(
      undefined,
    );
  });
});

describe("selection round-trips", () => {
  it.each([
    ["install", { type: "install", node: null, name: null }],
    ["gateway", { type: "gateway", node: null, name: null }],
    ["library", { type: "library", node: null, name: null }],
    ["control", { type: "control", node: null, name: null }],
    ["agent", { type: "agent", node: null, name: null }],
    ["agent:Amish_Station", { type: "agent", node: "Amish_Station", name: null }],
    ["driver:qwen3-8b", { type: "driver", node: null, name: "qwen3-8b" }],
    ["driver:llama-1@node-b", { type: "driver", node: "node-b", name: "llama-1" }],
  ])("parses %s", (raw, expected) => {
    expect(parseSelection(raw)).toEqual(expected);
    expect(formatSelection(expected as never)).toBe(raw);
  });

  it("selects nothing for a malformed or stale value, rather than the wrong thing", () => {
    for (const bad of [null, undefined, "", "   ", "nope", "agent:", "driver:", "driver:@n"]) {
      expect(parseSelection(bad), `"${bad}" should select nothing`).toBeNull();
    }
  });

  it("keeps an @ inside a driver name", () => {
    // The node is after the LAST @, so a driver called `a@b` on `n`
    // still resolves.
    expect(parseSelection("driver:a@b@n")).toEqual({ type: "driver", node: "n", name: "a@b" });
  });

  it("every leaf in every fixture round-trips its own sel", () => {
    const every = [STANDALONE, STANDALONE_WITH_DRIVER, TWO_MACHINE, SEALED, largeInstall(3, 2)];
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
  });

  it("calls the local agent 'agent' even before this node has a name", () => {
    expect(configTabFor({ type: "agent", node: null, name: null }, null)).toBe("agent");
  });
});

describe("an old link still lands on the right object", () => {
  it("maps every route the UI had before the tree", () => {
    expect(defaultSelectionFor("/")).toBe("install");
    expect(defaultSelectionFor("/inference/")).toBe("install");
    expect(defaultSelectionFor("/metrics/")).toBe("gateway");
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
    expect(defaultSelectionFor("/config/")).toBe("agent");
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

  it("gives the install root a page for browser preferences", () => {
    // Nothing may become unreachable in the move: the old `ui` tab held
    // the theme and font-size controls and is the only thing on the
    // Config page that is not a component's settings.
    const install = findNode(buildTree(TWO_MACHINE), "install");
    expect(install?.pages.map((p) => p.id)).toEqual(["playground", "inference", "preferences"]);
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
    for (const t of [STANDALONE_WITH_DRIVER, TWO_MACHINE, SEALED, largeInstall(4, 1)]) {
      const locals = flatten(buildTree(t)).filter((n) => n.local);
      expect(locals, "there is one machine the browser is talking to").toHaveLength(1);
    }
  });
});
