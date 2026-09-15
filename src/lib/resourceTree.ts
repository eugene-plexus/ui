/**
 * The install as a tree of objects, and the pages that belong to each.
 *
 * **Design:** `specs/docs/design/ui-tree-navigation.md`. The brief was
 * Troy's: a tree down the left side, component types as the first
 * branches, nodes under the types that exist on more than one, and a
 * vertical page menu for whatever is selected — a cluster manager's
 * navigation, because this product's nouns are objects in a topology and
 * a link bar can only name screens.
 *
 * **Pure on purpose.** No React, no DOM, no `next/*`, no fetching. It
 * takes a topology snapshot and returns a tree, so a vitest run can
 * assert the shape a sealed control root produces without a browser.
 *
 * Three things here are load-bearing and each has a measurement behind
 * it in the design's §0:
 *
 * 1. **Type first, node second.** Three of the five kinds are install
 *    singletons (gateway, library, control root); only agents and
 *    drivers multiply. Node-first would bury the gateway under whichever
 *    host happens to run it.
 * 2. **The root is the install, not the control root.** `installPlacement`
 *    and `installNodes` in the config page already swallow their errors,
 *    because a restarted container comes back sealed while every health
 *    check says `ok`. A tree rooted in the trust root would lose the
 *    branch describing the machine the operator is sitting at, exactly
 *    when they need it. `sealed` below is that case, and it is a
 *    first-class input rather than an error path.
 * 3. **A leaf's identity is `name@node`, never `name`.** Two workers can
 *    each have a `llama-1`, and the proxy resolves a bare name to the
 *    first it finds.
 *
 * And one that came later, from the hobbyist UX plan
 * (`specs/docs/design/hobbyist-ux.md` §6.4, decision #10, Troy,
 * 2026-09-15):
 *
 * 4. **The machine level renders only once there is more than one
 *    machine.** The commonest install there is — one box — showed four
 *    rows reading "This machine" under three branches, describing a
 *    fleet the user does not have. With one machine, drivers hang
 *    straight off their type, `Agents` is a leaf and Library has no
 *    machine rows; a second machine, enrolled or merely named by a
 *    driver, restores the level everywhere at once. The `sel` tokens do
 *    not change shape across that flip, so every link, every bookmark
 *    and every `parseSelection` case keeps working. `machineKeys` is the
 *    one place the count is taken.
 */

import { layerOf, type IconName, type Layer, type LayerId } from "./navigation";

/** One component as the control root or a local agent reports it. */
export interface ComponentPlacement {
  name: string;
  kind: string;
  node: string | null;
}

/** Everything the tree is built from. Every field may be empty. */
export interface Topology {
  /** This node's name, from `GET /v1/node`. Null before enrollment. */
  localNode: string | null;
  /** Every enrolled node, from the root's `/v1/nodes`. */
  nodes: string[];
  /** Components from this agent and from the root's placement, merged. */
  components: ComponentPlacement[];
  /** The install's own name, when the root offers one. */
  installName?: string | null;
  /**
   * True when the control root could not be reached or answered `503
   * Locked`. The tree still renders; it says what is missing.
   */
  rootUnreachable?: boolean;
}

/** What kind of thing a tree row is. */
export type NodeKind = "install" | "branch" | "nodeGroup" | "leaf";

/** A page in the second column. Every one is a screen that exists. */
export interface PageRef {
  /** Stable id, used in tests and as a React key. */
  id: string;
  label: string;
  /** The route. The selection rides in `?sel=`, added by `hrefFor`. */
  route: string;
  icon: IconName;
}

export interface TreeNode {
  /** `sel` value for this row, or null for rows that only group. */
  sel: string | null;
  kind: NodeKind;
  label: string;
  /** The layer this row belongs to; the install root has none. */
  layer: LayerId | null;
  icon: IconName;
  children: TreeNode[];
  pages: PageRef[];
  /** Set on a node group or leaf that lives on a specific machine. */
  node?: string | null;
  /** Rendered muted beside the label. */
  hint?: string;
  /** True for the row describing the machine the browser is talking to. */
  local?: boolean;
}

/** The install root's name when the root offers none. */
export const DEFAULT_INSTALL_NAME = "Eugene Plexus";

