"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ApiError, api, describeError } from "@/lib/api";
import { offeredOnThisNode } from "@/lib/engineCompat";
import { describeControlRoot } from "@/lib/controlRoot";
import {
  type NodeDetail,
  type Row,
  type Sources,
  buildRows,
  nodeDetails,
  runtimeOf,
} from "@/lib/inferenceRows";
import {
  describeCompute,
  describeCopying,
  describeLoading,
  describeModelSource,
} from "@/lib/issues";
import { loadKey, recallLoadSeconds, rememberLoadSeconds } from "@/lib/loadMemory";
import { type TargetNode, describeBudget, targetFor, useTargetNode } from "@/lib/nodeBudget";
import { useIssues } from "@/lib/useIssues";
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
 * **The control root line.** Where the gateway's node list came from —
 * its own agent, the `controlUrl` setting, or nowhere — and whether the
 * root answered on the last refresh. Until 2026-09-13 nothing set that
 * field, so a two-machine install came up with its worker enrolled,
 * reachable and invisible to routing while every surface said "fine";
 * and a root sealed after a container restart left this screen empty
 * with nothing saying why. The gateway reports both now, on
 * `RoutingTableView.control_root`, and this is the screen an operator
 * has open when it matters.
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
  copying: "var(--status-warn, #d29922)",
  loading: "var(--status-warn, #d29922)",
  starting: "var(--status-warn, #d29922)",
  exited: "var(--status-warn, #d29922)",
  stopped: "var(--muted)",
  crashed: "var(--status-error, #f85149)",
};

const STATUS_HELP: Record<RuntimeStatus, string> = {
  ready: "Model loaded and serving. The only state the gateway routes to.",
  copying:
    "Copying the model onto this machine's own disk before starting it. Nothing has been started yet; the engine follows when the copy lands.",
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
  // The Issues poll already reads every node's own `/v1/runtimes` and
  // `/v1/node`, which is where `flags`, `lastRestart`, `localPath` and
  // the device list live -- none of them on the control root's union
  // view. Shared rather than fetched again: a second poll would double
  // the traffic to every machine in the install to render two lines.
  const { facts } = useIssues();
  // `now` ticks on this screen's own cadence so elapsed counts up
  // between those slower reads. What it counts from is `lastRestart`, an
  // absolute instant, so a stale read cannot make the number wrong.
  const [now, setNow] = useState(() => Date.now());
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

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), POLL_MS);
    return () => clearInterval(id);
  }, []);

  const rows = useMemo(() => (sources ? buildRows(sources, localName) : []), [sources, localName]);
  const details = useMemo(() => nodeDetails(facts), [facts]);

  /**
   * Watch a load finish, so the next one can be estimated.
   *
   * There is nothing else to learn it from: no engine reports load
   * progress, so the only material for "about two minutes left" is a
   * load this browser already sat through. Recorded on the transition
   * out of loading, from `lastRestart` -- the true start, rather than
   * whenever this screen happened to be opened.
   */
  const wasLoading = useRef(new Map<string, string>());
  useEffect(() => {
    const previous = wasLoading.current;
    const next = new Map<string, string>();
    for (const row of rows) {
      if (!row.runtime || !row.runtimeStatus) continue;
      next.set(row.key, row.runtimeStatus);
      const before = previous.get(row.key);
      const finished =
        (before === "loading" || before === "starting") && row.runtimeStatus === "ready";
      if (!finished) continue;
      const started = runtimeOf(row, details)?.lastRestart;
      if (!started) continue;
      const at = Date.parse(started);
      if (Number.isNaN(at)) continue;
      rememberLoadSeconds(loadKey(row.node, row.model), (Date.now() - at) / 1000);
    }
    wasLoading.current = next;
  }, [rows, details]);
  const controlRoot = useMemo(() => describeControlRoot(sources?.routing?.control_root), [sources]);

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

  /**
   * Forget a backend. A runtime takes its companion driver with it; an
   * external backend's driver is the only thing this install holds
   * about it -- the Ollama, the cloud CLI, the engine someone runs by
   * hand is untouched. `DELETE` has existed on the agent since M0 and
   * nothing in the UI had ever called it; the first operator to try
   * removed an Ollama by killing its process and the supervisor put it
   * back, which is what supervision is for.
   */
  async function remove(row: Row) {
    const what = row.runtime
      ? `the runtime "${row.runtime}"${row.driver ? ` and its driver "${row.driver}"` : ""}`
      : `the driver "${row.driver}"`;
    const confirmed = window.confirm(
      `Remove ${what}${row.node ? ` from ${row.node}` : ""}?

` +
        (row.runtime
          ? "The engine process is stopped and the model is no longer served. The model files stay where they are."
          : "The gateway stops routing to it. Whatever it fronts is untouched -- only this install's knowledge of it goes."),
    );
    if (!confirmed) return;
    const key = `${row.node ?? ""}/${row.runtime ?? row.driver ?? ""}:remove`;
    setBusy(key);
    setActionError(null);
    try {
      const target = targetFor(row.node, localName);
      if (row.runtime) {
        await api.delete<void>(target, `/v1/runtimes/${encodeURIComponent(row.runtime)}`);
      } else if (row.driver) {
        await api.delete<void>(target, `/v1/components/${encodeURIComponent(row.driver)}`);
      }
      await load();
    } catch (err) {
      setActionError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

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
    <AppShell
      controls={
        <>
          <span className="font-ui text-sm text-[color:var(--muted)]">
            {rows.length === 0
              ? "nothing serving"
              : `${rows.length} backend${rows.length === 1 ? "" : "s"} across ${nodeOrder.length} node${nodeOrder.length === 1 ? "" : "s"}`}
          </span>
          {/* These two stay here and are not replaced by the navigation's
            Library and Config links. They are actions on this screen —
            each carries a sentence saying what it does to the install —
            where the nav says only where a screen lives. */}
          <Link
            href="/library"
            className={buttonClass}
            title="Pick a model you own, choose the node, and launch it. The agent there declares a companion driver and the gateway starts routing when the engine is ready."
          >
            Launch a model
          </Link>
          <Link
            href="/backends/add"
            className={buttonClass}
            title="Something you already run — Ollama, LM Studio, an OpenAI-compatible server, a cloud CLI — joins the install so the gateway can send requests to it. A short form asks which app it is and what it needs."
          >
            Add an external backend
          </Link>
        </>
      }
    >
      <main className="flex min-h-0 flex-1 flex-col">
        {controlRoot && (
          <div
            className={
              controlRoot.tone === "warn"
                ? "status-warn border-b px-4 py-2 text-sm"
                : "border-b border-[color:var(--border)] px-4 py-1.5 text-[0.6875rem] text-[color:var(--muted)]"
            }
            title={controlRoot.detail ?? undefined}
            data-testid="control-root"
          >
            {controlRoot.text}
          </div>
        )}
        {gaps.length > 0 && (
          <div className="status-warn border-b px-4 py-2 text-sm">
            <span className="font-semibold">Partial view.</span>{" "}
            {gaps.map((g, i) => (
              <span key={g}>
                {i > 0 ? " · " : ""}
                {g}
              </span>
            ))}
          </div>
        )}
        {actionError && (
          <div className="status-error border-b px-4 py-2 text-sm">{actionError}</div>
        )}

        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          {sources === null ? (
            <p className="text-sm text-[color:var(--muted)]">Loading…</p>
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
              detail={details.get(name) ?? null}
              now={now}
              busy={busy}
              onAct={act}
              onRemove={remove}
            />
          ))}
        </div>
      </main>
    </AppShell>
  );
}

