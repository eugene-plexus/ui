/**
 * The navigation registry, and the two things about it that drift.
 *
 * **The website is in another repo.** `eugene-plexus/website`'s
 * `src/pages/architecture.astro` is where the layer names, icons and
 * colour roles are defined for the public; this UI copies them. Nothing
 * links the two files, so the only defence is a literal transcription
 * here that a person has to change deliberately. That is §1 of
 * `specs/docs/design/ui-navigation.md` and the table below.
 *
 * **A screen nobody added to the nav is invisible.** That is the defect
 * the whole slice exists to remove, so the route enumeration below fails
 * on a new directory under `src/app` that is in neither the registry nor
 * the explicit no-nav set.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  accentVar,
  activeScreen,
  installSubrouteSelection,
  LAYERS,
  layerOf,
  layersOf,
  NAV_GROUPS,
  normalizePath,
  ROUTES_UNDER_INSTALL,
  ROUTES_WITHOUT_NAV,
  unlistedPageTitle,
  unlistedTitledRoutes,
  SCREENS,
  type AccentRole,
  type IconName,
  type LayerId,
} from "./navigation";

/**
 * Transcribed by hand from `website/src/pages/architecture.astro` at
 * `3b5129c` — the `const components` array, the `.layer-*` blocks in the
 * stack, and the `.rail-*` cards. Order is the page's own: the five
 * layers of the request path top to bottom, then the rail.
 *
 * The colour column is the *role*, because the site writes
 * `var(--accent-left)` / `var(--accent-right)` for four of the six and
 * literals only for engines (`#2f9e6e`) and hardware (`#8a8a93`). A
 * literal in this test would assert about the modern theme, which is one
 * of three.
 */
const WEBSITE: ReadonlyArray<readonly [LayerId, string, IconName, AccentRole, "path" | "beside"]> =
  [
    ["tools", "Your tools", "Terminal", "left", "path"],
    ["gateway", "Gateway", "Radio", "right", "path"],
    ["drivers", "Inference drivers", "Cpu", "left", "path"],
    ["engines", "Engines and backends", "Cloud", "engine", "path"],
    ["hardware", "Your hardware", "HardDrive", "hardware", "path"],
    ["agent", "Agent", "Server", "left", "beside"],
    ["library", "Library", "Database", "left", "beside"],
    ["control", "Control root", "ShieldCheck", "right", "beside"],
  ];

describe("the registry agrees with the website", () => {
  it("has the site's eight layers, in the site's order", () => {
    expect(LAYERS.map((l) => l.id)).toEqual(WEBSITE.map(([id]) => id));
  });

  it.each(WEBSITE)("layer %s is '%s' with the %s icon", (id, name, icon, accent, side) => {
    const layer = layerOf(id);
    expect(layer.name).toBe(name);
    expect(layer.icon).toBe(icon);
    expect(layer.accent).toBe(accent);
    expect(layer.side).toBe(side);
  });

  it("puts five layers in the request path and three beside it", () => {
    expect(LAYERS.filter((l) => l.side === "path")).toHaveLength(5);
    expect(LAYERS.filter((l) => l.side === "beside")).toHaveLength(3);
  });

  it("maps each accent role to its own custom property", () => {
    const vars = (["left", "right", "engine", "hardware"] as const).map(accentVar);
    expect(vars).toEqual([
      "var(--accent-left)",
      "var(--accent-right)",
      "var(--accent-engine)",
      "var(--accent-hardware)",
    ]);
    expect(new Set(vars).size).toBe(4);
  });
});

