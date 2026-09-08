"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ApiError, api } from "@/lib/api";
import type {
  EngineDescriptor,
  EngineList,
  Runtime,
  RuntimeList,
  RuntimeStatus,
} from "@/lib/types";

/**
 * Runtime dashboard — what engine processes exist, what state they're in,
 * and what the host can actually run.
 *
 * Two reads, both on the watchdog:
 *   GET /v1/engines  → which adapters have a usable binary here
 *   GET /v1/runtimes → the declared engine processes and their live state
 *
 * The engines panel is not decoration. Every "why won't my model start"
 * question begins with whether a binary was found at all, and until
 * engine acquisition lands (M1) that is a manual step the operator has
 * to have completed. Showing the resolved path and version answers it in
 * one glance.
 */

const POLL_MS = 3000;

// Status → CSS custom-property colour. `loading` deliberately reads as
// in-progress rather than as an error: a large quant off a slow disk can
// sit there for minutes and it is not a fault.
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
  stopped: "Deliberately stopped, or declared with autoStart off.",
  exited: "Exited cleanly; the watchdog is respawning it.",
  crashed: "Exited non-zero repeatedly. The watchdog gave up — see the error.",
};

export default function RuntimesPage() {
  const [runtimes, setRuntimes] = useState<Runtime[] | null>(null);
  const [engines, setEngines] = useState<EngineDescriptor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, e] = await Promise.all([
        api.get<RuntimeList>("watchdog", "/v1/runtimes"),
        api.get<EngineList>("watchdog", "/v1/engines"),
      ]);
      setRuntimes(r.runtimes ?? []);
      setEngines(e.engines ?? []);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Poll rather than subscribe. A runtime's status changes on the
  // watchdog's own readiness-probe cadence (2s), so there is nothing for
  // a push channel to deliver sooner, and a dashboard that reconnects a
  // socket is a dashboard that can silently stop updating.
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  async function act(name: string, action: "start" | "stop" | "restart") {
    setBusy(`${name}:${action}`);
    try {
      await api.post("watchdog", `/v1/runtimes/${encodeURIComponent(name)}/${action}`, {});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="font-ui text-xs text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
          >
            ← Back to playground
          </Link>
          <h1 className="font-ui text-sm font-semibold tracking-wide">Runtimes</h1>
        </div>
        <Link
          href="/config"
          className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
        >
          Config
        </Link>
      </header>

      {error && <div className="status-error border-b px-4 py-2 text-xs">{error}</div>}

      <div className="flex-1 overflow-y-auto p-4">
        <EnginesPanel engines={engines} />
        <RuntimesPanel runtimes={runtimes} busy={busy} onAct={act} />
      </div>
    </main>
  );
}

function EnginesPanel({ engines }: { engines: EngineDescriptor[] | null }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 font-mono text-xs tracking-wider text-[color:var(--muted)] uppercase">
        engines on this host
      </h2>
      {engines === null ? (
        <p className="text-xs text-[color:var(--muted)]">Loading…</p>
      ) : engines.length === 0 ? (
        <p className="text-xs text-[color:var(--muted)]">No engine adapters registered.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {engines.map((e) => (
            <div
              key={e.engine}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-xs"
            >
              <span className="font-mono font-medium">{e.engine}</span>
              <span
                style={{
                  color: e.available ? "var(--status-ok, #3fb950)" : "var(--status-error, #f85149)",
                }}
              >
                {e.available ? "available" : "not found"}
              </span>
              {e.version && <span className="text-[color:var(--muted)]">v{e.version}</span>}
              {e.origin && <span className="text-[color:var(--muted)]">via {e.origin}</span>}
              {e.binaryPath && (
                <span className="truncate font-mono text-[color:var(--muted)]" title={e.binaryPath}>
                  {e.binaryPath}
                </span>
              )}
              {e.error && <span className="status-error px-1">{e.error}</span>}
            </div>
          ))}
        </div>
      )}
      {engines?.some((e) => !e.available) && (
        <p className="mt-2 text-xs text-[color:var(--muted)]">
          An engine binary has to be on PATH or set explicitly on the runtime until managed engine
          acquisition lands.
        </p>
      )}
    </section>
  );
}

function RuntimesPanel({
  runtimes,
  busy,
  onAct,
}: {
  runtimes: Runtime[] | null;
  busy: string | null;
  onAct: (name: string, action: "start" | "stop" | "restart") => void;
}) {
  return (
    <section>
      <h2 className="mb-2 font-mono text-xs tracking-wider text-[color:var(--muted)] uppercase">
        runtimes
      </h2>
      {runtimes === null ? (
        <p className="text-xs text-[color:var(--muted)]">Loading…</p>
      ) : runtimes.length === 0 ? (
        <p className="text-xs text-[color:var(--muted)]">
          No engine runtimes declared. Add one with the watchdog&apos;s{" "}
          <code className="font-mono">POST /v1/runtimes</code>.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {runtimes.map((r) => (
            <RuntimeCard key={r.name} runtime={r} busy={busy} onAct={onAct} />
          ))}
        </div>
      )}
    </section>
  );
}

function RuntimeCard({
  runtime: r,
  busy,
  onAct,
}: {
  runtime: Runtime;
  busy: string | null;
  onAct: (name: string, action: "start" | "stop" | "restart") => void;
}) {
  const [showArgv, setShowArgv] = useState(false);
  const running = r.status === "ready" || r.status === "loading" || r.status === "starting";

  return (
    <div className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-ui text-sm font-medium">{r.name}</span>
          <span
            className="font-mono text-xs"
            style={{ color: STATUS_TONE[r.status] }}
            title={STATUS_HELP[r.status]}
          >
            {r.status}
          </span>
          <span className="font-mono text-xs text-[color:var(--muted)]">{r.engine}</span>
          {r.modelAlias && (
            <span className="font-mono text-xs text-[color:var(--muted)]">
              serves {r.modelAlias}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {(["start", "stop", "restart"] as const).map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => onAct(r.name, action)}
              disabled={busy !== null || (action === "start" && running)}
              className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30"
            >
              {busy === `${r.name}:${action}` ? "…" : action}
            </button>
          ))}
        </div>
      </div>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <Row label="model">
          <span className="font-mono break-all">{r.modelPath}</span>
        </Row>
        {r.url && (
          <Row label="url">
            <span className="font-mono">{r.url}</span>
          </Row>
        )}
        {r.pid != null && <Row label="pid">{r.pid}</Row>}
        {r.engineVersion && <Row label="engine build">{r.engineVersion}</Row>}
        {r.capabilities?.contextLength != null && (
          <Row label="context">{r.capabilities.contextLength.toLocaleString()} tokens</Row>
        )}
        {r.capabilities?.parallelSlots != null && (
          <Row label="slots">{r.capabilities.parallelSlots}</Row>
        )}
        {r.lastError && (
          <Row label="last error">
            <span className="status-error px-1">{r.lastError}</span>
          </Row>
        )}
      </dl>

      {r.argv && r.argv.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowArgv((v) => !v)}
            className="font-ui text-xs text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
          >
            {showArgv ? "▾" : "▸"} command line
          </button>
          {showArgv && (
            // The first question anyone debugging a local engine asks is
            // what command actually ran. Copy-pasteable, verbatim.
            <pre className="mt-1 overflow-x-auto rounded-[var(--radius)] bg-[color:var(--panel)] p-2 font-mono text-xs leading-snug">
              {r.argv.join(" ")}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-[color:var(--muted)]">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
