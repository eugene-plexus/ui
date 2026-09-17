/**
 * Where every screen lives, in the vocabulary of the architecture page.
 *
 * `https://eugeneplexus.com/architecture` explains this system as five
 * layers with three services beside the request path, each with a fixed
 * name, icon and colour. This module is that structure, transcribed, plus
 * the mapping from it to the screens of this UI. The navigation bar, the
 * per-screen header, the layer map panel and both test suites all render
 * from here, so none of them can disagree with another.
 *
 * **Design:** `specs/docs/design/ui-navigation.md`. Its §0 is the
 * measurement this replaced: seven screens with seven different
 * hand-written header rows, `/metrics` and `/nodes` reachable only from
 * the playground, "Back" meaning two different places, Sign out on one
 * screen, and zero occurrences of `aria-current`, `usePathname` or a skip
 * link anywhere in the app.
 *
 * **Pure on purpose.** No React, no DOM, no `next/*`. The icon *names*
 * live here; the mapping from a name to a component is in
 * `components/LayerIcon.tsx`, so a vitest run needs no renderer to assert
 * that this file agrees with the website.
 *
 * **Two things that are easy to get wrong and are asserted in
 * `navigation.test.ts`:**
 *
 * 1. A screen added to `src/app` without an entry here is invisible in
 *    the navigation — which is the defect the design exists to remove, so
 *    a test enumerates the routes and fails on an unlisted one.
 * 2. `--accent-left` is blue only in the `modern` theme; it is ice blue
 *    in `plexus` and **green** in `editorial`. So `accent` here is a
 *    *role*, never a colour, and the identity a reader actually relies on
 *    is the icon, which does not vary by theme.
 */

/** Icons, by the name the website imports from `@lucide/astro`. */
export type IconName =
  | "Terminal"
  | "Radio"
  | "Cpu"
  | "Cloud"
  | "HardDrive"
  | "Server"
  | "Database"
  | "ShieldCheck"
  | "Monitor"
  | "FolderOpen"
  | "FolderTree"
  | "KeyRound";

/**
 * A colour *role*, not a colour. `left` and `right` resolve to the
 * `--accent-left` / `--accent-right` tokens that already existed;
 * `engine` and `hardware` resolve to the two tokens this slice added.
 * Each has a per-theme value — see `globals.css`.
 */
export type AccentRole = "left" | "right" | "engine" | "hardware";

/** Which half of the architecture page's diagram a layer belongs to. */
export type LayerSide = "path" | "beside";

export type LayerId =
  | "tools"
  | "gateway"
  | "drivers"
  | "engines"
  | "hardware"
  | "agent"
  | "library"
  | "control";

export interface Layer {
  readonly id: LayerId;
  readonly name: string;
  readonly icon: IconName;
  readonly accent: AccentRole;
  readonly side: LayerSide;
  /** One line, in the site's own terms. Shown in the layer map panel. */
  readonly blurb: string;
}

/**
 * The five layers of the request path, in the site's top-to-bottom order,
 * then the three services beside it in the site's rail order.
 *
 * Order is load-bearing: the navigation groups render in it, so the bar
 * reads down the diagram rather than alphabetically.
 */
export const LAYERS: readonly Layer[] = [
  {
    id: "tools",
    name: "Your tools",
    icon: "Terminal",
    accent: "left",
    side: "path",
    blurb: "Anything that speaks the OpenAI API, pointed at one URL with one key.",
  },
  {
    id: "gateway",
    name: "Gateway",
    icon: "Radio",
    accent: "right",
    side: "path",
    blurb: "One per install. The only thing your tools need to know about.",
  },
  {
    id: "drivers",
    name: "Inference drivers",
    icon: "Cpu",
    accent: "left",
    side: "path",
    blurb: "A thin adapter in front of each backend. It translates and reports capabilities.",
  },
  {
    id: "engines",
    name: "Engines and backends",
    icon: "Cloud",
    accent: "engine",
    side: "path",
    blurb:
      "llama.cpp and vLLM are supervised here. Ollama, LM Studio and cloud APIs are talked to.",
  },
  {
    id: "hardware",
    name: "Your hardware",
    icon: "HardDrive",
    accent: "hardware",
    side: "path",
    blurb: "GPUs, RAM and your model directories. On one computer, or on several.",
  },
  {
    id: "agent",
    name: "Agent",
    icon: "Server",
    accent: "left",
    side: "beside",
    blurb: "One per machine. Starts and watches everything on this box. Serves this UI.",
  },
  {
    id: "library",
    name: "Library",
    icon: "Database",
    accent: "left",
    side: "beside",
    blurb: "Your models on disk, per-model settings, discovery, downloads and fit guidance.",
  },
  {
    id: "control",
    name: "Control root",
    icon: "ShieldCheck",
    accent: "right",
    side: "beside",
    blurb: "Which machines belong to this install, and the keys they trust each other with.",
  },
] as const;

