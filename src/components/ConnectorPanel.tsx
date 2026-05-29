"use client";

import { useEffect, useMemo, useState } from "react";

import { ConfigEditor } from "@/components/ConfigEditor";
import { ConfigFieldInput } from "@/components/ConfigField";
import { ApiError, api } from "@/lib/api";
import type { ConfigField as ConfigFieldDef, ConfigSchema, ConfigTestResult } from "@/lib/types";

/**
 * Connector tab — wraps two sub-views in one tab:
 *
 *   - "Settings"  — connector-level config (orchestratorUrl, identityUrl,
 *                   logLevel) via the standard ConfigEditor.
 *   - "Adapters"  — list / create / test / delete platform adapters
 *                   (currently only `discord` ships in v0.2).
 *
 * The adapter list is the operator-visible reason the connector exists
 * at all. v0.3+ adapter kinds (slack, matrix, gmail) drop into the same
 * panel without UI changes — the adapter's config schema is fetched at
 * runtime via `GET /v1/adapters/{name}/config/schema` and rendered by
 * the same `ConfigFieldInput` machinery the rest of the UI uses.
 */
export function ConnectorPanel() {
  const [view, setView] = useState<"settings" | "adapters">("settings");

  return (
    <div className="flex h-full flex-col">
      <nav className="flex gap-1 border-b border-[color:var(--border)] bg-[color:var(--panel-soft)] px-4 py-2">
        <SubTabButton active={view === "settings"} onClick={() => setView("settings")}>
          Settings
        </SubTabButton>
        <SubTabButton active={view === "adapters"} onClick={() => setView("adapters")}>
          Adapters
        </SubTabButton>
      </nav>
      <div className="flex-1 overflow-hidden">
        {view === "settings" ? (
          <ConfigEditor target="connector" label="Connector" />
        ) : (
          <AdaptersPanel />
        )}
      </div>
    </div>
  );
}

function SubTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-ui rounded-[var(--radius)] px-3 py-1 text-xs transition-colors ${
        active
          ? "bg-[color:var(--accent-left)] text-[color:var(--on-accent-left)] hover:brightness-110"
          : "border border-[color:var(--border)] text-[color:var(--foreground)] hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
      }`}
    >
      {children}
    </button>
  );
}

/* ───────────────────────────── adapters ────────────────────────────── */

// Shapes from connector.yaml — hand-typed because the connector spec
// isn't in the UI's codegen list yet. If/when codegen picks it up these
// can be swapped for the generated types.
interface AdapterEntry {
  name: string;
  kind: string;
  adapterConfig?: Record<string, unknown>;
  enabled?: boolean;
}

type AdapterRuntimeStatus =
  | "starting"
  | "connected"
  | "disconnected"
  | "rate_limited"
  | "error"
  | "disabled";

interface AdapterStatus {
  entry: AdapterEntry;
  status: AdapterRuntimeStatus;
  lastConnected?: string | null;
  lastError?: string | null;
}

interface AdaptersListResponse {
  adapters: AdapterStatus[];
}

function AdaptersPanel() {
  const [list, setList] = useState<AdapterStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function reload(opts?: { silent?: boolean }) {
    if (!opts?.silent) {
      setLoading(true);
      setLoadError(null);
    }
    try {
      const resp = await api.get<AdaptersListResponse>("connector", "/v1/adapters");
      setList(resp.adapters ?? []);
    } catch (e) {
      if (!opts?.silent) {
        setLoadError(formatError(e));
      }
    } finally {
      if (!opts?.silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  // Poll silently while ANY adapter is in a transient state. Catches
  // the common case where a brand-new adapter is mid-connect (status
  // moves "starting" → "connected" or "starting" → "error" over a
  // few hundred ms, but the one-shot reload after save fires too
  // fast to see the transition). Polling stops as soon as every
  // adapter is settled, so this isn't a permanent background load.
  useEffect(() => {
    const hasTransient = list.some((a) => a.status === "starting" || a.status === "rate_limited");
    if (!hasTransient) return;
    const interval = setInterval(() => {
      void reload({ silent: true });
    }, 1500);
    return () => clearInterval(interval);
  }, [list]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Adapters</h2>
          <p className="text-[11px] text-[color:var(--muted)]">
            One adapter per external platform (e.g. one Discord bot).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1 text-xs font-medium text-[color:var(--on-accent-left)] hover:brightness-110"
          >
            Add adapter
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {loadError && (
          <p className="status-error mb-3 rounded-[var(--radius)] border px-3 py-2 text-xs">
            {loadError}
          </p>
        )}
        {creating && (
          <CreateAdapter
            onCancel={() => setCreating(false)}
            onCreated={() => {
              setCreating(false);
              void reload();
            }}
          />
        )}
        {loading && !creating && (
          <p className="text-xs text-[color:var(--muted)]">Loading adapters…</p>
        )}
        {!loading && list.length === 0 && !creating && (
          <p className="text-xs text-[color:var(--muted)]">
            No adapters configured. Use <span className="font-mono">Add adapter</span> to wire up
            your first one (Discord is the only kind in v0.2).
          </p>
        )}
        {!loading &&
          list.map((a) => (
            <AdapterRow
              key={a.entry.name}
              adapter={a}
              expanded={editing === a.entry.name}
              onToggle={() => setEditing(editing === a.entry.name ? null : a.entry.name)}
              onChanged={() => {
                void reload();
              }}
              onDeleted={() => {
                setEditing(null);
                void reload();
              }}
            />
          ))}
      </div>
    </div>
  );
}

function AdapterRow({
  adapter,
  expanded,
  onToggle,
  onChanged,
  onDeleted,
}: {
  adapter: AdapterStatus;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  return (
    <div className="mb-3 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-[color:var(--panel-hover)]"
      >
        <div>
          <p className="font-ui text-sm font-medium">{adapter.entry.name}</p>
          <p className="font-mono text-[11px] text-[color:var(--muted)]">{adapter.entry.kind}</p>
        </div>
        <StatusBadge status={adapter.status} />
      </button>
      {expanded && (
        <div className="border-t border-[color:var(--border)] p-4">
          <AdapterEditor adapter={adapter.entry} onChanged={onChanged} onDeleted={onDeleted} />
          {adapter.lastError && (
            <p className="status-error mt-3 rounded-[var(--radius)] border px-3 py-2 text-xs">
              Last error: {adapter.lastError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: AdapterRuntimeStatus }) {
  const palette: Record<AdapterRuntimeStatus, string> = {
    starting: "status-warn",
    connected: "status-success",
    disconnected:
      "border-[color:var(--border)] bg-[color:var(--panel-hover)] text-[color:var(--muted)]",
    rate_limited: "status-warn",
    error: "status-error",
    disabled: "border-[color:var(--border)] bg-[color:var(--panel)] text-[color:var(--muted)]",
  };
  return (
    <span
      className={`rounded-[var(--radius)] border px-2 py-0.5 font-mono text-[10px] ${palette[status]}`}
    >
      {status}
    </span>
  );
}

function AdapterEditor({
  adapter,
  onChanged,
  onDeleted,
}: {
  adapter: AdapterEntry;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [schema, setSchema] = useState<ConfigSchema | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>(
    (adapter.adapterConfig ?? {}) as Record<string, unknown>,
  );
  const [enabled, setEnabled] = useState<boolean>(adapter.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<ConfigTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const s = await api.get<ConfigSchema>(
          "connector",
          `/v1/adapters/${encodeURIComponent(adapter.name)}/config/schema`,
        );
        if (!cancelled) setSchema(s);
      } catch (e) {
        if (!cancelled) setError(formatError(e));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [adapter.name]);

  const fields: ConfigFieldDef[] = useMemo(() => schema?.fields ?? [], [schema]);

  function setFieldValue(key: string, value: unknown) {
    // A field edit invalidates the last test/error banners — they
    // described the prior draft. Clear them so the user isn't staring
    // at a stale failure after fixing the value.
    setTestStatus(null);
    setError(null);
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setTestStatus(null);
    try {
      await api.patch("connector", `/v1/adapters/${encodeURIComponent(adapter.name)}`, {
        name: adapter.name,
        kind: adapter.kind,
        enabled,
        adapterConfig: draft,
      });
      onChanged();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTestStatus(null);
    try {
      const result = await api.post<ConfigTestResult>(
        "connector",
        `/v1/adapters/${encodeURIComponent(adapter.name)}/test`,
        { overrides: draft },
      );
      setTestStatus(result);
    } catch (e) {
      setTestStatus({
        ok: false,
        component: `connector:${adapter.name}`,
        latencyMs: 0,
        error: formatError(e),
      });
    } finally {
      setTesting(false);
    }
  }

  async function remove() {
    setSaving(true);
    setError(null);
    try {
      await api.delete("connector", `/v1/adapters/${encodeURIComponent(adapter.name)}`);
      onDeleted();
    } catch (e) {
      setError(formatError(e));
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-3 text-xs">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              setTestStatus(null);
              setError(null);
            }}
            className="h-4 w-4"
          />
          <span>Enabled</span>
        </label>
      </div>

      {schema === null && !error && (
        <p className="text-xs text-[color:var(--muted)]">Loading adapter schema…</p>
      )}

      {fields.map((f) => (
        <ConfigFieldInput
          key={f.key}
          field={f}
          value={draft[f.key]}
          pending={saving}
          onChange={(v) => setFieldValue(f.key, v)}
        />
      ))}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void runTest()}
          disabled={testing || saving}
          className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {testing ? "Testing…" : "Test connection"}
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1 text-xs font-medium text-[color:var(--on-accent-left)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <div className="ml-auto">
          {deleteConfirm ? (
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirm(false)}
                className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void remove()}
                disabled={saving}
                className="font-ui status-error rounded-[var(--radius)] border px-3 py-1 text-xs font-medium hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Confirm delete
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setDeleteConfirm(true)}
              disabled={saving}
              className="font-ui text-status-error rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="status-error mt-3 rounded-[var(--radius)] border px-3 py-2 text-xs">
          {error}
        </p>
      )}
      {testStatus && (
        <p
          className={`mt-3 rounded-[var(--radius)] border px-3 py-2 text-xs ${
            testStatus.ok ? "status-success" : "status-error"
          }`}
        >
          <span className="font-mono">
            {testStatus.ok ? "ok" : "fail"} · {testStatus.latencyMs}ms · {testStatus.component}
          </span>
          {testStatus.summary ? ` — ${testStatus.summary}` : ""}
          {testStatus.error ? ` — ${testStatus.error}` : ""}
        </p>
      )}
    </div>
  );
}

function CreateAdapter({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const [name, setName] = useState("discord");
  const [kind] = useState("discord");
  const [botToken, setBotToken] = useState("");
  const [channelAllowlist, setChannelAllowlist] = useState("");
  const [contextLimit, setContextLimit] = useState<number>(10);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: name.trim() || "discord",
        kind,
        enabled: true,
        adapterConfig: {
          botToken,
          channelAllowlist: channelAllowlist
            .split(/[,\s]+/u)
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
            .join(","),
          channelContextLimit: contextLimit,
        },
      };
      await api.post("connector", "/v1/adapters", body);
      onCreated();
    } catch (e) {
      setError(formatError(e));
      setSaving(false);
    }
  }

  return (
    <div className="mb-4 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-4">
      <h3 className="font-ui mb-3 text-sm font-semibold">Add adapter</h3>
      <Field label="Name" description="Used in logs and as the URL path segment.">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
        />
      </Field>
      <Field label="Kind" description="Platform type. v0.2 ships Discord only.">
        <input
          type="text"
          value={kind}
          disabled
          className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-2 text-sm opacity-60"
        />
      </Field>
      <Field
        label="Bot token"
        description="From your Discord application's Bot page. Stored encrypted on disk when the master key is available."
      >
        <input
          type="password"
          value={botToken}
          onChange={(e) => setBotToken(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
        />
      </Field>
      <Field
        label="Channel allowlist"
        description="Comma- or whitespace-separated Discord channel IDs Eugene may respond to on @-mention. DMs are always honored. Leave blank to allow all channels."
      >
        <input
          type="text"
          value={channelAllowlist}
          onChange={(e) => setChannelAllowlist(e.target.value)}
          placeholder="123456789012345678, 234567890123456789"
          className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
        />
      </Field>
      <Field
        label="Channel-context messages"
        description="For channel mentions, how many prior messages to forward as grounding context."
      >
        <input
          type="number"
          min={0}
          max={50}
          value={contextLimit}
          onChange={(e) => setContextLimit(parseInt(e.target.value, 10) || 0)}
          className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
        />
      </Field>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !botToken.trim()}
          className="font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1 text-xs font-medium text-[color:var(--on-accent-left)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Creating…" : "Create"}
        </button>
      </div>
      {error && (
        <p className="status-error mt-3 rounded-[var(--radius)] border px-3 py-2 text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <label className="font-ui block text-sm font-medium">{label}</label>
      {description && (
        <p className="mt-1 mb-2 text-xs leading-relaxed text-[color:var(--muted)]">{description}</p>
      )}
      {children}
    </div>
  );
}

function formatError(e: unknown): string {
  if (e instanceof ApiError) {
    if (typeof e.body === "object" && e.body !== null) {
      const detail = (e.body as { detail?: unknown }).detail;
      if (typeof detail === "string") return detail;
      if (typeof detail === "object" && detail !== null) {
        const inner = (detail as { detail?: unknown; title?: unknown }).detail;
        const title = (detail as { detail?: unknown; title?: unknown }).title;
        if (typeof inner === "string") return inner;
        if (typeof title === "string") return title;
      }
    }
    return `${e.status} ${e.statusText}`;
  }
  return e instanceof Error ? e.message : String(e);
}
