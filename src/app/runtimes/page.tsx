"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ApiError, api } from "@/lib/api";
import type {
  EngineDescriptor,
  EngineInstall,
  EngineList,
  Runtime,
  RuntimeList,
  RuntimeStatus,
} from "@/lib/types";

/**
 * Runtime dashboard — what engine processes exist, what state they're in,
 * and what the host can actually run.
 *
 * Two reads, both on the agent:
 *   GET /v1/engines  → which adapters have a usable binary here
 *   GET /v1/runtimes → the declared engine processes and their live state
 *
 * The engines panel is not decoration. Every "why won't my model start"
 * question begins with whether a binary was found at all, and this is
 * where it gets answered — and, since M1, fixed: an engine with nothing
 * installed offers to fetch the build that matches this host.
 *
 * A host with no installable build says so and why. On Linux with an
 * NVIDIA GPU that is a permanent answer rather than a transient failure
 * (upstream publishes no Linux CUDA binary), so it renders as
 * explanation, not error.
 *
 * Updates are offered, never applied. An engine upgrade can change flag
 * behaviour, and a working setup changing underneath someone is the
 * failure this project exists to avoid.
 */

const POLL_MS = 3000;

// An install writes progress far faster than the dashboard's own cadence,
// and a stalled download is exactly when someone stares at the number.
const INSTALL_POLL_MS = 1000;

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
  exited: "Exited cleanly; the agent is respawning it.",
  crashed: "Exited non-zero repeatedly. The agent gave up — see the error.",
};