export interface Screen {
  readonly href: string;
  readonly label: string;
  readonly icon: IconName;
  /** The layer this screen files under. */
  readonly layer: LayerId;
  /**
   * Further layers the screen reaches into, in path order. Empty for most
   * screens. `/inference` is the reason this field exists: its rows join a
   * driver, the backend it fronts and the node it runs on, and filing it
   * under one of the three would misdescribe the only screen that exists
   * because they are different things.
   */
  readonly spans: readonly LayerId[];
  /** One line. Used as the link's title and in the layer map panel. */
  readonly blurb: string;
}

/**
 * The eight navigable screens.
 *
 * Order within each group is the diagram's order, not alphabetical:
 * tools → gateway → drivers for the request path, then the rail's
 * Library, Library, Agent, Control root.
 *
 * Four entries are not obvious. Three are argued in the design's §2.2;
 * the first is the hobbyist UX plan's S1:
 *
 * - **`/`** is Home, and **`/playground`** is the playground that used
 *   to sit at the root. Home is the install root's first page and the
 *   playground its second; both file under `tools` because both are
 *   where a person, rather than a component, talks to the install. Home
 *   takes `Monitor` — the tree's own icon for the install root — since
 *   it is that object's landing page and not a client of anything.
 * - **`/inference`** files under `drivers` and spans `engines` and
 *   `hardware`.
 * - **`/config`** files under `agent`, because its addressing is per
 *   node and a node is a machine running one agent — its tabs are
 *   `<Component> @ <node>` — while its *content* is every component's
 *   settings. The map panel shows that span; the bar shows its home.
 * - **`/discover`** is a Library screen, not a third service: catalogue
 *   search, downloads and quant guidance are all `library` endpoints. It
 *   takes `FolderOpen` rather than a second `Database` so the two Library
 *   screens are distinguishable while sharing a colour — and `FolderOpen`
 *   is the site's own icon for "your model files, where you put them",
 *   which is what a finished download is.
 */
export const SCREENS: readonly Screen[] = [
  {
    href: "/",
    label: "Home",
    icon: "Monitor",
    layer: "tools",
    spans: [],
    blurb: "What this machine has, the next thing to do, and a model to try.",
  },
  {
    href: "/playground",
    label: "Playground",
    icon: "Terminal",
    layer: "tools",
    spans: [],
    blurb: "A reference client and a diagnostic: talk to a model the way a harness does.",
  },
  {
    href: "/metrics",
    label: "Metrics",
    icon: "Radio",
    layer: "gateway",
    spans: [],
    blurb: "What the gateway served, per request and per attempt.",
  },
  {
    href: "/inference",
    label: "Inference",
    icon: "Cpu",
    layer: "drivers",
    spans: ["engines", "hardware"],
    blurb: "Every backend the gateway routes to, grouped by the machine it runs on.",
  },
  {
    href: "/library",
    label: "Library",
    icon: "Database",
    layer: "library",
    spans: ["hardware"],
    blurb: "The models in your own directories, read as they are, with a profile each.",
  },
  {
    href: "/discover",
    label: "Discover",
    icon: "FolderOpen",
    layer: "library",
    spans: ["hardware"],
    blurb: "Search the catalogue, see which quantization fits, download into your directories.",
  },
  {
    href: "/config",
    label: "Config",
    icon: "Server",
    layer: "agent",
    spans: ["gateway", "library", "control"],
    blurb: "Every component's settings, one tab per component per machine.",
  },
  {
    href: "/nodes",
    label: "Nodes",
    icon: "ShieldCheck",
    layer: "control",
    spans: [],
    blurb: "The machines in this install, and the token a new one joins with.",
  },
] as const;

/**
 * Routes under `src/app` that deliberately carry no navigation.
 *
 * `/login` and `/setup` have no session, so every link in the bar would
 * 401 — and the wizard is a linear transaction that a stray click out of
 * would abandon. `/runtimes` is a redirect stub kept for old links and
 * bookmarks; it became `/inference` on 2026-09-12.
 *
 * A route that is in neither this set nor `SCREENS` fails a test. That is
 * the point: the design's §0 defect is a screen nobody can reach.
 */
export const ROUTES_WITHOUT_NAV: readonly string[] = ["/login", "/setup", "/runtimes"] as const;

