"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api";
import { accentVar, layerOf } from "@/lib/navigation";
import {
  activePage,
  buildTree,
  defaultSelectionFor,
  findSelected,
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
  const requested =
    searchParams.get("sel") ?? defaultSelectionFor(pathname, searchParams.get("tab"));

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
    <div className="relative z-10 flex h-screen flex-col overflow-hidden">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>

      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5">
        <button
          type="button"
          onClick={() => setDrawerOpen((o) => !o)}
          aria-expanded={drawerOpen}
          data-testid="tree-drawer-toggle"
          className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-xs transition-colors hover:bg-[color:var(--panel-hover)] lg:hidden"
          aria-label="Show the install tree"
        >
          ☰
        </button>
        <Link href="/" aria-label="Eugene Plexus" className="flex shrink-0 items-center">
          <Image src="/eugene-icon.svg" alt="" width={22} height={22} priority />
        </Link>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            ref={mapToggleRef}
            onClick={() => setMapOpen((o) => !o)}
            aria-expanded={mapOpen}
            aria-controls={mapId}
            data-testid="layer-map-toggle"
            className="font-ui flex items-center gap-1.5 rounded-[var(--radius)] border border-[color:var(--border)] px-2.5 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
            title="The five layers and the three services beside them, and which screen lives where"
          >
            <LayerIcon name="Monitor" size={14} />
            The system
          </button>
          <button
            type="button"
            onClick={() => void handleLogout()}
            data-testid="sign-out"
            className="font-ui flex items-center gap-1.5 rounded-[var(--radius)] border border-[color:var(--border)] px-2.5 py-1 text-xs text-[color:var(--muted)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] hover:text-[color:var(--foreground)]"
            title="Revoke this session and return to the sign-in screen"
          >
            <LayerIcon name="KeyRound" size={14} />
            Sign out
          </button>
        </div>
      </header>

      {mapOpen && <LayerMap id={mapId} current={null} onClose={closeMap} />}

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
            selection={parseSelection(sel)}
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
        <span className="font-ui mr-1 flex items-center gap-1.5 text-xs font-semibold">
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
              className={`font-ui flex items-center gap-1.5 rounded-[var(--radius)] border-b-2 px-2.5 py-1 text-xs transition-colors hover:bg-[color:var(--panel-hover)] ${
                active ? "bg-[color:var(--panel-hover)] font-semibold" : "border-transparent"
              }`}
              style={active ? { borderBottomColor: accentVar(accent) } : undefined}
            >
              <LayerIcon name={page.icon} size={13} />
              {page.label}
            </Link>
          );
        })}
      {controls && <div className="ml-auto flex flex-wrap items-center gap-2">{controls}</div>}
    </nav>
  );
}