export default function RuntimesPage() {
  const [runtimes, setRuntimes] = useState<Runtime[] | null>(null);
  const [engines, setEngines] = useState<EngineDescriptor[] | null>(null);
  const [installs, setInstalls] = useState<Record<string, EngineInstall | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, e] = await Promise.all([
        api.get<RuntimeList>("agent", "/v1/runtimes"),
        api.get<EngineList>("agent", "/v1/engines"),
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
  // agent's own readiness-probe cadence (2s), so there is nothing for
  // a push channel to deliver sooner, and a dashboard that reconnects a
  // socket is a dashboard that can silently stop updating.
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Poll install progress only while something is in flight. The endpoint
  // 404s before the first install of a process, which is not an error —
  // it means nothing has been started, so there is nothing to show.
  const anyInstalling = Object.values(installs).some(
    (i) =>
      i != null &&
      (i.state === "resolving" ||
        i.state === "downloading" ||
        i.state === "verifying" ||
        i.state === "extracting"),
  );

  const loadInstall = useCallback(async (engine: string) => {
    try {
      const state = await api.get<EngineInstall>(
        "agent",
        `/v1/engines/${encodeURIComponent(engine)}/install`,
      );
      setInstalls((prev) => ({ ...prev, [engine]: state }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setInstalls((prev) => ({ ...prev, [engine]: null }));
        return;
      }
      if (err instanceof ApiError && err.status === 401) return;
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Depend on the engine NAMES, not the installs object. The object is
  // rewritten by every poll, so depending on it would tear the interval
  // down and rebuild it on each tick — a timer that never gets to run a
  // full period.
  const installKeys = Object.keys(installs).sort().join(",");

  useEffect(() => {
    if (!anyInstalling) return;
    const names = installKeys ? installKeys.split(",") : [];
    const id = setInterval(() => {
      for (const engine of names) void loadInstall(engine);
      // Refresh the engine list too: the moment an install finishes, the
      // binary path, version and `available` all change.
      void load();
    }, INSTALL_POLL_MS);
    return () => clearInterval(id);
  }, [anyInstalling, installKeys, loadInstall, load]);

  async function installEngine(engine: string) {
    setBusy(`${engine}:install`);
    setError(null);
    try {
      const started = await api.post<EngineInstall>(
        "agent",
        `/v1/engines/${encodeURIComponent(engine)}/install`,
        {},
      );
      setInstalls((prev) => ({ ...prev, [engine]: started }));
    } catch (err) {
      // 422 is the honest "nothing installable for this host" answer; its
      // detail is already rendered on the card, so don't duplicate it in
      // the error bar.
      if (err instanceof ApiError && err.status === 422) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function cancelInstall(engine: string) {
    try {
      const state = await api.delete<EngineInstall>(
        "agent",
        `/v1/engines/${encodeURIComponent(engine)}/install`,
      );
      setInstalls((prev) => ({ ...prev, [engine]: state }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function act(name: string, action: "start" | "stop" | "restart") {
    setBusy(`${name}:${action}`);
    try {
      await api.post("agent", `/v1/runtimes/${encodeURIComponent(name)}/${action}`, {});
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
        <EnginesPanel
          engines={engines}
          install={installs}
          busy={busy}
          onInstall={installEngine}
          onCancel={cancelInstall}
        />
        <RuntimesPanel runtimes={runtimes} busy={busy} onAct={act} />
      </div>
    </main>
  );
}

function EnginesPanel({
  engines,
  install,
  busy,
  onInstall,
  onCancel,
}: {
  engines: EngineDescriptor[] | null;
  install: Record<string, EngineInstall | null>;
  busy: string | null;
  onInstall: (engine: string) => void;
  onCancel: (engine: string) => void;
}) {
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
            <EngineCard
              key={e.engine}
              engine={e}
              install={install[e.engine] ?? null}
              busy={busy}
              onInstall={onInstall}
              onCancel={onCancel}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function EngineCard({
  engine: e,
  install,
  busy,
  onInstall,
  onCancel,
}: {
  engine: EngineDescriptor;
  install: EngineInstall | null;
  busy: string | null;
  onInstall: (engine: string) => void;
  onCancel: (engine: string) => void;
}) {
  const acq = e.acquisition;
  const managed = e.managed;
  const installing =
    install != null &&
    (install.state === "resolving" ||
      install.state === "downloading" ||
      install.state === "verifying" ||
      install.state === "extracting");

  // An update is offered, never applied. An engine upgrade can change
  // flag behaviour, and a working local setup changing underneath
  // someone is the failure this project exists to avoid.
  const updateAvailable =
    managed != null && acq?.latestVersion != null && acq.latestVersion !== managed.version;

  return (
    <div className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-mono font-medium">{e.engine}</span>
          <span
            style={{
              color: e.available ? "var(--status-ok, #3fb950)" : "var(--status-error, #f85149)",
            }}
          >
            {e.available ? "available" : "not installed"}
          </span>
          {e.version && <span className="text-[color:var(--muted)]">build {e.version}</span>}
          {e.origin && <span className="text-[color:var(--muted)]">via {e.origin}</span>}
          {managed?.variant && (
            <span className="font-mono text-[color:var(--muted)]">{managed.variant}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {installing ? (
            <button
              type="button"
              onClick={() => onCancel(e.engine)}
              className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
            >
              cancel
            </button>
          ) : acq?.installable ? (
            <button
              type="button"
              onClick={() => onInstall(e.engine)}
              disabled={busy !== null}
              className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30"
            >
              {managed ? (updateAvailable ? "update" : "reinstall") : "install"}
            </button>
          ) : null}
        </div>
      </div>

      {e.binaryPath && (
        <p className="mt-1 truncate font-mono text-[color:var(--muted)]" title={e.binaryPath}>
          {e.binaryPath}
        </p>
      )}

      {installing && install && <InstallProgress install={install} />}
      {!installing && install?.state === "failed" && (
        <p className="status-error mt-1 px-1">{install.error ?? "install failed"}</p>
      )}

      {/* Why we cannot install here. On Linux with an NVIDIA GPU this is
          the permanent answer, not a transient one, so it reads as
          explanation rather than error. */}
      {acq && !acq.installable && acq.reason && (
        <p className="status-warn mt-2 rounded-[var(--radius)] border px-2 py-1 leading-relaxed">
          {acq.reason}
        </p>
      )}

      {acq?.detected && (
        <p className="mt-1 text-[color:var(--muted)]">
          detected: {acq.detected.os ?? "?"}/{acq.detected.arch ?? "?"}
          {acq.detected.accelerator && acq.detected.accelerator !== "none"
            ? ` · ${acq.detected.accelerator}${
                acq.detected.acceleratorVersion ? ` ${acq.detected.acceleratorVersion}` : ""
              }`
            : " · no GPU detected"}
          {acq.variant && ` → would install ${acq.variant}`}
        </p>
      )}

      {/* The age of the newest build, never a count of builds behind:
          llama.cpp publishes several a day, so "1,021 behind" is noise
          and "three weeks old" is information. */}
      {updateAvailable && acq?.latestVersion && (
        <p className="mt-1 text-[color:var(--muted)]">
          newer build {acq.latestVersion} available
          {acq.latestPublishedAt ? ` (${relativeAge(acq.latestPublishedAt)})` : ""} — you are on{" "}
          {managed?.version}
        </p>
      )}

      {managed?.sizeBytes != null && (
        <p className="mt-1 text-[color:var(--muted)]">
          {formatBytes(managed.sizeBytes)} on disk
          {managed.previousVersion ? `, previous build ${managed.previousVersion} kept` : ""}
        </p>
      )}
    </div>
  );
}

function InstallProgress({ install }: { install: EngineInstall }) {
  const done = install.bytesDownloaded ?? 0;
  const total = install.bytesTotal ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-2">
        {/* The phase, not just a bar. They fail differently: a stall in
            downloading is the network, in extracting it is the disk, and
            verifying failing means do not run this. */}
        <span className="font-mono">{install.state}</span>
        <span className="text-[color:var(--muted)]">
          {total > 0 ? `${formatBytes(done)} / ${formatBytes(total)}` : formatBytes(done)}
        </span>
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded bg-[color:var(--border)]">
        <div
          className="h-full bg-[color:var(--accent-left)] transition-[width] duration-500"
          style={{ width: pct == null ? "100%" : `${pct}%`, opacity: pct == null ? 0.4 : 1 }}
        />
      </div>
      {install.message && (
        <p className="mt-1 truncate text-[color:var(--muted)]">{install.message}</p>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function relativeAge(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day old";
  if (days < 30) return `${days} days old`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month old" : `${months} months old`;
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
          No engine runtimes declared. Add one with the agent&apos;s{" "}
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