describe("every screen resolves", () => {
  it("has nine navigable screens", () => {
    expect(SCREENS).toHaveLength(9);
  });

  it("puts Home at the root and the playground beside it, both under Your tools", () => {
    // S1 of the hobbyist UX plan: the install root's first page is Home,
    // its second the playground that used to be the landing page. Both
    // are where a person talks to the install, so both file under the
    // site's `tools` layer -- and the layer map must keep rendering with
    // two screens in one layer.
    const home = SCREENS.find((s) => s.href === "/");
    const playground = SCREENS.find((s) => s.href === "/playground");
    expect(home?.label).toBe("Home");
    expect(playground?.label).toBe("Playground");
    expect(home?.layer).toBe("tools");
    expect(playground?.layer).toBe("tools");
    expect(SCREENS.filter((s) => s.layer === "tools").map((s) => s.href)).toEqual([
      "/",
      "/playground",
    ]);
  });

  it("files each screen under a real layer", () => {
    for (const screen of SCREENS) {
      expect(() => layerOf(screen.layer)).not.toThrow();
    }
  });

  it("spans only real layers, and never its own", () => {
    for (const screen of SCREENS) {
      for (const span of screen.spans) {
        expect(() => layerOf(span)).not.toThrow();
        expect(span).not.toBe(screen.layer);
      }
      expect(new Set(screen.spans).size).toBe(screen.spans.length);
    }
  });

  it("puts the home layer first in the breadcrumb", () => {
    for (const screen of SCREENS) {
      expect(layersOf(screen).at(0)?.id).toBe(screen.layer);
      expect(layersOf(screen)).toHaveLength(1 + screen.spans.length);
    }
  });

  it("gives /inference the three layers its rows join", () => {
    const inference = SCREENS.find((s) => s.href === "/inference");
    expect(layersOf(inference!).map((l) => l.name)).toEqual([
      "Inference drivers",
      "Engines and backends",
      "Your hardware",
    ]);
  });

  it("has a unique href, label and blurb per screen", () => {
    expect(new Set(SCREENS.map((s) => s.href)).size).toBe(SCREENS.length);
    expect(new Set(SCREENS.map((s) => s.label)).size).toBe(SCREENS.length);
    expect(new Set(SCREENS.map((s) => s.blurb)).size).toBe(SCREENS.length);
  });

  it("gives the two Library screens one colour and two icons", () => {
    const library = SCREENS.filter((s) => s.layer === "library");
    expect(library.map((s) => s.href)).toEqual(["/library", "/discover"]);
    expect(new Set(library.map((s) => s.icon)).size).toBe(2);
  });

  it("gives the two Gateway screens two icons, Routing after Metrics", () => {
    // Routing (2026-09-21): the priority lists as their own screen. It
    // files under the gateway — the lists are the gateway's own config —
    // and spans drivers, because every row resolves to the drivers
    // serving a model id.
    const gateway = SCREENS.filter((s) => s.layer === "gateway");
    expect(gateway.map((s) => s.href)).toEqual(["/metrics", "/routing"]);
    expect(new Set(gateway.map((s) => s.icon)).size).toBe(2);
    expect(SCREENS.find((s) => s.href === "/routing")?.spans).toEqual(["drivers"]);
  });
});

describe("the groups are the page's two halves", () => {
  it("has exactly two, labelled as the site labels them", () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(["The request path", "Beside the path"]);
  });

  it("covers every screen exactly once", () => {
    const grouped = NAV_GROUPS.flatMap((g) => g.screens.map((s) => s.href));
    expect(grouped.sort()).toEqual(SCREENS.map((s) => s.href).sort());
  });

  it("orders the request path down the diagram", () => {
    expect(NAV_GROUPS.at(0)?.screens.map((s) => s.href)).toEqual([
      "/",
      "/playground",
      "/metrics",
      "/routing",
      "/inference",
    ]);
    expect(NAV_GROUPS.at(1)?.screens.map((s) => s.href)).toEqual([
      "/library",
      "/discover",
      "/config",
      "/nodes",
    ]);
  });
});

