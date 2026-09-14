"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/AppNav";
import { ConfigEditor } from "@/components/ConfigEditor";
import { UIPreferences } from "@/components/UIPreferences";
import { ApiError, api, describeError } from "@/lib/api";
import { targetFor } from "@/lib/nodeBudget";
import type { ComponentList, NodeIdentity } from "@/lib/types";

interface Tab {
  /** The proxy target the editor talks to, and the `?tab=` value. */
  value: string;
  label: string;
  /** The node this component runs on, when the install spans more
   * than one and it is known. Null for the UI tab and for the local
   * agent on a standalone host. */
  node: string | null;
  kind: "ui" | "agent" | "gateway" | "library" | "control" | "inference-driver";
}

const SINGLETON_LABEL = { gateway: "Gateway", library: "Library", control: "Control" } as const;

/** What the control root knows: every component and where it runs. */
interface Placement {
  node: string;
  name: string;
  kind: string;
}

async function installPlacement(): Promise<Placement[]> {
  try {
    const list = await api.get<{ components?: Partial<Placement>[] }>("control", "/v1/components");
    return (list.components ?? []).filter(
      (c): c is Placement =>
        typeof c.node === "string" && typeof c.name === "string" && typeof c.kind === "string",
    );
  } catch {
    // Standalone, or the root is down or sealed: this host's own
    // topology is the whole answer, and it is what is rendered.
    return [];
  }
}

/** Every enrolled node, by name. The agent is not a component, so
 * `/v1/components` cannot list the other nodes' agents; `/v1/nodes` can. */
async function installNodes(): Promise<string[]> {
  try {
    const list = await api.get<{ nodes?: { name?: unknown }[] }>("control", "/v1/nodes");
    return (list.nodes ?? [])
      .map((n) => n.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0);
  } catch {
    return [];
  }
}

export default function ConfigPage() {
  // `useSearchParams` suspends during prerender, so the boundary is
  // required rather than decorative.
  return (
    <Suspense fallback={null}>
      <ConfigPageInner />
    </Suspense>
  );
}