/** What an unenrolled machine is called, since it has no name of its own. */
export const THIS_MACHINE = "This machine";

type SingletonKind = "gateway" | "library" | "control";

/**
 * Branch order is the registry's layer order, so the tree reads down the
 * architecture page: the gateway, then the drivers under it, then the
 * three services beside the request path.
 */
const BRANCH_ORDER: ReadonlyArray<{ layer: LayerId; label: string }> = [
  { layer: "gateway", label: "Gateway" },
  { layer: "drivers", label: "Inference drivers" },
  { layer: "agent", label: "Agents" },
  { layer: "library", label: "Library" },
  { layer: "control", label: "Control root" },
];

/**
 * The pages each kind of object owns.
 *
 * **Two of these are one item long and that is deliberate.** The UI has
 * seven screens and the tree has more objects than that, so an agent and
 * a driver each show only Config today. Inventing an overview to fill
 * the column would be adding product under cover of a navigation change;
 * what the tree does instead is make the empty slot obvious. The data
 * for an agent overview already exists at `GET /v1/node`.
 */
const PAGES: Record<string, PageRef[]> = {
  install: [
    // Home is the install's front page since the hobbyist UX plan (S1):
    // what is running, what to do next. The playground moved to its own
    // route to make room — it is a diagnostic, and a diagnostic is not
    // what a first-time user should land on. The icon vocabulary lives in
    // `navigation.ts`; Home wears the install root's own until a house is
    // added there.
    { id: "home", label: "Home", route: "/", icon: "Monitor" },
    { id: "playground", label: "Playground", route: "/playground", icon: "Terminal" },
    { id: "inference", label: "Inference", route: "/inference", icon: "Cpu" },
    // Theme and font size. Browser-local, not install-wide, and the page
    // says so -- but it has to hang somewhere in a tree of objects, and
    // the install root is the only row that is not a component.
    { id: "preferences", label: "Preferences", route: "/config", icon: "Monitor" },
  ],
  gateway: [
    { id: "metrics", label: "Metrics", route: "/metrics", icon: "Radio" },
    { id: "config", label: "Config", route: "/config", icon: "Server" },
  ],
  library: [
    { id: "models", label: "Models", route: "/library", icon: "Database" },
    // Folders and their reach, every node at once (2026-09-14). Second,
    // not first: on the commonest install -- one box -- Models is what the
    // operator came for, and Folders says "same path" three times.
    { id: "folders", label: "Folders", route: "/library/folders", icon: "FolderTree" },
    { id: "discover", label: "Discover", route: "/discover", icon: "FolderOpen" },
    { id: "config", label: "Config", route: "/config", icon: "Server" },
  ],
  // A machine under Library: not an instance of the library, but how that
  // machine reaches it. One page, deliberately -- the object exists so an
  // operator can set a node's override from the Library branch, with a
  // picker that browses THAT node, without visiting an agent page.
  libraryNode: [{ id: "folders", label: "Folders", route: "/library/folders", icon: "FolderTree" }],
  control: [
    { id: "nodes", label: "Nodes", route: "/nodes", icon: "ShieldCheck" },
    { id: "config", label: "Config", route: "/config", icon: "Server" },
  ],
  agent: [{ id: "config", label: "Config", route: "/config", icon: "Server" }],
  driver: [{ id: "config", label: "Config", route: "/config", icon: "Server" }],
};

/** Every route any page entry names. The vitest suite checks these exist. */
export function pageRoutes(): string[] {
  const out = new Set<string>();
  for (const list of Object.values(PAGES)) for (const p of list) out.add(p.route);
  return [...out].sort();
}

/**
 * Build the tree.
 *
 * Nothing here throws on a partial topology. A worker whose root is
 * sealed reports no nodes and no placement, and what comes back is the
 * install root plus this machine — strictly more than the tab strip it
 * replaces managed.
 */
