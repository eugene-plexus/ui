"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { accentVar, layerOf } from "@/lib/navigation";
import {
  configTabFor,
  hrefFor,
  parseSelection,
  type ComponentPlacement,
  type PageRef,
  type Topology,
  type TreeNode,
} from "@/lib/resourceTree";
import type { ComponentList, NodeIdentity } from "@/lib/types";

import { LayerIcon } from "./LayerIcon";

/**
 * The install as a tree, down the left side.
 *
 * **Design:** `specs/docs/design/ui-tree-navigation.md`. The model is in
 * `lib/resourceTree.ts` and is pure; this file is the rendering and the
 * four fetches that feed it.
 *
 * **Every source is soft, and that is the whole point.** The page an
 * operator opens when something is wrong must not fail because something
 * is wrong — the rule the Inference screen was built on. With the
 * control root sealed or unreachable the tree still shows the install
 * root, this machine's agent and this machine's components, plus one
 * line saying what is missing. That is strictly more than the tab strip
 * it replaces managed.
 */

const OPEN_KEY = "eugene-tree-open";

const EMPTY: Topology = { localNode: null, nodes: [], components: [] };

/**
 * The four soft reads the tree is built from, as one hook.
 *
 * **Hoisted out of the tree on purpose.** The first build had the tree
 * and the page menu each fetch and build their own, and they disagreed
 * the moment a selection under-specified: the URL said `agent`, the
 * tree's row was `agent:nav-node`, and the menu silently rendered
 * nothing. One topology, one tree, both consumers reading the same
 * object.
 */
export function useTopology(): { topology: Topology; ready: boolean } {
  const [topology, setTopology] = useState<Topology>(EMPTY);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [local, node, placement, nodeNames] = await Promise.all([
        api.get<ComponentList>("agent", "/v1/components").catch(() => null),
        api.get<NodeIdentity>("agent", "/v1/node").catch(() => null),
        api
          .get<{ components?: Partial<ComponentPlacement>[] }>("control", "/v1/components")
          .catch(() => null),
        api.get<{ nodes?: { name?: unknown }[] }>("control", "/v1/nodes").catch(() => null),
      ]);
      if (cancelled) return;

      const merged = new Map<string, ComponentPlacement>();
      for (const c of local?.components ?? []) {
        if (!c?.name || !c?.kind) continue;
        merged.set(`${c.name}@${node?.name ?? ""}`, {
          name: c.name,
          kind: c.kind,
          node: node?.name ?? null,
        });
      }
      for (const c of placement?.components ?? []) {
        if (typeof c?.name !== "string" || typeof c?.kind !== "string") continue;
        const on = typeof c.node === "string" ? c.node : null;
        merged.set(`${c.name}@${on ?? ""}`, { name: c.name, kind: c.kind, node: on });
      }

      setTopology({
        localNode: node?.name ?? null,
        nodes: (nodeNames?.nodes ?? [])
          .map((n) => n.name)
          .filter((n): n is string => typeof n === "string" && n.length > 0),
        components: [...merged.values()],
        // **An install has no name in the contract.** Nothing on
        // control's surface identifies one, so the root is labelled with
        // the product name. The model takes an `installName` because
        // naming an install is an obvious contract addition and the
        // fallback is already tested; inventing a field to read would be
        // worse than saying so.
        //
        // Both control reads failing is what a sealed or absent root
        // looks like. A standalone install is the same shape and says
        // the same thing, which is honest: there is no root answering
        // either way.
        rootUnreachable: placement === null && nodeNames === null,
      });
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { topology, ready };
}

export function ResourceTree({
  tree,
  localNode,
  selected,
  ready,
  onNavigate,
}: {
  tree: TreeNode;
  localNode: string | null;
  /** The `sel` of the row to mark, already resolved by the shell. */
  selected: string | null;
  ready: boolean;
  /** Called after a link is followed, so a narrow drawer can close. */
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(OPEN_KEY);
      if (raw) setOpen(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      // Private mode, or a value from an older shape. Branches open at
      // their defaults, which costs the operator one click.
    }
  }, []);

  // A selected leaf's ancestors are opened, so a pasted link lands with
  // its branch already expanded rather than on an invisible selection.
  const forced = useMemo(() => openPath(tree, selected), [tree, selected]);

  function toggle(key: string) {
    setOpen((prev) => {
      const next = { ...prev, [key]: !isOpen(prev, forced, key) };
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {
        // Not persisting an expansion state is not worth an error.
      }
      return next;
    });
  }

  return (
    <nav
      aria-label="Install"
      data-testid="resource-tree"
      data-ready={ready ? "true" : "false"}
      className="flex h-full min-w-0 flex-col gap-1 overflow-y-auto border-r border-[color:var(--border)] bg-[color:var(--panel-soft)] p-2"
    >
      <Row
        node={tree}
        depth={0}
        selected={selected}
        open={open}
        forced={forced}
        onToggle={toggle}
        onNavigate={onNavigate}
        localNode={localNode}
      />
      {!ready && (
        <p className="font-ui px-2 py-1 text-[11px] text-[color:var(--muted)]">Reading topology…</p>
      )}
    </nav>
  );
}