/**
 * Routes that render inside the shell as pages **of the install root**
 * without a slot in its page menu.
 *
 * `/backends/add` is the first (hobbyist UX S2): the form that adds an
 * app the person already runs — Ollama, a cloud CLI — reached from Home's
 * first-model card and from Inference. It is a task, not a place anyone
 * returns to, so a permanent menu entry would be a third "add" beside
 * Discover and Library. But the shell still has to know which object the
 * page is about: a page that selects nothing renders an empty page menu
 * and a tree with no row lit, silently — the exact defect the tree
 * design's §13 found in a bare `/config`. `defaultSelectionFor` in
 * `resourceTree.ts` answers for the pages in the menu; this set answers
 * for the ones under the root that are not, and the shell asks it second.
 *
 * Prefixes, matched on a segment boundary: `/backends` covers
 * `/backends/add` and would cover a future `/backends/<name>`, and never
 * `/backendsmith`.
 */
export const ROUTES_UNDER_INSTALL: readonly string[] = ["/backends"] as const;

/**
 * `"install"` for a pathname under `ROUTES_UNDER_INSTALL`, else `null`.
 * The same normalisation as `activeScreen`, so the static export's
 * trailing slash and a query string change nothing.
 */
export function installSubrouteSelection(pathname: string | null | undefined): "install" | null {
  if (!pathname) return null;
  const path = normalizePath(pathname);
  const under = ROUTES_UNDER_INSTALL.some(
    (route) => path === route || path.startsWith(`${route}/`),
  );
  return under ? "install" : null;
}

export interface NavGroup {
  readonly side: LayerSide;
  readonly label: string;
  readonly screens: readonly Screen[];
}

/**
 * The bar's two groups, which are the architecture page's own two halves:
 * its `layers-stack` (the request path) and its `layers-rail` (three
 * services beside it).
 *
 * Two groups rather than one per layer: eight labels for seven items is a
 * caption on each item, which groups nothing.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    side: "path",
    label: "The request path",
    screens: SCREENS.filter((s) => layerOf(s.layer).side === "path"),
  },
  {
    side: "beside",
    label: "Beside the path",
    screens: SCREENS.filter((s) => layerOf(s.layer).side === "beside"),
  },
] as const;

/** Look a layer up by id. Throws on an unknown id, which is a programming error. */
export function layerOf(id: LayerId): Layer {
  const found = LAYERS.find((l) => l.id === id);
  if (!found) throw new Error(`unknown layer: ${id}`);
  return found;
}

/**
 * Every layer a screen touches, home first, in the diagram's order.
 * This is what the per-screen breadcrumb renders.
 */
export function layersOf(screen: Screen): readonly Layer[] {
  return [screen.layer, ...screen.spans].map(layerOf);
}

/**
 * Which screen a pathname is on, by longest-prefix match.
 *
 * Longest-prefix rather than equality for two reasons: the static export
 * sets `trailingSlash: true`, so the browser's pathname is `/library/`
 * and not `/library`; and a future sub-route (`/config/gateway`, say)
 * should still mark its parent rather than nothing.
 *
 * `/` is special-cased to exact match — as a prefix it would match every
 * path, which would make Home permanently current.
 *
 * An unknown path returns `null` rather than falling back to `/`. A
 * screen that is not in the registry should look like what it is —
 * missing — not like Home.
 */
export function activeScreen(pathname: string | null | undefined): Screen | null {
  if (!pathname) return null;
  const path = normalizePath(pathname);
  if (path === "/") return SCREENS.find((s) => s.href === "/") ?? null;

  let best: Screen | null = null;
  for (const screen of SCREENS) {
    if (screen.href === "/") continue;
    if (path === screen.href || path.startsWith(`${screen.href}/`)) {
      if (!best || screen.href.length > best.href.length) best = screen;
    }
  }
  return best;
}

/**
 * Strip a query string, a fragment and any trailing slash, leaving at
 * least `/`. `usePathname()` gives no query or hash, but the acceptance
 * tests and any caller passing `window.location` do.
 */
export function normalizePath(pathname: string): string {
  const cut = pathname.split(/[?#]/, 1)[0] ?? "";
  const trimmed = cut.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/** The CSS custom property backing an accent role. */
export function accentVar(accent: AccentRole): string {
  switch (accent) {
    case "left":
      return "var(--accent-left)";
    case "right":
      return "var(--accent-right)";
    case "engine":
      return "var(--accent-engine)";
    case "hardware":
      return "var(--accent-hardware)";
  }
}