export function buildTree(topology: Topology): TreeNode {
  const { localNode, components } = topology;
  const nodes = allNodes(topology);
  const drivers = components.filter((c) => c.kind === "inference-driver");
  // Taken once, here, so the three branches that show machines cannot
  // disagree about how many there are.
  const machines = machineKeys(nodes, drivers, localNode);

  const children: TreeNode[] = [];
  for (const branch of BRANCH_ORDER) {
    const layer = layerOf(branch.layer);
    if (branch.layer === "drivers") {
      children.push(driverBranch(layer, branch.label, nodes, machines, drivers, localNode));
    } else if (branch.layer === "agent") {
      children.push(agentBranch(layer, branch.label, nodes, machines, localNode));
    } else if (branch.layer === "library") {
      // The deliberate exception to "machines only under kinds that
      // multiply" (design §5.1): a machine under Library is how that
      // machine reaches the Library, and the Folders page for one node
      // has to hang off something in the Library branch.
      const singleton = singletonLeaf(layer, branch.label, components, localNode);
      if (singleton) {
        children.push({
          ...singleton,
          children: libraryNodeLeaves(layer, nodes, machines, localNode),
        });
      }
    } else {
      const singleton = singletonLeaf(layer, branch.label, components, localNode);
      if (singleton) children.push(singleton);
    }
  }

  return {
    sel: "install",
    kind: "install",
    label: topology.installName?.trim() || DEFAULT_INSTALL_NAME,
    layer: null,
    icon: "Monitor",
    node: null,
    children,
    pages: PAGES.install ?? [],
    hint: topology.rootUnreachable ? "control root unreachable" : undefined,
  };
}

/**
 * Every machine in the install, in a stable order: this one first so a
 * worker sees itself at the top, then the rest alphabetically.
 *
 * **The node registry and this machine are the only sources.** An
 * earlier version also harvested names out of component placements,
 * which made the list self-fulfilling: a component naming a machine the
 * registry has never heard of would mint an agent leaf for it, asserting
 * an agent this UI has no evidence for. The registry is the authority on
 * which machines are in the install; a placement that disagrees with it
 * is an anomaly, and `driverBranch` renders that anomaly as its own
 * flagged group rather than hiding it inside the list.
 */
function allNodes(topology: Topology): string[] {
  const rest = new Set(topology.nodes.filter((n) => n && n !== topology.localNode));
  const sorted = [...rest].sort((a, b) => a.localeCompare(b));
  return topology.localNode ? [topology.localNode, ...sorted] : sorted;
}

/**
 * Every machine that has a place in the tree, as the keys the driver
 * groups are built on: the registry (this machine first), then any
 * machine a driver names that the registry does not, then the nameless
 * local one when nothing else exists. A key is `null` for a machine with
 * no name, which is what an unenrolled box is; the list is never empty.
 *
 * **One entry means one machine, and that decides the tree's shape**
 * (hobbyist-ux.md §6.4, decision #10). A machine a driver names but the
 * registry lacks still counts: it is a second machine as far as the
 * operator can see, and hiding the level would hide the `no node in the
 * registry` flag that says something is wrong. What does NOT count is
 * the nameless local machine when a named registry exists and no driver
 * lives here — there is no evidence of a second machine in that, only of
 * a browser that has not enrolled yet.
 */
function machineKeys(
  nodes: string[],
  drivers: ComponentPlacement[],
  localNode: string | null,
): (string | null)[] {
  const keys: (string | null)[] = [...nodes];
  for (const d of drivers) {
    const key = d.node ?? localNode;
    if (!keys.includes(key)) keys.push(key);
  }
  if (keys.length === 0) keys.push(localNode);
  return keys;
}

/**
 * A singleton is its own leaf — clicking `Gateway` gives the gateway's
 * pages with no node level, because there is exactly one.
 *
 * **An enrolled node declares none of the three singletons**, so a
 * worker's own `/v1/components` will not contain the gateway; the
 * placement from the control root is where it comes from. Absent both,
 * the branch is omitted rather than rendered empty: a gateway that is
 * genuinely not in the topology is not a thing to click.
 */
function singletonLeaf(
  layer: Layer,
  label: string,
  components: ComponentPlacement[],
  localNode: string | null,
): TreeNode | null {
  const kind = layer.id === "control" ? "control" : layer.id;
  const found = components.find((c) => c.kind === kind);
  if (!found) return null;
  const owner = found.node ?? localNode;
  return {
    sel: kind,
    kind: "leaf",
    label,
    layer: layer.id,
    icon: layer.icon,
    node: owner,
    children: [],
    pages: PAGES[kind as SingletonKind] ?? [],
    hint: owner ?? undefined,
  };
}