function isOpen(
  open: Record<string, boolean>,
  forced: Set<string>,
  key: string,
  fallback = true,
): boolean {
  if (key in open) return open[key]!;
  if (forced.has(key)) return true;
  return fallback;
}

/** Keys of every row on the path to the selection. */
function openPath(root: TreeNode, selected: string | null): Set<string> {
  const out = new Set<string>();
  if (!selected) return out;
  const walk = (node: TreeNode, trail: string[]): boolean => {
    const key = rowKey(node, trail);
    if (node.sel === selected) {
      trail.forEach((t) => out.add(t));
      return true;
    }
    return node.children.some((c) => walk(c, [...trail, key]));
  };
  walk(root, []);
  return out;
}

/** A stable key for a row, since grouping rows have no `sel`. */
function rowKey(node: TreeNode, trail: string[]): string {
  return node.sel ?? `${trail.join("/")}/${node.kind}:${node.label}`;
}

function Row({
  node,
  depth,
  selected,
  open,
  forced,
  onToggle,
  onNavigate,
  localNode,
  trail = [],
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  open: Record<string, boolean>;
  forced: Set<string>;
  onToggle: (key: string) => void;
  onNavigate?: () => void;
  localNode: string | null;
  trail?: string[];
}) {
  const key = rowKey(node, trail);
  const expandable = node.children.length > 0;
  const expanded = expandable ? isOpen(open, forced, key) : false;
  const active = !!node.sel && node.sel === selected;
  const accent = node.layer ? layerOf(node.layer).accent : "left";

  // A row that can be selected is a link to its first page; one that only
  // groups is a button that opens it.
  const target = node.sel ? firstPageHref(node, localNode) : null;

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-0.5" style={{ paddingLeft: `${depth * 12}px` }}>
        {expandable ? (
          <button
            type="button"
            onClick={() => onToggle(key)}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${node.label}`}
            data-testid={`tree-toggle-${key}`}
            className="font-ui shrink-0 rounded-[var(--radius)] px-1 text-[10px] text-[color:var(--muted)] hover:bg-[color:var(--panel-hover)]"
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-[15px] shrink-0" aria-hidden="true" />
        )}

        {target ? (
          <Link
            href={target}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            data-tree-sel={node.sel}
            data-layer={node.layer ?? "install"}
            className={`font-ui flex min-w-0 flex-1 items-center gap-1.5 rounded-[var(--radius)] px-1.5 py-1 text-xs transition-colors hover:bg-[color:var(--panel-hover)] ${
              active ? "bg-[color:var(--panel-hover)] font-semibold" : ""
            }`}
            style={active ? { boxShadow: `inset 2px 0 0 0 ${accentVar(accent)}` } : undefined}
          >
            <LayerIcon name={node.icon} accent={accent} size={14} />
            <span className="truncate">{node.label}</span>
            {node.hint && (
              <span className="ml-auto shrink-0 truncate text-[10px] text-[color:var(--muted)]">
                {node.hint}
              </span>
            )}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => onToggle(key)}
            data-tree-group={key}
            className="font-ui flex min-w-0 flex-1 items-center gap-1.5 rounded-[var(--radius)] px-1.5 py-1 text-left text-xs text-[color:var(--muted)] transition-colors hover:bg-[color:var(--panel-hover)]"
          >
            <LayerIcon name={node.icon} accent={accent} size={14} />
            <span className="truncate">{node.label}</span>
            {node.hint && (
              <span className="ml-auto shrink-0 truncate text-[10px]">{node.hint}</span>
            )}
          </button>
        )}
      </div>

      {/* A wrapper naming the parent, so "this driver sits under this
          machine" is assertable rather than merely true. Without it a
          tree that hung every driver straight off the type branch passed
          a check called "a driver sits under its machine". */}
      {expanded && (
        <div data-tree-children={key}>
          {node.children.map((child) => (
            <Row
              key={rowKey(child, [...trail, key])}
              node={child}
              depth={depth + 1}
              selected={selected}
              open={open}
              forced={forced}
              onToggle={onToggle}
              onNavigate={onNavigate}
              localNode={localNode}
              trail={[...trail, key]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Where clicking a tree row goes: its first page, carrying the
 * selection. For a Config page the selection also has to be translated
 * into the proxy target that page has always used, because Config
 * predates the tree.
 */
export function firstPageHref(node: TreeNode, localNode: string | null): string | null {
  const page = node.pages[0];
  if (!page || !node.sel) return null;
  return pageHref(page, node.sel, localNode);
}

/** One page's href for one selection. */
export function pageHref(page: PageRef, sel: string, localNode: string | null): string {
  const base = hrefFor(page, sel);
  if (page.id !== "config") return base;
  const selection = parseSelection(sel);
  const tab = selection ? configTabFor(selection, localNode) : null;
  return tab ? `${base}&tab=${encodeURIComponent(tab)}` : base;
}
