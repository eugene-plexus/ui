/**
 * The name people see for a machine (docs/design/node-labels.md).
 *
 * A node's `name` is its identity: the `node:<name>` proxy target, the
 * key in every map, the value in `?sel=` and in every API path. Its
 * `label`, set from Nodes or by the first-run wizard, is what a screen
 * shows. **This module is the one place a name turns into words**; key
 * sites keep using `.name` and never call it.
 *
 * Labels arrive with the control root's `GET /v1/nodes`, which several
 * hooks already poll. Each hands its rows to `recordNodeLabels`, and
 * `labelOf` reads the latest. With no root, or a sealed one, there are no
 * labels and every machine is shown by its name: less pretty, still right.
 */

import { useMemo, useSyncExternalStore } from "react";

export interface LabelledNode {
  name: string;
  label?: string | null;
}

/** One node's words: its label, else its name. */
export function nodeLabel(node: LabelledNode): string {
  return node.label?.trim() || node.name;
}

/**
 * name → words for a whole roster. The root refuses a label that matches
 * another machine's name or label, but a machine that joins later under a
 * name someone already used as a label would make two rows read the
 * same; then both are shown with their names, so the console never shows
 * two machines under one name.
 */
export function labelsFrom(nodes: readonly LabelledNode[]): Map<string, string> {
  const words = new Map<string, string>();
  const names = new Set(nodes.map((n) => n.name.toLowerCase()));
  for (const node of nodes) {
    const shown = nodeLabel(node);
    if (shown === node.name) continue;
    words.set(node.name, names.has(shown.toLowerCase()) ? `${shown} (${node.name})` : shown);
  }
  return words;
}

let current: ReadonlyMap<string, string> = new Map();
const listeners = new Set<() => void>();

/** Remember a fresh roster's labels. A call with the same labels is a no-op,
 * so the hooks that poll do not re-render every subscriber each time. */
export function recordNodeLabels(nodes: readonly LabelledNode[]): void {
  const next = labelsFrom(nodes);
  if (next.size === current.size && [...next].every(([k, v]) => current.get(k) === v)) return;
  current = next;
  for (const listener of listeners) listener();
}

/** The words for a node name; the name itself when it has no label. */
export function labelOf(name: string): string;
export function labelOf(name: string | null | undefined): string | null;
export function labelOf(name: string | null | undefined): string | null {
  if (name == null) return null;
  return current.get(name) ?? name;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): ReadonlyMap<string, string> {
  return current;
}

/** `labelOf`, re-rendering the component when a label changes. */
export function useNodeLabels(): (name: string | null | undefined) => string | null {
  const labels = useSyncExternalStore(subscribe, snapshot, snapshot);
  // One function per set of labels, so it can sit in a dependency list.
  return useMemo(() => (name) => (name == null ? null : (labels.get(name) ?? name)), [labels]);
}

/** For tests: forget every label. */
export function resetNodeLabels(): void {
  current = new Map();
  for (const listener of listeners) listener();
}
