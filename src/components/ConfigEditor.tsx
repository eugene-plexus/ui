"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ConfigFieldInput } from "@/components/ConfigField";
import { ApiError, api } from "@/lib/api";
import type { ProxyTarget } from "@/lib/config";
import type {
  ConfigDocument,
  ConfigField as ConfigFieldDef,
  ConfigSchema,
  ConfigTestResult,
  ConfigUpdateResult,
  RestartResult,
} from "@/lib/types";

interface SaveStatus {
  applied: string[];
  rejected: { key: string; message: string }[];
  requiresRestart: boolean;
  pendingRestart: string[];
}

type RestartPhase = "idle" | "scheduled" | "waiting" | "back" | "timeout" | "error";

interface RestartState {
  phase: RestartPhase;
  message?: string;
}

/**
 * Generic config editor.
 *
 * Loads `/v1/config/schema` and `/v1/config` from the configured target
 * component, renders a form driven entirely by the schema's metadata,
 * and PATCHes the diff back. Same UI works for orchestrator and (when
 * configured) the left and right hemisphere drivers.
 */
export function ConfigEditor({ target, label }: { target: ProxyTarget; label: string }) {
  const [schema, setSchema] = useState<ConfigSchema | null>(null);
  const [serverDoc, setServerDoc] = useState<ConfigDocument | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus | null>(null);
  const [testStatus, setTestStatus] = useState<ConfigTestResult | null>(null);
  const [restart, setRestart] = useState<RestartState>({ phase: "idle" });

  // Per-provider draft cache: when the user switches Provider, we
  // snapshot the current values of provider-dependent fields under the
  // outgoing provider key and restore the new provider's snapshot if we
  // have one. Lets the user explore Providers without losing typed
  // credentials. Lives in a ref because it never needs to trigger a
  // re-render — it's read inside the change handler and seeded from the
  // initial server doc on load.
  const draftCacheRef = useRef<Record<string, Record<string, unknown>>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError(null);
      setSaveStatus(null);
      try {
        const [schemaResp, docResp] = await Promise.all([
          api.get<ConfigSchema>(target, "/v1/config/schema"),
          api.get<ConfigDocument>(target, "/v1/config"),
        ]);
        if (cancelled) return;
        setSchema(schemaResp);
        setServerDoc(docResp);
        setDraft({ ...(docResp as Record<string, unknown>) });
        // Seed the cache with the initial server values keyed under the
        // current provider, so an immediate switch-and-back returns the
        // user to exactly what they loaded with.
        const initialProvider = (docResp as Record<string, unknown>).provider;
        if (typeof initialProvider === "string") {
          const dependentKeys = providerDependentKeys(schemaResp);
          const snapshot: Record<string, unknown> = {};
          for (const k of dependentKeys) {
            snapshot[k] = (docResp as Record<string, unknown>)[k];
          }
          draftCacheRef.current = { [initialProvider]: snapshot };
        } else {
          draftCacheRef.current = {};
        }
      } catch (e) {
        if (cancelled) return;
        setLoadError(formatError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [target]);

  const dirtyKeys = useMemo(() => {
    if (!serverDoc) return new Set<string>();
    const keys = new Set<string>();
    const server = serverDoc as Record<string, unknown>;
    for (const k of Object.keys({ ...server, ...draft })) {
      if (!shallowEqual(server[k], draft[k])) keys.add(k);
    }
    return keys;
  }, [serverDoc, draft]);

  /**
   * Field-change handler. Most fields just merge into draft. The
   * Provider field is special: its value gates which downstream fields
   * the user even sees (via `showWhen`), and the Model dropdown's
   * options are populated from the saved provider's `/v1/models` —
   * stale the moment Provider changes. So a Provider change snapshots
   * the current provider's dependent values to the cache and restores
   * the new provider's snapshot (or clears, if there is none).
   */
  function handleFieldChange(fieldKey: string, value: unknown) {
    if (fieldKey !== "provider" || !schema) {
      setDraft((prev) => ({ ...prev, [fieldKey]: value }));
      return;
    }

    setDraft((prev) => {
      const oldProvider = prev.provider;
      if (oldProvider === value) {
        return { ...prev, provider: value };
      }
      const dependentKeys = providerDependentKeys(schema);

      // Snapshot the current draft's provider-dependent values under
      // the OUTGOING provider key, so we can restore them if the user
      // ever switches back to it during this session.
      if (typeof oldProvider === "string") {
        const snapshot: Record<string, unknown> = {};
        for (const k of dependentKeys) {
          snapshot[k] = prev[k];
        }
        draftCacheRef.current[oldProvider] = snapshot;
      }

      const next: Record<string, unknown> = { ...prev, provider: value };
      const restored =
        typeof value === "string" ? draftCacheRef.current[value] : undefined;
      for (const k of dependentKeys) {
        next[k] = restored ? (restored[k] ?? null) : null;
      }
      return next;
    });
  }

  async function save() {
    if (!schema || dirtyKeys.size === 0) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      const patch: Record<string, unknown> = {};
      for (const k of dirtyKeys) {
        patch[k] = draft[k];
      }
      const result = await api.patch<ConfigUpdateResult>(target, "/v1/config", patch);
      setSaveStatus({
        applied: result.applied,
        rejected: result.rejected.map((r) => ({ key: r.key, message: r.message })),
        requiresRestart: result.requiresRestart,
        pendingRestart: result.pendingRestart ?? [],
      });
      // Refresh from server so the editor reflects any server-side coercions.
      const fresh = await api.get<ConfigDocument>(target, "/v1/config");
      setServerDoc(fresh);
      // Keep user's edits to fields the server rejected, otherwise reset to server values.
      const rejectedKeys = new Set(result.rejected.map((r) => r.key));
      setDraft((prev) => {
        const next: Record<string, unknown> = { ...(fresh as Record<string, unknown>) };
        for (const k of rejectedKeys) {
          next[k] = prev[k];
        }
        return next;
      });
      // Re-seed the per-provider cache from the freshly-saved doc, so
      // post-save provider switches behave the same as a fresh load.
      const newProvider = (fresh as Record<string, unknown>).provider;
      if (typeof newProvider === "string") {
        const dependentKeys = providerDependentKeys(schema);
        const snapshot: Record<string, unknown> = {};
        for (const k of dependentKeys) {
          snapshot[k] = (fresh as Record<string, unknown>)[k];
        }
        draftCacheRef.current = { [newProvider]: snapshot };
      }
    } catch (e) {
      setLoadError(formatError(e));
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    if (!schema) return;
    setTesting(true);
    setTestStatus(null);
    try {
      // Send only dirty fields as overrides — the backend merges them with
      // the saved config server-side. An empty body tests the saved config
      // as-is, which is what the user wants when nothing's changed yet.
      const overrides: Record<string, unknown> = {};
      for (const k of dirtyKeys) {
        overrides[k] = draft[k];
      }
      const body = dirtyKeys.size > 0 ? { overrides } : {};
      const result = await api.post<ConfigTestResult>(target, "/v1/config/test", body);
      setTestStatus(result);
    } catch (e) {
      // Network / non-200 errors come through as ApiError; render as a
      // synthetic ok=false result so the banner stays consistent.
      setTestStatus({
        ok: false,
        component: schema.component,
        latencyMs: 0,
        error: formatError(e),
      });
    } finally {
      setTesting(false);
    }
  }

  /**
   * Trigger the `POST /v1/admin/restart` endpoint and watch
   * `/healthz` to confirm the process came back. The endpoint returns
   * 202 immediately and exits a few hundred ms later, so we transition
   * through `scheduled` → `waiting` → (`back` | `timeout`).
   *
   * v0.1 personal-use installs without a process supervisor will sit
   * in `waiting` until the timeout — at which point the modal tells
   * the operator to relaunch by hand.
   */
  async function performRestart() {
    setRestart({ phase: "scheduled", message: "Asking the process to exit…" });
    try {
      const result = await api.post<RestartResult>(target, "/v1/admin/restart", {});
      setRestart({
        phase: "waiting",
        message: `Process exiting in ~${result.delayMs}ms — waiting for it to come back…`,
      });
      const ok = await waitForHealthz(target, 30_000);
      if (ok) {
        setRestart({ phase: "back", message: `${label} is back online.` });
        // Reload schema/doc from the freshly-restarted process.
        try {
          const [schemaResp, docResp] = await Promise.all([
            api.get<ConfigSchema>(target, "/v1/config/schema"),
            api.get<ConfigDocument>(target, "/v1/config"),
          ]);
          setSchema(schemaResp);
          setServerDoc(docResp);
          setDraft({ ...(docResp as Record<string, unknown>) });
          setSaveStatus(null);
        } catch {
          // If the reload fails the modal still reports "back" — the
          // operator can manually refresh the page.
        }
      } else {
        setRestart({
          phase: "timeout",
          message:
            "Didn't see the process come back within 30s. If you're running without a supervisor (systemd / docker / smoke-test launcher), relaunch it manually, then close this dialog.",
        });
      }
    } catch (e) {
      setRestart({ phase: "error", message: formatError(e) });
    }
  }

  function dismissRestart() {
    setRestart({ phase: "idle" });
  }

  if (loading) {
    return <p className="p-4 text-sm text-[color:var(--muted)]">Loading {label}…</p>;
  }
  if (loadError) {
    return (
      <div className="p-4 text-sm text-rose-300">
        Failed to load <span className="font-mono">{label}</span>: {loadError}
      </div>
    );
  }
  if (!schema || !serverDoc) {
    return null;
  }

  const fieldsByCategory = groupByCategory(schema.fields);
  const categories = schema.categories ?? {};

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{label}</h2>
          <p className="text-[11px] text-[color:var(--muted)]">{schema.component}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[color:var(--muted)]">
            {dirtyKeys.size === 0 ? "no changes" : `${dirtyKeys.size} change(s)`}
          </span>
          <button
            type="button"
            onClick={test}
            disabled={testing || saving}
            title="Test the current draft against the running services without committing it."
            className="font-ui rounded border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[color:var(--border)] disabled:hover:bg-transparent"
          >
            {testing ? "Testing…" : "Test"}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={dirtyKeys.size === 0 || saving}
            className="font-ui rounded bg-[color:var(--accent-left)] px-3 py-1 text-xs font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:brightness-100"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {testStatus && <TestStatusBanner status={testStatus} />}
      {saveStatus && <SaveStatusBanner status={saveStatus} />}

      <div className="flex-1 overflow-y-auto p-4">
        {Object.entries(fieldsByCategory).map(([category, fields]) => {
          const visibleFields = fields.filter((f) => isFieldVisible(f, draft));
          if (visibleFields.length === 0) return null;
          return (
            <section key={category} className="mb-6">
              <h3 className="mb-2 font-mono text-xs tracking-wider text-[color:var(--muted)] uppercase">
                {categories[category] ?? category}
              </h3>
              <div>
                {visibleFields.map((f) => (
                  <ConfigFieldInput
                    key={f.key}
                    field={f}
                    value={draft[f.key]}
                    pending={saving}
                    onChange={(v) => handleFieldChange(f.key, v)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {saveStatus?.requiresRestart && restart.phase === "idle" && (
        <RestartRequiredModal
          label={label}
          pendingRestart={saveStatus.pendingRestart}
          onRestartNow={() => void performRestart()}
          onLater={() => setSaveStatus({ ...saveStatus, requiresRestart: false })}
        />
      )}
      {restart.phase !== "idle" && (
        <RestartProgressModal phase={restart.phase} message={restart.message} onDismiss={dismissRestart} />
      )}
    </div>
  );
}

function SaveStatusBanner({ status }: { status: SaveStatus }) {
  return (
    <div className="border-b border-[color:var(--border)] bg-[color:var(--panel-soft)] px-4 py-3 text-xs">
      {status.applied.length > 0 && (
        <p className="text-emerald-300">
          applied: <span className="font-mono">{status.applied.join(", ")}</span>
        </p>
      )}
      {status.rejected.length > 0 && (
        <ul className="mt-1 text-rose-300">
          {status.rejected.map((r) => (
            <li key={r.key}>
              <span className="font-mono">{r.key}</span>: {r.message}
            </li>
          ))}
        </ul>
      )}
      {status.requiresRestart && (
        <p className="mt-1 text-amber-300">
          restart required for:{" "}
          <span className="font-mono">{status.pendingRestart.join(", ")}</span>
        </p>
      )}
    </div>
  );
}

function TestStatusBanner({ status }: { status: ConfigTestResult }) {
  const tone = status.ok
    ? "border-emerald-900 bg-emerald-950/30 text-emerald-300"
    : "border-rose-900 bg-rose-950/30 text-rose-300";
  return (
    <div className={`border-b px-4 py-3 text-xs ${tone}`}>
      <p>
        <span className="font-mono">
          {status.ok ? "ok" : "fail"} · {status.latencyMs}ms · {status.component}
        </span>
        {status.summary && <span> — {status.summary}</span>}
        {status.error && <span> — {status.error}</span>}
      </p>
      {status.sampleOutput && (
        <pre className="mt-2 max-h-40 overflow-auto rounded bg-[color:var(--panel-soft)] p-2 font-mono text-[11px] leading-relaxed text-[color:var(--foreground)]">
          {status.sampleOutput}
        </pre>
      )}
    </div>
  );
}

function RestartRequiredModal({
  label,
  pendingRestart,
  onRestartNow,
  onLater,
}: {
  label: string;
  pendingRestart: string[];
  onRestartNow: () => void;
  onLater: () => void;
}) {
  return (
    <ModalScrim>
      <h3 className="text-sm font-semibold">Restart required</h3>
      <p className="mt-2 text-xs leading-relaxed text-[color:var(--muted)]">
        Your changes were saved, but{" "}
        <span className="font-mono text-amber-300">{label}</span> only re-reads
        these fields at startup:
      </p>
      <ul className="mt-2 ml-4 list-disc text-xs text-[color:var(--foreground)]">
        {pendingRestart.map((k) => (
          <li key={k} className="font-mono">
            {k}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-[color:var(--muted)]">
        &ldquo;Restart now&rdquo; tells the process to exit; an external
        supervisor (systemd, docker, your launcher) brings it back. If
        you&rsquo;re running without a supervisor, the process will stay down
        until you relaunch it manually.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onLater}
          className="font-ui rounded border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
        >
          Restart later
        </button>
        <button
          type="button"
          onClick={onRestartNow}
          className="font-ui rounded bg-amber-700 px-3 py-1 text-xs font-medium text-amber-50 transition-[filter] hover:brightness-110"
        >
          Restart now
        </button>
      </div>
    </ModalScrim>
  );
}

function RestartProgressModal({
  phase,
  message,
  onDismiss,
}: {
  phase: RestartPhase;
  message?: string;
  onDismiss: () => void;
}) {
  const heading =
    phase === "back"
      ? "Restart complete"
      : phase === "timeout"
        ? "Process didn't come back"
        : phase === "error"
          ? "Restart failed"
          : "Restarting…";
  const tone =
    phase === "back"
      ? "text-emerald-300"
      : phase === "timeout" || phase === "error"
        ? "text-rose-300"
        : "text-amber-300";
  const dismissable = phase === "back" || phase === "timeout" || phase === "error";
  return (
    <ModalScrim>
      <h3 className={`text-sm font-semibold ${tone}`}>{heading}</h3>
      {message && (
        <p className="mt-2 text-xs leading-relaxed text-[color:var(--muted)]">{message}</p>
      )}
      {dismissable && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onDismiss}
            className="font-ui rounded border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
          >
            Close
          </button>
        </div>
      )}
    </ModalScrim>
  );
}

function ModalScrim({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[28rem] max-w-[90vw] rounded-lg border border-[color:var(--border)] bg-[color:var(--panel)] p-5 shadow-xl">
        {children}
      </div>
    </div>
  );
}

function groupByCategory(fields: ConfigFieldDef[]): Record<string, ConfigFieldDef[]> {
  const out: Record<string, ConfigFieldDef[]> = {};
  for (const f of fields) {
    if (!out[f.category]) out[f.category] = [];
    out[f.category]!.push(f);
  }
  return out;
}

/**
 * Honor `ConfigField.showWhen`: only render the field when another field's
 * current draft value matches the predicate. The spec supports two forms:
 *
 *   - scalar `equals`: literal equality against the referenced field's value
 *   - array  `equals`: set-membership — fires when the value matches any entry
 *
 * The array form is what lets a single `apiKey` field declare itself
 * applicable to several enum entries (`provider` ∈ {openai, xai, …}).
 */
function isFieldVisible(field: ConfigFieldDef, draft: Record<string, unknown>): boolean {
  if (!field.showWhen) return true;
  const target = JSON.stringify(draft[field.showWhen.key]);
  const equals = field.showWhen.equals as unknown;
  if (Array.isArray(equals)) {
    return equals.some((e) => JSON.stringify(e) === target);
  }
  return JSON.stringify(equals) === target;
}

/**
 * Keys whose value is conceptually owned by the Provider selection:
 *
 *   - everything that gates its own visibility on `provider` (apiKey,
 *     baseUrl, claudeCodeCliPath, codexCliPath, …)
 *   - `modelId`, which has no `showWhen` but whose enumValues are
 *     populated from the saved provider's `/v1/models` and become
 *     stale the moment Provider changes
 *
 * Used by the provider-change handler to decide which fields to clear /
 * restore from the per-provider draft cache.
 */
function providerDependentKeys(schema: ConfigSchema): string[] {
  const keys = new Set<string>(["modelId"]);
  for (const f of schema.fields) {
    if (f.showWhen?.key === "provider") {
      keys.add(f.key);
    }
  }
  return Array.from(keys);
}

/**
 * Poll `/healthz` until it returns 200 or the deadline passes. Used
 * after a restart to know when the process is back. Starts polling
 * after a brief delay so we don't catch the *outgoing* process before
 * it's fully exited.
 */
async function waitForHealthz(target: ProxyTarget, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  // Give the process at least the response-flush delay before we start
  // hitting /healthz, otherwise we'd see the about-to-exit process
  // answer 200 once and conclude prematurely.
  await sleep(750);
  while (Date.now() - start < timeoutMs) {
    try {
      await api.get<unknown>(target, "/healthz");
      return true;
    } catch {
      await sleep(500);
    }
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function formatError(e: unknown): string {
  if (e instanceof ApiError) {
    const detail =
      typeof e.body === "object" && e.body !== null ? JSON.stringify(e.body) : String(e.body ?? "");
    return `${e.status} ${e.statusText} — ${detail}`;
  }
  return e instanceof Error ? e.message : String(e);
}
