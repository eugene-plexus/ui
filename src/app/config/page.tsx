"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ConfigEditor } from "@/components/ConfigEditor";
import { UIPreferences } from "@/components/UIPreferences";
import { api, describeError } from "@/lib/api";
import { targetFor } from "@/lib/nodeBudget";
import {
  configTabFor,
  parseSelection,
  selectionFromConfigTab,
  type Selection,
} from "@/lib/resourceTree";
import type { NodeIdentity } from "@/lib/types";

/**
 * One object's settings.
 *
 * **This page used to own a tab per component per node**, which grew as
 * `1 + nodes + up-to-3 singletons + every driver` — 54 buttons on a
 * ten-node install with four models each, in a wrapping horizontal
 * strip. That is the defect that produced the tree
 * (`specs/docs/design/ui-tree-navigation.md`): the strip was one screen
 * holding every object, and the tree is what picks the object now.
 *
 * So this page no longer decides what it is about. The selection arrives
 * in `?sel=`, the shell renders the tree and the page menu around it,
 * and everything here is about exactly one thing.
 *
 * **`?tab=` still works**, because it is in shipped builds — the launch
 * panel's "map it" link writes `?tab=node:<name>` — and
 * `selectionFromConfigTab` translates it. `configTabFor` translates back,
 * because the proxy target is still how the editor addresses a
 * component.
 */
export default function ConfigPage() {
  // `useSearchParams` suspends during prerender, so the boundary is
  // required rather than decorative.
  return (
    <Suspense fallback={null}>
      <ConfigPageInner />
    </Suspense>
  );
}

/** Where a component runs, as the control root reports it. */
interface Placement {
  node: string;
  name: string;
  kind: string;
}

function ConfigPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const raw = searchParams.get("sel") ?? selectionFromConfigTab(searchParams.get("tab"));
  const selection = parseSelection(raw);

  const [localNode, setLocalNode] = useState<string | null>(null);
  const [placement, setPlacement] = useState<Placement[]>([]);
  const [multiNode, setMultiNode] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  /**
   * Only enough topology to say *which machine* these settings are about.
   * The tree does the rest, and both fail soft: a standalone install has
   * no root to ask, and a sealed one answers nothing.
   */
  const load = useCallback(async () => {
    const [node, components, nodes] = await Promise.all([
      api.get<NodeIdentity>("agent", "/v1/node").catch(() => null),
      api.get<{ components?: Partial<Placement>[] }>("control", "/v1/components").catch(() => null),
      api.get<{ nodes?: { name?: unknown }[] }>("control", "/v1/nodes").catch(() => null),
    ]);
    setLocalNode(node?.name ?? null);
    setPlacement(
      (components?.components ?? []).filter(
        (c): c is Placement =>
          typeof c.node === "string" && typeof c.name === "string" && typeof c.kind === "string",
      ),
    );
    setMultiNode((nodes?.nodes ?? []).length > 1);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!selection) {
    return (
      <AppShell>
        <main className="mx-auto w-full max-w-3xl overflow-y-auto px-6 py-8">
          <p className="font-ui text-sm">Nothing selected.</p>
          <p className="mt-2 text-sm text-[color:var(--muted)]">
            Pick a component in the tree on the left. Every path in a component&rsquo;s settings is
            a path on the machine that component runs on, so the tree asks which machine before it
            asks which setting.
          </p>
        </main>
      </AppShell>
    );
  }

  // Browser preferences are the one thing on this page that is not a
  // component's settings, so they hang on the install root — the only
  // row in the tree that is not a component.
  if (selection.type === "install") {
    return (
      <AppShell>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <UIPreferences />
        </div>
      </AppShell>
    );
  }

  const target = configTabFor(selection, localNode) ?? "agent";
  const node = nodeOf(selection, placement, localNode);
  const label = labelOf(selection, node, multiNode);
  const elsewhere = node !== null && node !== localNode;

  /**
   * Remove an inference-driver from the install.
   *
   * `DELETE /v1/components/{name}` has existed on the agent since M0 and
   * stops the process as it forgets the declaration; nothing in the UI
   * had ever called it. The first operator to try removed an Ollama
   * driver by killing the process, and the supervisor respawned it --
   * which is what supervision is for, and exactly why the declaration
   * has to go rather than the process. Sent to the agent that owns the
   * driver, which may be another node.
   */
  async function removeDriver() {
    if (!selection || selection.type !== "driver" || !selection.name) return;
    const confirmed = window.confirm(
      `Remove the driver "${selection.name}"${node ? ` from ${node}` : ""}?\n\n` +
        "Its process is stopped and the gateway stops routing to it. Whatever it fronts " +
        "(an Ollama, a cloud CLI, an engine you run yourself) is untouched -- only this " +
        "install's knowledge of it goes.",
    );
    if (!confirmed) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await api.delete<void>(
        targetFor(node, localNode),
        `/v1/components/${encodeURIComponent(selection.name)}`,
      );
      // The object this page was about no longer exists, so the tree has
      // to be rebuilt and the selection has to move somewhere real.
      router.push("/inference");
    } catch (e) {
      setRemoveError(describeError(e));
      setRemoving(false);
    }
  }

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col">
        {removeError && (
          <div className="status-error border-b px-4 py-2 text-sm">{removeError}</div>
        )}

        {/* Which machine these settings are about. Every path in a
            component's config is a path on the host that component runs
            on -- inside its container, if it runs in one -- and on an
            install that spans hosts that is frequently not the machine
            the browser is on. Said once, here, for every component. */}
        {(multiNode || selection.type === "driver") && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--border)] bg-[color:var(--panel-soft)] px-4 py-2 text-sm text-[color:var(--muted)]">
            <span>
              {node ? (
                <>
                  Runs on <span className="font-mono">{node}</span>
                  {elsewhere ? " — not the machine you are browsing from" : " — this machine"}.
                  Paths in these settings are paths on that host, inside its container if it runs in
                  one.
                </>
              ) : (
                <>Runs on this machine.</>
              )}
            </span>
            {selection.type === "driver" && (
              <button
                type="button"
                onClick={() => void removeDriver()}
                disabled={removing}
                className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-0.5 text-[0.6875rem] transition-colors hover:border-[color:var(--status-error,#f85149)] hover:text-[color:var(--status-error,#f85149)] disabled:opacity-30"
                title="Stops the driver's process and forgets its declaration. What it fronts is untouched."
              >
                {removing ? "removing…" : "Remove this driver"}
              </button>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          <ConfigEditor key={target} target={target} label={label} />
        </div>
      </div>
    </AppShell>
  );
}

/** Which machine the selected object runs on, as far as anything knows. */
function nodeOf(
  selection: Selection,
  placement: Placement[],
  localNode: string | null,
): string | null {
  if (selection.node) return selection.node;
  if (selection.type === "agent") return localNode;
  const kind = selection.type === "control" ? "control" : selection.type;
  return placement.find((p) => p.kind === kind)?.node ?? localNode;
}

const SINGLETON_LABEL = {
  gateway: "Gateway",
  library: "Library",
  control: "Control root",
} as const;

function labelOf(selection: Selection, node: string | null, multiNode: boolean): string {
  const base =
    selection.type === "agent"
      ? "Agent"
      : selection.type === "driver"
        ? (selection.name ?? "Driver")
        : SINGLETON_LABEL[selection.type as keyof typeof SINGLETON_LABEL];
  return multiNode && node ? `${base} @ ${node}` : base;
}