/**
 * One leaf per machine — or, with one machine, the branch IS the leaf.
 *
 * An agent is not a component, so the node registry is the source rather
 * than `/v1/components`; a machine a driver names but the registry lacks
 * gets no agent leaf, because the UI has no evidence of an agent there
 * (design §14.2).
 *
 * **A standalone install has no node name at all** — it is not enrolled,
 * so `GET /v1/node` carries none and the registry is empty. That is the
 * commonest shape there is (one box, first run), and it still has an
 * agent to configure, so its leaf's `sel` is the bare `agent` that the
 * Config page has always used for the local one. An enrolled node that
 * is alone gets `agent:<name>` — the same token the two-machine shape
 * gives that row — so the flip from one machine to two moves the row and
 * changes nothing about how it is addressed. `findSelected` still maps
 * the bare `agent` a query-less `/config` asks for onto the `local` row,
 * whichever shape it is in (design §13.2).
 */
function agentBranch(
  layer: Layer,
  label: string,
  nodes: string[],
  machines: ReadonlyArray<string | null>,
  localNode: string | null,
): TreeNode {
  if (machines.length === 1) {
    const machine = machines[0] ?? null;
    return {
      sel: machine ? `agent:${machine}` : "agent",
      kind: "leaf",
      // Singular: one machine has one agent, and a plural over a single
      // row is exactly the "fleet you do not have" the design removes.
      label: "Agent",
      layer: layer.id,
      icon: layer.icon,
      node: machine,
      children: [],
      pages: PAGES.agent ?? [],
      hint: machine === localNode ? "this machine" : (machine ?? undefined),
      local: machine === localNode,
    };
  }

  const children: TreeNode[] =
    nodes.length === 0
      ? [
          {
            sel: "agent",
            kind: "leaf" as const,
            label: localNode ?? THIS_MACHINE,
            layer: layer.id,
            icon: layer.icon,
            node: localNode,
            children: [],
            pages: PAGES.agent ?? [],
            hint: "this machine",
            local: true,
          },
        ]
      : nodes.map((name) => ({
          sel: `agent:${name}`,
          kind: "leaf" as const,
          label: name,
          layer: layer.id,
          icon: layer.icon,
          node: name,
          children: [],
          pages: PAGES.agent ?? [],
          hint: name === localNode ? "this machine" : undefined,
          local: name === localNode,
        }));

  return {
    sel: null,
    kind: "branch",
    label,
    layer: layer.id,
    icon: layer.icon,
    children,
    pages: [],
  };
}

/**
 * One leaf per machine under the Library: how that machine reaches the
 * Library's folders (2026-09-14). Same machines, same order and same
 * names as under Agents, so the two branches read as one list; the
 * `sel` is `library:node:<name>`, or the bare `library:node` on an
 * unenrolled box, mirroring `agent`.
 *
 * **None with one machine.** How the only machine reaches the Library is
 * the Library's own Folders page — the grid has one column — so there
 * is no second object to hang a row on, and a row would say "same path"
 * about itself. A `library:node...` link from before the flip resolves
 * to the Library leaf in `findSelected`.
 */
function libraryNodeLeaves(
  layer: Layer,
  nodes: string[],
  machines: ReadonlyArray<string | null>,
  localNode: string | null,
): TreeNode[] {
  if (machines.length === 1) return [];
  if (nodes.length === 0) {
    return [
      {
        sel: "library:node",
        kind: "leaf",
        label: localNode ?? THIS_MACHINE,
        layer: layer.id,
        icon: "FolderTree",
        node: localNode,
        children: [],
        pages: PAGES.libraryNode ?? [],
        hint: "this machine",
      },
    ];
  }
  return nodes.map((name) => ({
    sel: `library:node:${name}`,
    kind: "leaf" as const,
    label: name,
    layer: layer.id,
    icon: "FolderTree" as const,
    node: name,
    children: [],
    pages: PAGES.libraryNode ?? [],
    hint: name === localNode ? "this machine" : undefined,
  }));
}