function ConfigPageInner() {
  const [tabs, setTabs] = useState<Tab[]>([
    { value: "ui", label: "UI", node: null, kind: "ui" },
    { value: "agent", label: "Agent", node: null, kind: "agent" },
  ]);
  const [localNode, setLocalNode] = useState<string | null>(null);
  const [multiNode, setMultiNode] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // A link can land on a tab — the launch panel's "map it" points at the
  // node's agent — so the initial tab comes from the URL when there is
  // one. Applied once; picking another tab afterwards is not fought.
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [tab, setTab] = useState<string>(requestedTab || "ui");
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Three sources, deliberately. This host's own topology is where a
  // local driver's URL is written down and therefore the list that
  // cannot disagree with what the proxy resolves. The control root adds
  // every component on every OTHER node, each labelled with its node,
  // because two workers can each have a `llama-1` and the proxy resolves
  // a name to the first it finds -- and because "which machine are these
  // paths on" is the question an operator asked and this page did not
  // answer. And the root's node registry adds every other node's AGENT
  // (M11): an agent is not a component, so the component list cannot
  // name it, yet its settings -- the advertise address, the engine
  // binary, and where another host's model directories are mounted --
  // are exactly the ones an operator at the root's console needs to
  // reach. All fail soft: a standalone install has no root to ask.
  const load = useCallback(async () => {
    try {
      const [list, node, placement, nodeNames] = await Promise.all([
        api.get<ComponentList>("agent", "/v1/components"),
        api.get<NodeIdentity>("agent", "/v1/node").catch(() => null),
        installPlacement(),
        installNodes(),
      ]);
      const local = node?.name ?? null;
      setLocalNode(local);
      const nodes = new Set(placement.map((p) => p.node));
      for (const name of nodeNames) nodes.add(name);
      if (local) nodes.add(local);
      const several = nodes.size > 1;
      setMultiNode(several);

      const next: Tab[] = [
        { value: "ui", label: "UI", node: null, kind: "ui" },
        {
          value: "agent",
          label: several && local ? `Agent @ ${local}` : "Agent",
          node: several ? local : null,
          kind: "agent",
        },
      ];
      // The other nodes' agents, addressed as nodes: `node:<name>` is the
      // proxy target that reaches that agent's own API.
      for (const name of nodeNames) {
        if (name === local) continue;
        next.push({
          value: targetFor(name, local),
          label: `Agent @ ${name}`,
          node: name,
          kind: "agent",
        });
      }

      const seen = new Set<string>();
      const localComponents = list.components ?? [];

      // Singletons next, in the order they have always appeared. Local
      // when this host has one; otherwise wherever the root says it is.
      for (const kind of ["gateway", "library", "control"] as const) {
        const here = localComponents.find((c) => c.kind === kind);
        const elsewhere = placement.find((p) => p.kind === kind);
        const owner = here ? local : (elsewhere?.node ?? null);
        if (!here && !elsewhere) continue;
        const name = SINGLETON_LABEL[kind];
        next.push({
          value: kind,
          label: several && owner ? `${name} @ ${owner}` : name,
          node: owner,
          kind,
        });
      }

      for (const c of localComponents) {
        if (c.kind !== "inference-driver") continue;
        seen.add(c.name);
        next.push({
          value: c.name,
          label: several && local ? `${c.name} @ ${local}` : c.name,
          node: local,
          kind: "inference-driver",
        });
      }
      for (const p of placement) {
        if (p.kind !== "inference-driver" || seen.has(p.name)) continue;
        seen.add(p.name);
        next.push({
          value: p.name,
          label: `${p.name} @ ${p.node}`,
          node: p.node,
          kind: "inference-driver",
        });
      }
      setTabs(next);
      setLoadError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      setLoadError(describeError(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const current = useMemo(() => tabs.find((t) => t.value === tab) ?? null, [tabs, tab]);

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
  async function removeDriver(t: Tab) {
    if (t.kind !== "inference-driver") return;
    const confirmed = window.confirm(
      `Remove the driver "${t.value}"${t.node ? ` from ${t.node}` : ""}?\n\n` +
        "Its process is stopped and the gateway stops routing to it. Whatever it fronts " +
        "(an Ollama, a cloud CLI, an engine you run yourself) is untouched -- only this " +
        "install's knowledge of it goes.",
    );
    if (!confirmed) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await api.delete<void>(
        targetFor(t.node, localNode),
        `/v1/components/${encodeURIComponent(t.value)}`,
      );
      setTab("agent");
      await load();
    } catch (e) {
      setRemoveError(describeError(e));
    } finally {
      setRemoving(false);
    }
  }

  const elsewhere = current && current.node !== null && current.node !== localNode;

  return (
    <main className="flex h-screen flex-col">
      <AppHeader href="/config">
        {/* A tab strip within one screen, not navigation between screens
            — hence its own label, so a screen reader can tell it from
            the main navigation above it. */}
        <nav className="flex flex-wrap gap-1" aria-label="Component settings">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              aria-current={tab === t.value ? "true" : undefined}
              className={`font-ui rounded-[var(--radius)] px-3 py-1 text-xs transition-colors ${
                tab === t.value
                  ? "bg-[color:var(--accent-left)] text-[color:var(--on-accent-left)] hover:brightness-110"
                  : "border border-[color:var(--border)] text-[color:var(--foreground)] hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </AppHeader>
      {loadError && (
        <div className="status-error border-b px-4 py-2 text-xs">
          Component list could not be loaded — {loadError}. Tabs may be missing or stale.
        </div>
      )}
      {removeError && <div className="status-error border-b px-4 py-2 text-xs">{removeError}</div>}

      {/* Which machine these settings are about. Every path in a
          component's config is a path on the host that component runs
          on -- inside its container, if it runs in one -- and on an
          install that spans hosts that is frequently not the machine
          the browser is on. Said once, here, for every component. */}
      {current && current.kind !== "ui" && (multiNode || current.kind === "inference-driver") && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--border)] bg-[color:var(--panel-soft)] px-4 py-2 text-xs text-[color:var(--muted)]">
          <span>
            {current.node ? (
              <>
                Runs on <span className="font-mono">{current.node}</span>
                {elsewhere ? " — not the machine you are browsing from" : " — this machine"}. Paths
                in these settings are paths on that host, inside its container if it runs in one.
              </>
            ) : (
              <>Runs on this machine.</>
            )}
          </span>
          {current.kind === "inference-driver" && (
            <button
              type="button"
              onClick={() => void removeDriver(current)}
              disabled={removing}
              className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-0.5 text-[11px] transition-colors hover:border-[color:var(--status-error,#f85149)] hover:text-[color:var(--status-error,#f85149)] disabled:opacity-30"
              title="Stops the driver's process and forgets its declaration. What it fronts is untouched."
            >
              {removing ? "removing…" : "Remove this driver"}
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {tab === "ui" ? (
          <UIPreferences />
        ) : (
          <ConfigEditor key={tab} target={tab} label={current?.label ?? tab} />
        )}
      </div>
    </main>
  );
}