function EmptyState() {
  return (
    <div className="max-w-2xl space-y-3 text-sm text-[color:var(--muted)]">
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
  detail,
  now,
  busy,
  onAct,
  onRemove,
}: {
  name: string | null;
  node: TargetNode | null;
  localName: string | null;
  rows: Row[];
  /** This node's own view of its runtimes and devices, from the Issues
   * poll; null while it has not answered. */
  detail: NodeDetail | null;
  now: number;
  busy: string | null;
  onAct: (node: string | null, runtime: string, action: "start" | "stop" | "restart") => void;
  onRemove: (row: Row) => void;
}) {
  const label = name ?? node?.label ?? "this host";
  // The node's engines, lifted here from the engines line so a stopped
  // runtime's row can say the reason it cannot start (S3: Skip leaves a
  // runtime declared with no engine to run it, and the reason is here).
  const [engines, setEngines] = useState<EngineDescriptor[] | null>(null);
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-mono text-xs tracking-wider text-[color:var(--muted)] uppercase">
          {label}
          {node?.local ? " · here" : ""}
        </h2>
        {node && !node.reachable && (
          <span
            className="text-sm"
            style={{ color: "var(--status-error, #f85149)" }}
            title={node.lastError ?? undefined}
          >
            down{node.lastError ? ` — ${node.lastError}` : ""}
          </span>
        )}
        {node && (
          <span className="text-sm text-[color:var(--muted)]">{describeBudget(node.budget)}</span>
        )}
      </div>
      <EnginesLine
        target={targetFor(name, localName)}
        reachable={node?.reachable ?? true}
        onEngines={setEngines}
      />
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-[color:var(--muted)]">Nothing serving on this node.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-sm">
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
                <RowView
                  key={row.key}
                  row={row}
                  engines={engines}
                  detail={detail}
                  now={now}
                  busy={busy}
                  onAct={onAct}
                  onRemove={onRemove}
                />
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
  engines,
  detail,
  now,
  busy,
  onAct,
  onRemove,
}: {
  row: Row;
  /** The node's engines, or null while unknown. */
  engines: EngineDescriptor[] | null;
  /** That node's own view of its runtimes and devices, or null while it
   * has not answered. Null is "we do not know", which both states below
   * treat as a reason to say nothing rather than to guess. */
  detail: NodeDetail | null;
  /** This screen's clock, so elapsed counts up between the slower
   * per-node reads. */
  now: number;
  busy: string | null;
  onAct: (node: string | null, runtime: string, action: "start" | "stop" | "restart") => void;
  onRemove: (row: Row) => void;
}) {
  const status = row.runtimeStatus as RuntimeStatus | null;
  const known = status !== null && status in STATUS_TONE;
  // S7's two honest states. Both are built from what is actually known
  // and say which: nothing reports where a model's weights went, and
  // nothing counts a model load, so neither line is ever a guess
  // dressed as a measurement.
  const own = row.runtime ? (detail?.runtimes.get(row.runtime) ?? null) : null;
  const compute = describeCompute(
    { engine: own?.engine ?? row.engine, flags: own?.flags ?? null },
    // `?? null` and never `?? []`: a node that answered its runtimes but
    // not its identity has `devices: null`, and turning that into an
    // empty list would print "on the processor" on every row of a
    // machine that is merely slow to reply.
    detail?.devices ?? null,
  );
  // A copy runs before any process exists, so it is its own line rather
  // than a variant of the load: `describeLoading` has nothing to read
  // here, and a copy always has bytes where a mapped load has none.
  const copying = describeCopying({
    status: row.runtimeStatus,
    copyProgress: own?.copyProgress ?? null,
  });
  const source = describeModelSource({
    localPathSource: own?.localPathSource ?? null,
    localPath: own?.localPath ?? null,
    localPathNote: own?.localPathNote ?? null,
  });
  const loading = describeLoading(
    {
      // The status comes from this screen's own fast poll, not from the
      // slower per-node read, so a model that has finished loading stops
      // saying so at this screen's cadence rather than the Issues one.
      status: row.runtimeStatus,
      lastRestart: own?.lastRestart ?? null,
      localPath: own?.localPath ?? null,
      // Sampled by the agent from the engine's own read counter, and
      // absent whenever the bytes cannot be seen moving -- a mapped load
      // is the ordinary case for that. Absent means "show elapsed", NOT
      // "zero bytes read", which is why nothing here defaults it.
      loadProgress: own?.loadProgress ?? null,
    },
    now,
    recallLoadSeconds(loadKey(row.node, row.model)),
  );
  const prefix = `${row.node ?? ""}/${row.runtime ?? ""}:`;
  const missingEngine = stoppedForWantOfEngine(row, engines);
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
          <div className="text-[0.6875rem] text-[color:var(--muted)]">
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
        {missingEngine && (
          <div className="text-[0.6875rem]" data-testid="stopped-reason">
            {engineWord(missingEngine)} is not installed on this machine, so this cannot start.
            Install it above, then press start.
          </div>
        )}
        {copying && (
          <div className="text-[0.6875rem] text-[color:var(--muted)]" data-testid="copying-detail">
            {copying.percent !== null && (
              <div
                className="mb-1 h-1 w-40 overflow-hidden rounded-full bg-[color:var(--border)]"
                role="progressbar"
                aria-valuenow={Math.round(copying.percent * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Copying the model to this machine"
                data-testid="copying-bar"
              >
                <div
                  className="h-full bg-[color:var(--accent-left)] transition-[width] duration-500"
                  style={{ width: `${Math.round(copying.percent * 100)}%` }}
                />
              </div>
            )}
            {copying.text}
          </div>
        )}
        {loading && (
          <div className="text-[0.6875rem] text-[color:var(--muted)]" data-testid="loading-detail">
            {/* The bar renders only when the agent could actually watch
                the bytes move. A track drawn with no fill would read as
                "0%, stuck", which is the conclusion this whole line
                exists to prevent. */}
            {loading.percent !== null && (
              <div
                className="mb-1 h-1 w-40 overflow-hidden rounded-full bg-[color:var(--border)]"
                role="progressbar"
                aria-valuenow={Math.round(loading.percent * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Reading the model"
                data-testid="loading-bar"
              >
                <div
                  className="h-full bg-[color:var(--accent-left)] transition-[width] duration-500"
                  style={{ width: `${Math.round(loading.percent * 100)}%` }}
                />
              </div>
            )}
            {loading.text}
          </div>
        )}
        {source && (
          <div className="text-[0.6875rem] text-[color:var(--muted)]" data-testid="model-source">
            {source.text}
            {/* The skipped-copy reason, which is the one thing here
                nobody would otherwise find out: the model still serves,
                and the only symptom is a start minutes slower than the
                operator asked for. */}
            {source.note && (
              <div className="text-status-warn" data-testid="model-source-note">
                {source.note}
              </div>
            )}
          </div>
        )}
        {compute && (
          <div
            className={`text-[0.6875rem] ${compute.tone === "warn" ? "text-status-warn" : "text-[color:var(--muted)]"}`}
            data-testid="compute-detail"
            title={compute.detail}
          >
            {compute.text}
          </div>
        )}
        {row.eligible === false && row.ineligibleReason && (
          <div className="text-[0.6875rem] text-[color:var(--muted)]">
            not routable: {row.ineligibleReason}
          </div>
        )}
        {row.error && row.reachable !== false && (
          <div className="text-[0.6875rem]" style={{ color: "var(--status-error, #f85149)" }}>
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
            <button
              type="button"
              onClick={() => onRemove(row)}
              disabled={busy !== null}
              className={`${dangerButton} ml-1`}
              title="Stops the engine and forgets the runtime and its driver. The model files stay."
            >
              {busy === `${prefix}remove` ? "…" : "remove"}
            </button>
          </>
        ) : (
          <>
            <Link
              href="/config"
              className={smallButton}
              title="An external backend is not ours to start or stop. Its driver's settings — the URL, the model id, the API key — are on the Config page."
            >
              config
            </Link>
            {row.driver && (
              <button
                type="button"
                onClick={() => onRemove(row)}
                disabled={busy !== null}
                className={`${dangerButton} ml-1`}
                title="Forgets this driver and stops its process. The backend it fronts is untouched."
              >
                {busy === `${row.node ?? ""}/${row.driver}:remove` ? "…" : "remove"}
              </button>
            )}
          </>
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
function EnginesLine({
  target,
  reachable,
  onEngines,
}: {
  target: string;
  reachable: boolean;
  /** The node's engines as last read, for the rows above this line. */
  onEngines?: (engines: EngineDescriptor[]) => void;
}) {
  const [engines, setEngines] = useState<EngineDescriptor[] | null>(null);
  const [installs, setInstalls] = useState<Record<string, EngineInstall | null>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.get<EngineList>(target, "/v1/engines");
      setEngines(list.engines ?? []);
      onEngines?.(list.engines ?? []);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setError(describeError(err));
    }
  }, [target, onEngines]);

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
    return <p className="text-[0.6875rem] text-[color:var(--muted)]">engines: {error}</p>;
  }
  if (engines === null) return null;

  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-[color:var(--muted)]">
      <span>engines:</span>
      {engines.filter(offeredOnThisNode).map((e) => {
        const state = installs[e.engine];
        const busyInstall = state != null && inFlight(state.state);
        const reason = e.acquisition?.reason;
        return (
          <span key={e.engine} className="inline-flex items-center gap-1.5">
            <span className="font-mono">{e.engine}</span>
            {e.experimental && (
              <span
                className="rounded-[var(--radius)] border border-[color:var(--border)] px-1 text-[0.5625rem] tracking-wide uppercase"
                title={
                  "This engine integration has not been proved on physical hardware yet. " +
                  "It works against tested fixtures; real-machine results are what turns " +
                  "this badge off. " +
                  (e.acquisition?.manualInstall?.notes ?? "")
                }
              >
                experimental
              </span>
            )}
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

/**
 * A runtime that is stopped and whose engine the node does not have: the
 * state Skip leaves (S3), and the one state in which "press start" is
 * not the advice. Null otherwise, including while the engines are unknown.
 */
function stoppedForWantOfEngine(row: Row, engines: EngineDescriptor[] | null): string | null {
  if (!row.runtime || !row.engine || engines === null) return null;
  if (row.runtimeStatus !== "stopped" && row.runtimeStatus !== "crashed") return null;
  const descriptor = engines.find((e) => e.engine === row.engine);
  if (!descriptor || descriptor.available) return null;
  return row.engine;
}

function engineWord(engine: string): string {
  if (engine === "llama_cpp") return "llama.cpp";
  if (engine === "vllm") return "vLLM";
  if (engine === "mlx") return "MLX";
  if (engine === "kev") return "Kev";
  return engine;
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
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]";
const smallButton =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-0.5 text-[0.6875rem] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";
const dangerButton =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-0.5 text-[0.6875rem] transition-colors hover:border-[color:var(--status-error,#f85149)] hover:text-[color:var(--status-error,#f85149)] disabled:cursor-not-allowed disabled:opacity-30";
const tinyButton =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-1.5 py-0 text-[0.625rem] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]";
