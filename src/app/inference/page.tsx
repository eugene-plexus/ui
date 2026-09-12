"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, api, describeError } from "@/lib/api";
import { type Row, type Sources, buildRows } from "@/lib/inferenceRows";
import { type TargetNode, describeBudget, targetFor, useTargetNode } from "@/lib/nodeBudget";
import type {
  ComponentPlacementList,
  DriversInfo,
  EngineDescriptor,
  EngineInstall,
  EngineList,
  RoutingTableView,
  RuntimeList,
  RuntimePlacementList,
  RuntimeStatus,
} from "@/lib/types";

/**
 * Inference — everything the gateway can route to, wherever it runs and
 * whoever runs it.
 *
 * This replaced the Runtimes page on 2026-09-12, on the operator's
 * report from the first two-machine install. "Runtime" is this project's
 * word for an engine process it supervises. The operator's question is
 * *what is serving*, and that set includes backends nobody here
 * supervises — an Ollama on the worker, a cloud CLI — and runtimes on
 * other nodes, none of which the old page could show: it read the local
 * agent alone, so on a worker it said no engines were installed and no
 * runtimes existed, while the only model in the install was being served
 * from that very machine through a driver the page had no row for.
 *
 * The gateway never made that distinction. It routes to *drivers*, and a
 * driver fronting Ollama is as routable as a companion driver fronting a
 * llama.cpp process. Only the UI had a category for one and not the
 * other. So this screen's rows are the gateway's drivers, joined to the
 * install's runtimes where a driver follows one, grouped by the node the
 * control root places each on.
 *
 * **Four sources, every one of them soft.** The gateway's drivers and
 * routing views, the control root's placement of components and its
 * union of runtimes. A sealed root, a gateway in safe mode or an
 * unreachable node each remove a column's worth of information and are
 * named at the top, rather than taking the screen down: the page an
 * operator opens when something is wrong must not be the page that
 * fails because something is wrong.
 *
 * **Acting on a runtime on another node** goes through that node's
 * agent — the `node:<name>` proxy target — because start, stop and
 * restart are per-agent by nature and the control root forwards only
 * declarations, by design. The operator's own token is accepted at every
 * agent in the install, which is what makes this a console rather than
 * a privilege.
 */

const POLL_MS = 3000;
const INSTALL_POLL_MS = 1000;

const STATUS_TONE: Record<RuntimeStatus, string> = {
  ready: "var(--status-ok, #3fb950)",
  loading: "var(--status-warn, #d29922)",
  starting: "var(--status-warn, #d29922)",
  exited: "var(--status-warn, #d29922)",
  stopped: "var(--muted)",
  crashed: "var(--status-error, #f85149)",
};

const STATUS_HELP: Record<RuntimeStatus, string> = {
  ready: "Model loaded and serving. The only state the gateway routes to.",
  loading: "Answering, but still reading the model into memory.",
  starting: "Spawned, not yet answering its readiness probe.",
  stopped:
    "Not running and not being respawned: stopped by the operator, unloaded by the gateway after its idle timeout, or declared with autoStart off. The stop reason says which.",
  exited: "Exited cleanly; the agent is respawning it.",
  crashed: "Exited non-zero repeatedly. The agent gave up — see the error.",
};

const BACKEND_LABEL: Record<string, string> = {
  openai_compat_http: "OpenAI-compatible endpoint",
  claude_code_cli: "Claude Code CLI",
  codex_cli: "Codex CLI",
};

