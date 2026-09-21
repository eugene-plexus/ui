"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api";
import {
  accentVar,
  activeScreen,
  installSubrouteSelection,
  layerOf,
  unlistedPageTitle,
} from "@/lib/navigation";
import { pageTitle, useDocumentTitle } from "@/lib/pageTitle";
import {
  activePage,
  buildTree,
  defaultSelectionFor,
  findSelected,
  machineCount,
  pagesForSelection,
  parseSelection,
  type PageRef,
  type Selection,
  type TreeNode,
} from "@/lib/resourceTree";
import { clearSessionToken } from "@/lib/session";

import { LayerIcon } from "./LayerIcon";
import { LayerMap } from "./LayerMap";
import { pageHref, ResourceTree, useTopology } from "./ResourceTree";
import { RunDialog } from "./RunDialog";
import { IssuesBadge } from "./IssuesBadge";
import { TasksTray } from "./TasksTray";

/**
 * The three-column shell: the install tree, the selected object's pages,
 * and the page itself.
 *
 * **Design:** `specs/docs/design/ui-tree-navigation.md`, and the brief is
 * Troy's: *"a tree going down the left side… when the user clicks on the
 * component→node, you get a vertical menu with any appropriate pages for
 * that component on that node."* A cluster manager's navigation, because
 * this product's nouns are objects in a topology and a link bar can only
 * name screens.
 *
 * It replaces the grouped top bar of the slice before it, and keeps
 * everything underneath: the layer registry, the icons, the per-theme
 * accents, and the layer map panel that explains all eight layers.
 *
 * **A thin top bar survives** for the brand, that panel and Sign out.
 * Sign out in particular must not live inside a tree of objects — it is
 * not an object, and burying it is what left it on one screen before.
 */

export function AppShell({
  controls,
  children,
}: {
  /** This page's own controls, rendered at the end of the page row. */
  controls?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={null}>
      <AppShellInner controls={controls}>{children}</AppShellInner>
    </Suspense>
  );
}