/**
 * Node groups, each holding that machine's drivers — or, with one
 * machine, the drivers themselves straight under the type.
 *
 * **A machine with no drivers still appears, as an empty group.** Hiding
 * it would make "this machine is running nothing" indistinguishable from
 * "this machine is not in the install", which is the ambiguity the
 * Inference screen was built to remove. With one machine the same fact
 * moves onto the branch itself as the hint `none`.
 *
 * Grouping is by the driver's *resolved* machine — its own `node`, else
 * this one — and that key may legitimately be **null**, because a
 * standalone install has no node name. An earlier version of this
 * function matched group labels against that key and so dropped every
 * driver on an unenrolled box, which is the commonest install there is.
 *
 * **A leaf's `sel` is the same in both shapes**: `driver:<name>@<node>`
 * when the machine has a name, `driver:<name>` when it has none. The
 * machine is carried in the token, not in the row above it, which is
 * what lets a link written on one shape land on the other.
 */
function driverBranch(
  layer: Layer,
  label: string,
  nodes: string[],
  machines: ReadonlyArray<string | null>,
  drivers: ComponentPlacement[],
  localNode: string | null,
): TreeNode {
  const keyOf = (d: ComponentPlacement): string | null => d.node ?? localNode;
  const byName = (a: ComponentPlacement, b: ComponentPlacement) => a.name.localeCompare(b.name);
  const leaf = (d: ComponentPlacement, key: string | null): TreeNode => ({
    sel: key ? `driver:${d.name}@${key}` : `driver:${d.name}`,
    kind: "leaf",
    label: d.name,
    layer: layer.id,
    icon: layer.icon,
    node: key,
    children: [],
    pages: PAGES.driver ?? [],
  });
  const hintFor = (key: string | null, count: number): string | undefined =>
    !(key === null || nodes.includes(key))
      ? "no node in the registry"
      : count === 0
        ? "none"
        : undefined;

  if (machines.length === 1) {
    // Every driver resolves to the one machine — `machineKeys` put each
    // driver's key in the list, and the list has one entry.
    const key = machines[0] ?? null;
    return {
      sel: null,
      kind: "branch",
      label,
      layer: layer.id,
      icon: layer.icon,
      children: [...drivers].sort(byName).map((d) => leaf(d, key)),
      pages: [],
      hint: hintFor(key, drivers.length),
    };
  }

  const groups: TreeNode[] = machines.map((key) => {
    const mine = drivers.filter((d) => keyOf(d) === key).sort(byName);
    return {
      sel: null,
      kind: "nodeGroup" as const,
      label: key ?? localNode ?? THIS_MACHINE,
      layer: layer.id,
      icon: layer.icon,
      node: key,
      children: mine.map((d) => leaf(d, key)),
      pages: [],
      hint: hintFor(key, mine.length),
    };
  });

  return {
    sel: null,
    kind: "branch",
    label,
    layer: layer.id,
    icon: layer.icon,
    children: groups,
    pages: [],
  };
}

/* ────────────────────────────── selection ───────────────────────────── */

export interface Selection {
  /** `install`, `gateway`, `library`, `libraryNode`, `control`, `agent`, or `driver`. */
  type: "install" | "gateway" | "library" | "libraryNode" | "control" | "agent" | "driver";
  /** The machine, for an agent, a driver, or a node under the Library. */
  node: string | null;
  /** The driver's own name. */
  name: string | null;
}

/**
 * Parse a `sel` query value.
 *
 * A malformed or stale value returns `null` — selects nothing — rather
 * than throwing or falling back to the install. A link pasted from an
 * older build should land on a page that says nothing is selected, not
 * on the wrong object and not on an error boundary.
 */
export function parseSelection(raw: string | null | undefined): Selection | null {
  if (!raw) return null;
  const value = raw.trim();
  if (value === "install") return { type: "install", node: null, name: null };
  // A machine under the Library, before the bare `library`: the bare
  // `library:node` is the local one on a machine with no name yet.
  if (value === "library:node") return { type: "libraryNode", node: null, name: null };
  if (value.startsWith("library:node:")) {
    const node = value.slice("library:node:".length);
    return node ? { type: "libraryNode", node, name: null } : null;
  }
  if (value === "gateway" || value === "library" || value === "control") {
    return { type: value, node: null, name: null };
  }
  // The bare `agent` is the local one on a machine with no name yet,
  // and is the same token the Config page has always used for it.
  if (value === "agent") return { type: "agent", node: null, name: null };
  if (value.startsWith("agent:")) {
    const node = value.slice("agent:".length);
    return node ? { type: "agent", node, name: null } : null;
  }
  if (value.startsWith("driver:")) {
    const rest = value.slice("driver:".length);
    const at = rest.lastIndexOf("@");
    // No `@` is a driver on an unenrolled machine, which has no name to
    // qualify it with. `@` at position 0 is a missing name, which is
    // malformed.
    if (at === 0) return null;
    if (at < 0) return rest ? { type: "driver", node: null, name: rest } : null;
    const name = rest.slice(0, at);
    const node = rest.slice(at + 1);
    return name && node ? { type: "driver", node, name } : null;
  }
  return null;
}