describe("every route under src/app is accounted for", () => {
  /**
   * The enumeration that catches a screen added without a nav entry.
   * Reads the App Router's own directory rather than a list, because a
   * list is the thing that goes stale.
   */
  function routeDirectories(): string[] {
    // `process.cwd()` and not `import.meta.url`: vite rewrites the
    // latter during transform and it does not come back as a file URL.
    const appDir = resolve(process.cwd(), "src", "app");
    return readdirSync(appDir)
      .filter((entry) => !entry.startsWith("_") && !entry.startsWith("."))
      .filter((entry) => statSync(join(appDir, entry)).isDirectory())
      .map((entry) => `/${entry}`)
      .sort();
  }

  it("lists every route as either navigable, under the install, or deliberately nav-less", () => {
    const known = new Set<string>([
      ...SCREENS.map((s) => s.href),
      ...ROUTES_WITHOUT_NAV,
      ...ROUTES_UNDER_INSTALL,
    ]);
    const unaccounted = routeDirectories().filter((route) => !known.has(route));
    expect(unaccounted, `routes with no entry in navigation.ts: ${unaccounted.join(", ")}`).toEqual(
      [],
    );
  });

  it("points every navigable screen at a route that exists", () => {
    const routes = new Set(routeDirectories());
    const missing = SCREENS.filter((s) => s.href !== "/" && !routes.has(s.href)).map((s) => s.href);
    expect(missing, `registry entries with no page: ${missing.join(", ")}`).toEqual([]);
  });

  it("points every route under the install at a directory that exists", () => {
    const routes = new Set(routeDirectories());
    const missing = ROUTES_UNDER_INSTALL.filter((route) => !routes.has(route));
    expect(missing, `install sub-routes with no page: ${missing.join(", ")}`).toEqual([]);
  });

  it("excludes exactly login, setup and the runtimes redirect", () => {
    expect([...ROUTES_WITHOUT_NAV].sort()).toEqual(["/login", "/runtimes", "/setup"]);
  });

  it("names every shell page that neither a screen nor a page menu can name", () => {
    // The tab-title registry (2026-09-17). A route the shell renders and
    // nothing can name reads in the tab as the bare product name, which
    // is the state the whole title change exists to leave behind.
    const named = new Set(unlistedTitledRoutes());
    // Each one points at a real page: a nested route, so the directory
    // check above (which reads only the top level) does not cover it.
    for (const route of named) {
      expect(
        existsSync(resolve(process.cwd(), "src", "app", ...route.slice(1).split("/"), "page.tsx")),
        `${route} has no page.tsx`,
      ).toBe(true);
      // And is named, rather than mapped to an empty string.
      expect(unlistedPageTitle(route)?.trim()).toBeTruthy();
    }
    // Never a route a screen already names: two answers for one tab, and
    // the shell would silently prefer the screen.
    for (const screen of SCREENS) expect(named.has(screen.href)).toBe(false);
  });

  it("keeps the three sets disjoint", () => {
    // A route in two sets would be answered by whichever the shell asks
    // first, and the disagreement would be invisible until a tree row
    // failed to light.
    const all = [...SCREENS.map((s) => s.href), ...ROUTES_WITHOUT_NAV, ...ROUTES_UNDER_INSTALL];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("a page under the install that is not in its menu", () => {
  it("selects the install root for /backends/add, however the export spells it", () => {
    // S2's add-an-app form: the shell asks `defaultSelectionFor` first,
    // which knows only the pages in a menu, and this second. Without it
    // the tree lit nothing and the page menu rendered empty — silently.
    expect(installSubrouteSelection("/backends/add")).toBe("install");
    expect(installSubrouteSelection("/backends/add/")).toBe("install");
    expect(installSubrouteSelection("/backends/add/?from=home")).toBe("install");
    expect(installSubrouteSelection("/backends")).toBe("install");
  });

  it("answers nothing for every other route", () => {
    // Segment boundary, not string prefix: verified the same way
    // `activeScreen`'s case was — `/backendsmith` starts with `/backends`.
    expect("/backendsmith".startsWith("/backends")).toBe(true);
    expect(installSubrouteSelection("/backendsmith")).toBeNull();
    expect(installSubrouteSelection("/login")).toBeNull();
    expect(installSubrouteSelection("/")).toBeNull();
    expect(installSubrouteSelection(null)).toBeNull();
    expect(installSubrouteSelection("")).toBeNull();
  });
});

describe("the active screen", () => {
  it("matches Home only on the root", () => {
    expect(activeScreen("/")?.href).toBe("/");
    expect(activeScreen("/library")?.href).toBe("/library");
    expect(activeScreen("/library")?.href).not.toBe("/");
  });

  it("matches the playground on its own route, and not on the root", () => {
    expect(activeScreen("/playground")?.href).toBe("/playground");
    expect(activeScreen("/playground/")?.href).toBe("/playground");
    expect(activeScreen("/")?.href).not.toBe("/playground");
  });

  it("tolerates the trailing slash the static export produces", () => {
    // `trailingSlash: true`, so the browser's pathname is `/library/`.
    expect(activeScreen("/library/")?.href).toBe("/library");
    expect(activeScreen("/")?.href).toBe("/");
    expect(activeScreen("//")?.href).toBe("/");
  });

  it("marks the parent for a sub-route", () => {
    expect(activeScreen("/config/gateway")?.href).toBe("/config");
    expect(activeScreen("/inference/node-b/")?.href).toBe("/inference");
  });

  it("ignores a query string and a fragment", () => {
    expect(activeScreen("/config?tab=agent")?.href).toBe("/config");
    expect(activeScreen("/config/?tab=agent#roots")?.href).toBe("/config");
  });

  it("returns null for a path with no screen, rather than Home", () => {
    // A screen missing from the registry should look missing. Falling
    // back to `/` would mark Home current on /login and on every future
    // route nobody registered.
    expect(activeScreen("/login")).toBeNull();
    expect(activeScreen("/setup")).toBeNull();
    expect(activeScreen("/nope")).toBeNull();
    expect(activeScreen(null)).toBeNull();
    expect(activeScreen("")).toBeNull();
  });

  it("does not match a screen whose href is a string prefix of another route", () => {
    // `/configuration` starts with `/config` as a string but is not
    // under it. Matching on segment boundaries is what stops it being a
    // Config screen.
    //
    // The first version of this test used `/librarian` vs `/library`,
    // which is NOT a string prefix ("librarian" diverges at the `i`), so
    // it passed against an implementation with the boundary check
    // removed — the assertion could not fail. Verified by sabotage that
    // this one can.
    expect("/configuration".startsWith("/config")).toBe(true);
    expect(activeScreen("/configuration")).toBeNull();
    expect(activeScreen("/nodes-b")).toBeNull();
  });

  it("normalizes paths the same way everywhere", () => {
    expect(normalizePath("/library/")).toBe("/library");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("/config/?x=1#y")).toBe("/config");
  });
});