function AppShellInner({
  controls,
  children,
}: {
  controls?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  // An explicit `sel` wins; otherwise the route says which object it is
  // about, so every URL that worked before the tree still works — a
  // bookmark, the launch panel's `?tab=` link, the `/runtimes` redirect.
  // A page under the install root that is not in its menu (`/backends/add`)
  // is answered last, by the registry, so it lights the root rather than
  // nothing.
  const requested =
    searchParams.get("sel") ??
    defaultSelectionFor(pathname, searchParams.get("tab")) ??
    installSubrouteSelection(pathname);

  // One topology, one tree, both consumers reading the same object. The
  // first build had the tree and the page menu fetch separately, and
  // they disagreed the moment a selection under-specified.
  const { topology, ready } = useTopology();
  const tree = useMemo(() => buildTree(topology), [topology]);
  const node = useMemo(() => findSelected(tree, requested), [tree, requested]);
  // The row's own `sel`, not the one the URL asked for: `agent` resolves
  // to `agent:<this machine>` on an enrolled node, and that is what the
  // tree highlights and what the page links carry.
  const sel = node?.sel ?? requested;

  // The tab says which page, and on a multi-host install which machine
  // -- see `pageTitle.ts`. The page name is the page MENU's label rather
  // than the screen registry's, because `/config` is "Preferences" under
  // the install root and "Config" under a component, and the menu is the
  // thing that already knows which. `activeScreen` answers for a screen
  // reached by a route with no menu slot, and `unlistedPageTitle` for a
  // page that is in neither (`/backends/add`). None of the three
  // answering leaves the brand alone, rather than a guess.
  const selection = useMemo(() => parseSelection(sel), [sel]);
  const menuPage = activePage(sel ? pagesForSelection(selection) : [], pathname);
  const title = pageTitle({
    page: menuPage?.label ?? activeScreen(pathname)?.label ?? unlistedPageTitle(pathname),
    // The selected object's machine first: two `/config` tabs differ only
    // by which node they address, and this console's own host is the same
    // string on both.
    node: selection?.node ?? topology.localNode,
    machines: machineCount(topology),
  });
  useDocumentTitle(title);

  const [mapOpen, setMapOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const mapToggleRef = useRef<HTMLButtonElement | null>(null);
  const mapId = useId();

  const closeMap = useCallback(() => {
    setMapOpen(false);
    mapToggleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!mapOpen && !drawerOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (mapOpen) closeMap();
      else setDrawerOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mapOpen, drawerOpen, closeMap]);

  async function handleLogout() {
    try {
      await api.delete("agent", "/v1/auth/sessions/current");
    } catch {
      // The session is being abandoned either way; failing to revoke it
      // server-side must not strand the operator on a page they asked to
      // leave.
    }
    clearSessionToken();
    router.push("/login");
  }

  return (
    <div className="relative z-10 flex h-dvh flex-col overflow-hidden">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5">
        <button
          type="button"
          onClick={() => setDrawerOpen((o) => !o)}
          aria-expanded={drawerOpen}
          data-testid="tree-drawer-toggle"
          className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-sm transition-colors hover:bg-[color:var(--panel-hover)] lg:hidden"
          aria-label="Show the install tree"
        >
          ☰
        </button>
        <Link href="/" aria-label="Eugene Plexus" className="flex shrink-0 items-center">
          <Image src="/eugene-icon.svg" alt="" width={22} height={22} priority />
        </Link>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          {/* Background work, from every signed-in screen (hobbyist UX P7):
              a download started on Discover is visible from Config. */}
          <TasksTray />
          {/* Things that need a person (hobbyist UX P7's second half),
              from every signed-in screen -- including the sealed control
              root, whose unlock is inside the list because every other
              screen is useless while it is shut. Renders nothing at all
              when there is nothing to say. */}
          <IssuesBadge />
          <button
            type="button"
            ref={mapToggleRef}
            onClick={() => setMapOpen((o) => !o)}
            aria-expanded={mapOpen}
            aria-controls={mapId}
            data-testid="layer-map-toggle"
            className="font-ui flex items-center gap-1.5 rounded-[var(--radius)] border border-[color:var(--border)] px-2.5 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
            title="The five layers and the three services beside them, and which screen lives where"
          >
            <LayerIcon name="Monitor" size={14} />
            The system
          </button>
          <button
            type="button"
            onClick={() => void handleLogout()}
            data-testid="sign-out"
            className="font-ui flex items-center gap-1.5 rounded-[var(--radius)] border border-[color:var(--border)] px-2.5 py-1 text-sm text-[color:var(--muted)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] hover:text-[color:var(--foreground)]"
            title="Revoke this session and return to the sign-in screen"
          >
            <LayerIcon name="KeyRound" size={14} />
            Sign out
          </button>
        </div>
      </header>

      {mapOpen && <LayerMap id={mapId} current={null} onClose={closeMap} />}
      {/* One-click run's one question, wherever the person is when a run
          reaches it (S3). Renders nothing until a run is asking. */}
      <RunDialog />

      <div className="relative flex min-h-0 flex-1">
        {/* Desk width: a column. Narrow: a drawer over the content, because
            430px has no room for three columns. */}
        <div data-testid="tree-column" className="hidden w-60 shrink-0 lg:block">
          <ResourceTree tree={tree} localNode={topology.localNode} selected={sel} ready={ready} />
        </div>
        {drawerOpen && (
          // A backdrop, so a tap outside the drawer closes it. Without
          // one the only way out is the toggle, which the drawer covers.
          <button
            type="button"
            aria-label="Close the install tree"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 z-10 bg-black/30 lg:hidden"
          />
        )}
        {drawerOpen && (
          <div
            data-testid="tree-drawer"
            className="absolute inset-y-0 left-0 z-20 flex w-64 shadow-lg lg:hidden"
          >
            <ResourceTree
              tree={tree}
              localNode={topology.localNode}
              selected={sel}
              ready={ready}
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <PageMenu
            node={node}
            selection={selection}
            sel={sel}
            localNode={topology.localNode}
            pathname={pathname}
            controls={controls}
          />
          <div id="main-content" tabIndex={-1} className="flex min-h-0 flex-1 flex-col">
            {children}
          </div>
        </div>
      </div>
      {/* The selection is read here and nowhere else, so a page never has
          to know the tree exists. */}
      <span hidden data-testid="selection" data-sel={sel ?? ""} />
    </div>
  );
}

/**
 * The second column, as briefed: the pages that apply to whatever is
 * selected.
 *
 * **Two objects have one page each and that is reported, not padded.**
 * An agent and a driver show only Config today, because the UI has seven
 * screens and the tree has more objects than that. Inventing an overview
 * to fill the column would be adding product under cover of a navigation
 * change; leaving the slot visibly thin is what makes the gap obvious.
 *
 * Bounded by design, unlike the Config tab strip it replaces: a single
 * object never has many pages, so this list does not grow with the size
 * of the install.
 */
function PageMenu({
  node,
  selection,
  sel,
  localNode,
  pathname,
  controls,
}: {
  node: TreeNode | null;
  selection: Selection | null;
  sel: string | null;
  localNode: string | null;
  pathname: string | null;
  controls?: React.ReactNode;
}) {
  // From the selection's kind, not from the resolved row: the pages are
  // knowable before the topology answers, and reading them off the row
  // left the menu empty for the first frames.
  const pages: PageRef[] = sel ? pagesForSelection(selection) : [];
  const current = activePage(pages, pathname);
  const accent = node?.layer ? layerOf(node.layer).accent : "left";

  return (
    <nav
      aria-label="Pages"
      data-testid="page-menu"
      data-sel={sel ?? ""}
      className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5"
    >
      {node && (
        <span className="font-ui mr-1 flex items-center gap-1.5 text-sm font-semibold">
          <LayerIcon name={node.icon} accent={accent} size={14} />
          {node.label}
        </span>
      )}
      {sel &&
        pages.map((page) => {
          const active = current?.id === page.id;
          return (
            <Link
              key={page.id}
              href={pageHref(page, sel, localNode)}
              aria-current={active ? "page" : undefined}
              data-page={page.id}
              className={`font-ui flex items-center gap-1.5 rounded-[var(--radius)] border-b-2 px-2.5 py-1 text-sm transition-colors hover:bg-[color:var(--panel-hover)] ${
                active ? "bg-[color:var(--panel-hover)] font-semibold" : "border-transparent"
              }`}
              style={active ? { borderBottomColor: accentVar(accent) } : undefined}
            >
              <LayerIcon name={page.icon} size={13} />
              {page.label}
            </Link>
          );
        })}
      {controls && (
        <div className="ml-auto flex max-w-full min-w-0 flex-wrap items-center gap-2">
          {controls}
        </div>
      )}
    </nav>
  );
}