/** The inverse of `parseSelection`. */
export function formatSelection(selection: Selection): string {
  switch (selection.type) {
    case "install":
    case "gateway":
    case "library":
    case "control":
      return selection.type;
    case "agent":
      return selection.node ? `agent:${selection.node}` : "agent";
    case "libraryNode":
      return selection.node ? `library:node:${selection.node}` : "library:node";
    case "driver":
      return selection.node
        ? `driver:${selection.name ?? ""}@${selection.node}`
        : `driver:${selection.name ?? ""}`;
  }
}

/** Find a row by its `sel`, depth first. */
export function findNode(root: TreeNode, sel: string | null): TreeNode | null {
  if (!sel) return null;
  if (root.sel === sel) return root;
  for (const child of root.children) {
    const hit = findNode(child, sel);
    if (hit) return hit;
  }
  return null;
}

/** Every row with a `sel`, in render order. */
export function flatten(root: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (n: TreeNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/**
 * The href for one page of one object.
 *
 * `output: "export"` cannot pre-render a path segment whose value is a
 * node name, so the selection is a query parameter. That is already this
 * UI's convention (`?tab=`, `?model=`, `?next=`), not a workaround.
 */
export function hrefFor(page: PageRef, sel: string | null): string {
  if (!sel) return page.route;
  const join = page.route.includes("?") ? "&" : "?";
  return `${page.route}${join}sel=${encodeURIComponent(sel)}`;
}

/**
 * Which page of the selected object a pathname is showing.
 * Longest-prefix, for the same reasons `activeScreen` is.
 */
export function activePage(pages: PageRef[], pathname: string | null): PageRef | null {
  if (!pathname) return null;
  const path = pathname.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
  let best: PageRef | null = null;
  for (const page of pages) {
    if (page.route === "/") {
      if (path === "/") best = page;
      continue;
    }
    if (path === page.route || path.startsWith(`${page.route}/`)) {
      if (!best || page.route.length > best.route.length) best = page;
    }
  }
  return best;
}

/**
 * The `?tab=` value the Config page uses for a selection.
 *
 * Config predates the tree and addresses its subject by proxy target:
 * `gateway`, `library`, `control`, `agent` for the local one,
 * `node:<name>` for another machine's, and a bare driver name. Keeping
 * that translation in one pure function is what lets the tree write URLs
 * the existing page already understands, with no rewrite.
 */
export function configTabFor(selection: Selection, localNode: string | null): string | null {
  switch (selection.type) {
    case "gateway":
    case "library":
    case "control":
      return selection.type;
    case "agent":
    case "libraryNode":
      return !selection.node || selection.node === localNode ? "agent" : `node:${selection.node}`;
    case "driver":
      return selection.name;
    case "install":
      return null;
  }
}

/**
 * Which object a bare route is about, when no `sel` is present.
 *
 * Every URL that worked before the tree still has to work: a bookmark,
 * a link in a design document, the launch panel's "map it", and the
 * redirect from `/runtimes`. Rather than teach each page a default, one
 * pure function says which object owns which route, so an old link
 * arrives with the tree already pointing at the right row.
 *
 * `/config` is the only ambiguous one, and it is resolved from the
 * `?tab=` that page has always taken.
 */
export function defaultSelectionFor(
  pathname: string | null | undefined,
  tab?: string | null,
): string | null {
  // An absent pathname selects nothing. Normalising it to "/" would
  // make "we do not know where we are" indistinguishable from "we are at
  // the root", which is the same mistake `activeScreen` avoids.
  if (!pathname) return null;
  const path = pathname.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
  switch (path) {
    // `/` is Home and `/playground` is where the playground went (S1);
    // both are the install's own pages.
    case "/":
    case "/playground":
    case "/inference":
      return "install";
    case "/metrics":
      return "gateway";
    case "/library":
    case "/library/folders":
    case "/discover":
      return "library";
    case "/nodes":
      return "control";
    case "/config":
      return selectionFromConfigTab(tab) ?? "agent";
    default:
      return null;
  }
}

/**
 * The inverse of `configTabFor`: the selection a legacy `?tab=` names.
 *
 * A driver comes back without its machine, because the tab never carried
 * one. `parseSelection` accepts that shape, `configTabFor` maps it
 * straight back to the driver's name, and the proxy resolves it exactly
 * as it did before the tree — which is to say the ambiguity is
 * pre-existing and not made worse here.
 */
export function selectionFromConfigTab(tab: string | null | undefined): string | null {
  if (!tab) return null;
  if (tab === "ui") return "install";
  if (tab === "agent") return "agent";
  if (tab === "gateway" || tab === "library" || tab === "control") return tab;
  if (tab.startsWith("node:")) {
    const node = tab.slice("node:".length);
    return node ? `agent:${node}` : null;
  }
  return `driver:${tab}`;
}

/**
 * The row a `sel` means, tolerating the two shapes that legitimately
 * under-specify.
 *
 * An exact match wins. Failing that:
 *
 * - **`agent` with no machine** is the local one — the token the Config
 *   page has always used and the one `defaultSelectionFor` produces for
 *   a bare `/config`. On an enrolled node the tree's row is
 *   `agent:<name>`, so without this the two never meet and the page menu
 *   silently renders nothing. That is exactly what the first build did.
 * - **`driver:<name>` with no machine** is a legacy `?tab=<name>` link,
 *   which never carried one. It resolves to the first leaf with that
 *   name, which is the same thing the proxy does with a bare driver
 *   name — the ambiguity is pre-existing and not made worse here.
 */
export function findSelected(root: TreeNode, sel: string | null): TreeNode | null {
  const exact = findNode(root, sel);
  if (exact) return exact;
  const selection = parseSelection(sel);
  if (!selection) return null;
  const rows = flatten(root);
  if (selection.type === "agent" && !selection.node) {
    return rows.find((n) => n.local && n.sel?.startsWith("agent")) ?? null;
  }
  if (selection.type === "libraryNode") {
    const machineRows = rows.filter((n) => n.sel?.startsWith("library:node"));
    // One machine: Library has no machine rows at all, so a
    // `library:node...` link — a bookmark from before the flip, or from a
    // second machine that has since left — lands on the Library leaf,
    // whose Folders page is the same page with one column. On two or
    // more machines a name no row carries is stale and selects nothing.
    if (machineRows.length === 0) return findNode(root, "library");
    if (selection.node) return null;
    // `local` is reserved for the one row that IS the browser's machine
    // (its agent); the Library leaf for that machine is found by node.
    return machineRows.find((n) => (n.node ?? null) === localNodeOf(root)) ?? null;
  }
  if (selection.type === "driver" && !selection.node && selection.name) {
    const prefix = `driver:${selection.name}`;
    return rows.find((n) => n.sel === prefix || n.sel?.startsWith(`${prefix}@`)) ?? null;
  }
  return null;
}

/** The browser's own machine, as the tree knows it: the local agent row's node. */
function localNodeOf(root: TreeNode): string | null {
  return flatten(root).find((n) => n.local && n.sel?.startsWith("agent"))?.node ?? null;
}

/**
 * The pages a selection owns, without needing the tree.
 *
 * **Which pages an object has depends on its *kind*, never on the
 * topology** — a library has Models, Discover and Config whether or not
 * the control root has answered yet. The first build read them off the
 * resolved tree row, so for the moment between first paint and the
 * topology arriving the page menu was empty, and a browser test that
 * looked in that moment saw an install with two rows in it.
 *
 * The tree still supplies the *label* and confirms the row exists. It is
 * only the page list that is knowable straight away.
 */
export function pagesForSelection(selection: Selection | null): PageRef[] {
  if (!selection) return [];
  const key = selection.type === "install" ? "install" : selection.type;
  return PAGES[key] ?? [];
}
