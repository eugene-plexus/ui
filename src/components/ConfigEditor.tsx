"use client";

import { useEffect, useMemo, useState } from "react";

import { ConfigFieldInput } from "@/components/ConfigField";
import { ApiError, api } from "@/lib/api";
import type { ProxyTarget } from "@/lib/config";
import type {
  ConfigDocument,
  ConfigField as ConfigFieldDef,
  ConfigSchema,
  ConfigTestResult,
  ConfigUpdateResult,
} from "@/lib/types";

interface SaveStatus {
  applied: string[];
  rejected: { key: string; message: string }[];
  requiresRestart: boolean;
  pendingRestart: string[];
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
                    onChange={(v) => setDraft((prev) => ({ ...prev, [f.key]: v }))}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
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
 * current draft value equals the predicate. v0.1 supports literal equality
 * only (per the spec); deep equality via JSON.stringify covers strings,
 * numbers, booleans, and arrays uniformly.
 */
function isFieldVisible(field: ConfigFieldDef, draft: Record<string, unknown>): boolean {
  if (!field.showWhen) return true;
  return JSON.stringify(draft[field.showWhen.key]) === JSON.stringify(field.showWhen.equals);
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