export default function InferencePage() {
  const picker = useTargetNode();
  const localName = picker.nodes.find((n) => n.local)?.name ?? null;

  const [sources, setSources] = useState<Sources | null>(null);
  const [gaps, setGaps] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const missing: string[] = [];
    const soft =
      <T,>(what: string) =>
      (err: unknown): T | null => {
        if (err instanceof ApiError && err.status === 401) throw err;
        missing.push(`${what}: ${describeError(err)}`);
        return null;
      };
    try {
      const [drivers, routing, placement, runtimes] = await Promise.all([
        api.get<DriversInfo>("gateway", "/v1/admin/drivers").catch(soft<DriversInfo>("gateway")),
        api
          .get<RoutingTableView>("gateway", "/v1/admin/routing")
          .catch(soft<RoutingTableView>("routing table")),
        api
          .get<ComponentPlacementList>("control", "/v1/components")
          .catch(soft<ComponentPlacementList>("control root")),
        api
          .get<RuntimePlacementList>("control", "/v1/runtimes")
          .catch(soft<RuntimePlacementList>("control root runtimes")),
      ]);
      // Without a control root the local agent is the only place
      // runtimes can be read from, and it is read.
      const localRuntimes =
        runtimes === null
          ? await api.get<RuntimeList>("agent", "/v1/runtimes").catch(soft<RuntimeList>("agent"))
          : null;
      setSources({ drivers, routing, placement, runtimes, localRuntimes });
      setGaps(dedupe(missing));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setGaps([describeError(err)]);
    }
  }, []);

  // Poll rather than subscribe: a runtime's status changes on the agent's
  // own readiness cadence, so there is nothing for a push channel to
  // deliver sooner, and a dashboard that reconnects a socket is one that
  // can silently stop updating.
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const rows = useMemo(() => (sources ? buildRows(sources, localName) : []), [sources, localName]);

  const byNode = useMemo(() => {
    const groups = new Map<string | null, Row[]>();
    for (const row of rows) {
      const list = groups.get(row.node) ?? [];
      list.push(row);
      groups.set(row.node, list);
    }
    return groups;
  }, [rows]);

  // Every node the install knows of, local first, then any node a row
  // named that the picker did not (a control root that answered
  // /v1/components but whose /v1/nodes read failed).
  const nodeOrder = useMemo(() => {
    const names: (string | null)[] = picker.nodes.map((n) => n.name);
    for (const name of byNode.keys()) if (!names.includes(name)) names.push(name);
    return names;
  }, [picker.nodes, byNode]);

  async function act(node: string | null, runtime: string, action: "start" | "stop" | "restart") {
    const key = `${node ?? ""}/${runtime}:${action}`;
    setBusy(key);
    setActionError(null);
    try {
      await api.post(
        targetFor(node, localName),
        `/v1/runtimes/${encodeURIComponent(runtime)}/${action}`,
        {},
      );
      await load();
    } catch (err) {
      setActionError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="font-ui text-xs text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
          >
            ← Back to playground
          </Link>
          <h1 className="font-ui text-sm font-semibold tracking-wide">Inference</h1>
          <span className="font-ui text-xs text-[color:var(--muted)]">
            {rows.length === 0
              ? "nothing serving"
              : `${rows.length} backend${rows.length === 1 ? "" : "s"} across ${nodeOrder.length} node${nodeOrder.length === 1 ? "" : "s"}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/library"
            className={buttonClass}
            title="Pick a model you own, choose the node, and launch it. The agent there declares a companion driver and the gateway starts routing when the engine is ready."
          >
            Launch a model
          </Link>
          <Link
            href="/config"
            className={buttonClass}
            title="Something you already run — an Ollama, an OpenAI-compatible server, a cloud CLI — joins the install as an inference-driver pointed at it. Today that is declared on the Config page; a guided form is on the list."
          >
            Add an external backend
          </Link>
          <Link href="/nodes" className={buttonClass}>
            Nodes
          </Link>
        </div>
      </header>

      {gaps.length > 0 && (
        <div className="status-warn border-b px-4 py-2 text-xs">
          <span className="font-semibold">Partial view.</span>{" "}
          {gaps.map((g, i) => (
            <span key={g}>
              {i > 0 ? " · " : ""}
              {g}
            </span>
          ))}
        </div>
      )}
      {actionError && <div className="status-error border-b px-4 py-2 text-xs">{actionError}</div>}

      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        {sources === null ? (
          <p className="text-xs text-[color:var(--muted)]">Loading…</p>
        ) : rows.length === 0 && picker.loaded ? (
          <EmptyState />
        ) : null}

        {nodeOrder.map((name) => (
          <NodeSection
            key={name ?? "__local"}
            name={name}
            node={picker.nodes.find((n) => n.name === name) ?? null}
            localName={localName}
            rows={byNode.get(name) ?? []}
            busy={busy}
            onAct={act}
          />
        ))}
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="max-w-2xl space-y-3 text-xs text-[color:var(--muted)]">
      <p className="font-ui text-sm font-semibold text-[color:var(--foreground)]">
        Nothing is serving yet.
      </p>
      <p>
        Two ways in. <strong>Launch a model</strong> you own from the Library — pick the node, and
        the agent there runs the engine, declares a driver for it, and the gateway routes to it once
        it is ready. Or <strong>add an external backend</strong>: something you already run, such as
        an Ollama, an OpenAI-compatible server or a cloud CLI, joins as an inference-driver pointed
        at it, on the Config page.
      </p>
      <p>Either way it appears here, on the node it runs on, with the same controls.</p>
    </div>
  );
}

function NodeSection({
  name,
  node,
  localName,
  rows,
  busy,
  onAct,
}: {
  name: string | null;
  node: TargetNode | null;
  localName: string | null;
  rows: Row[];
  busy: string | null;
  onAct: (node: string | null, runtime: string, action: "start" | "stop" | "restart") => void;
}) {
  const label = name ?? node?.label ?? "this host";
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-mono text-xs tracking-wider text-[color:var(--muted)] uppercase">
          {label}
          {node?.local ? " · here" : ""}
        </h2>
        {node && !node.reachable && (
          <span className="text-xs" style={{ color: "var(--status-error, #f85149)" }}>
            down
          </span>
        )}
        {node && (
          <span className="text-xs text-[color:var(--muted)]">{describeBudget(node.budget)}</span>
        )}
      </div>
      <EnginesLine target={targetFor(name, localName)} reachable={node?.reachable ?? true} />
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-[color:var(--muted)]">Nothing serving on this node.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="font-ui text-[color:var(--muted)]">
              <tr>
                <th className="py-1.5 pr-4">Model</th>
                <th className="py-1.5 pr-4">Served by</th>
                <th className="py-1.5 pr-4">State</th>
                <th className="py-1.5 pr-4">Traffic</th>
                <th className="py-1.5 pr-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <RowView key={row.key} row={row} busy={busy} onAct={onAct} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RowView({
  row,
  busy,
  onAct,
}: {
  row: Row;
  busy: string | null;
  onAct: (node: string | null, runtime: string, action: "start" | "stop" | "restart") => void;
}) {
  const status = row.runtimeStatus as RuntimeStatus | null;
  const known = status !== null && status in STATUS_TONE;
  const prefix = `${row.node ?? ""}/${row.runtime ?? ""}:`;
  return (
    <tr className="border-t border-[color:var(--border)]">
      <td className="py-1.5 pr-4 font-mono">
        {row.model ?? <span className="text-[color:var(--muted)]">no model reported</span>}
      </td>
      <td className="py-1.5 pr-4">
        {row.runtime ? (
          <>
            <span className="font-mono">{row.engine ?? "engine"}</span> runtime{" "}
            <span className="font-mono">{row.runtime}</span>
            <span className="text-[color:var(--muted)]"> · we supervise it</span>
          </>
        ) : (
          <>
            {row.backend ? (BACKEND_LABEL[row.backend] ?? row.backend) : "external backend"}
            {row.url && <span className="ml-1 font-mono text-[color:var(--muted)]">{row.url}</span>}
            <span className="text-[color:var(--muted)]"> · runs on its own</span>
          </>
        )}
        {row.driver && (
          <div className="text-[11px] text-[color:var(--muted)]">
            driver <span className="font-mono">{row.driver}</span>
          </div>
        )}
      </td>
      <td className="py-1.5 pr-4">
        {row.runtime && status ? (
          <span
            style={{ color: known ? STATUS_TONE[status as RuntimeStatus] : undefined }}
            title={known ? STATUS_HELP[status as RuntimeStatus] : undefined}
          >
            {status}
            {row.stopReason && (
              <span className="ml-1 text-[color:var(--muted)]">({row.stopReason})</span>
            )}
          </span>
        ) : row.reachable === null ? (
          <span
            className="text-[color:var(--muted)]"
            title="The gateway did not report on this driver."
          >
            unknown to gateway
          </span>
        ) : row.reachable ? (
          <span style={{ color: "var(--status-ok, #3fb950)" }}>reachable</span>
        ) : (
          <span style={{ color: "var(--status-error, #f85149)" }} title={row.error ?? undefined}>
            unreachable
          </span>
        )}
        {row.eligible === false && row.ineligibleReason && (
          <div className="text-[11px] text-[color:var(--muted)]">
            not routable: {row.ineligibleReason}
          </div>
        )}
        {row.error && row.reachable !== false && (
          <div className="text-[11px]" style={{ color: "var(--status-error, #f85149)" }}>
            {row.error}
          </div>
        )}
      </td>
      <td className="py-1.5 pr-4 text-[color:var(--muted)]">
        {row.inFlight !== null ? `${row.inFlight} in flight` : "—"}
        {row.idleSeconds !== null && row.inFlight === 0 && (
          <span className="ml-1">· idle {Math.round(row.idleSeconds)}s</span>
        )}
      </td>
      <td className="py-1.5 pr-4 text-right whitespace-nowrap">
        {row.runtime ? (
          <>
            <button
              type="button"
              onClick={() => onAct(row.node, row.runtime as string, "start")}
              disabled={busy !== null || status === "ready" || status === "loading"}
              className={smallButton}
            >
              {busy === `${prefix}start` ? "…" : "start"}
            </button>
            <button
              type="button"
              onClick={() => onAct(row.node, row.runtime as string, "stop")}
              disabled={busy !== null || status === "stopped"}
              className={`${smallButton} ml-1`}
            >
              {busy === `${prefix}stop` ? "…" : "stop"}
            </button>
            <button
              type="button"
              onClick={() => onAct(row.node, row.runtime as string, "restart")}
              disabled={busy !== null}
              className={`${smallButton} ml-1`}
            >
              {busy === `${prefix}restart` ? "…" : "restart"}
            </button>
          </>
        ) : (
          <Link
            href="/config"
            className={smallButton}
            title="An external backend is not ours to start or stop. Its driver's settings — the URL, the model id, the API key — are on the Config page."
          >
            config
          </Link>
        )}
      </td>
    </tr>
  );
}

/**
 * Which engines a node has, and the offer to fetch one.
 *
 * Kept from the Runtimes page, per node now. Every "why won't my model
 * start" question begins with whether a binary was found at all. An
 * install is offered, never applied; and a host with no installable
 * build says so and why (Linux with NVIDIA is a permanent answer, not a
 * transient failure).
 */
function EnginesLine({ target, reachable }: { target: string; reachable: boolean }) {
  const [engines, setEngines] = useState<EngineDescriptor[] | null>(null);
  const [installs, setInstalls] = useState<Record<string, EngineInstall | null>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.get<EngineList>(target, "/v1/engines");
      setEngines(list.engines ?? []);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setError(describeError(err));
    }
  }, [target]);

  useEffect(() => {
    if (!reachable) return;
    void load();
  }, [load, reachable]);

  const installing = Object.values(installs).some((i) => i != null && inFlight(i.state));

  useEffect(() => {
    if (!installing) return;
    const id = setInterval(() => {
      for (const engine of Object.keys(installs)) {
        void api
          .get<EngineInstall>(target, `/v1/engines/${encodeURIComponent(engine)}/install`)
          .then((state) => setInstalls((prev) => ({ ...prev, [engine]: state })))
          .catch(() => undefined);
      }
      void load();
    }, INSTALL_POLL_MS);
    return () => clearInterval(id);
    // Engine NAMES, not the installs object, which every poll rewrites.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installing, Object.keys(installs).sort().join(","), load, target]);

  async function install(engine: string) {
    try {
      const started = await api.post<EngineInstall>(
        target,
        `/v1/engines/${encodeURIComponent(engine)}/install`,
        {},
      );
      setInstalls((prev) => ({ ...prev, [engine]: started }));
    } catch (err) {
      // 422 is the honest "nothing installable for this host" answer,
      // already rendered from the descriptor.
      if (err instanceof ApiError && err.status === 422) return;
      setError(describeError(err));
    }
  }

  if (!reachable) return null;
  if (error) {
    return <p className="text-[11px] text-[color:var(--muted)]">engines: {error}</p>;
  }
  if (engines === null) return null;

  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[color:var(--muted)]">
      <span>engines:</span>
      {engines.map((e) => {
        const state = installs[e.engine];
        const busyInstall = state != null && inFlight(state.state);
        const reason = e.acquisition?.reason;
        return (
          <span key={e.engine} className="inline-flex items-center gap-1.5">
            <span className="font-mono">{e.engine}</span>
            <span
              style={{
                color: e.available ? "var(--status-ok, #3fb950)" : "var(--status-error, #f85149)",
              }}
            >
              {e.available ? `build ${e.version ?? "?"}` : "not installed"}
            </span>
            {busyInstall ? (
              <span>{state.state}…</span>
            ) : e.acquisition?.installable ? (
              <button type="button" onClick={() => void install(e.engine)} className={tinyButton}>
                {e.managed ? "update" : "install"}
              </button>
            ) : !e.available && reason ? (
              <span title={reason}>(not installable here)</span>
            ) : null}
          </span>
        );
      })}
    </p>
  );
}

function inFlight(state: string | undefined): boolean {
  return (
    state === "resolving" ||
    state === "downloading" ||
    state === "verifying" ||
    state === "extracting"
  );
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items));
}

const buttonClass =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]";
const smallButton =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-0.5 text-[11px] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";
const tinyButton =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-1.5 py-0 text-[10px] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]";
