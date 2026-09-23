"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { ConfigFieldInput } from "@/components/ConfigField";
import { ConfirmButton } from "@/components/ConfirmButton";
import { api, describeError } from "@/lib/api";
import { configGroups } from "@/lib/configPresentation";
import { parseFolders } from "@/lib/libraryReach";
import { formatBytesShort } from "@/lib/tasks";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import type { ProxyTarget } from "@/lib/config";
import type {
  ConfigDocument,
  ConfigField as ConfigFieldDef,
  ConfigSchema,
  ConfigTestResult,
  ConfigUpdateResult,
  ModelCopyClearResult,
  ModelCopySkipped,
  RestartResult,
  Component,
  ComponentList,
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
 * and PATCHes the diff back. The same UI serves the agent, the
 * gateway and every inference-driver — no per-component code, which is
 * the whole point: a component that adds a knob gets a form field for
 * free.
 */
export function ConfigEditor({ target, label }: { target: ProxyTarget; label: string }) {
  const [schema, setSchema] = useState<ConfigSchema | null>(null);
  const [serverDoc, setServerDoc] = useState<ConfigDocument | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [showMore, setShowMore] = useState(false);
  const moreId = useId();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // A save that fails is NOT a load that failed. It used to be stored as
  // one, and the load-error branch below replaces the whole editor with
  // "Failed to load …" — so the one moment somebody has typed something
  // worth keeping was the moment the form, and every typed value in it,
  // disappeared behind a message about the wrong thing.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus | null>(null);
  const [testStatus, setTestStatus] = useState<ConfigTestResult | null>(null);
  const [restart, setRestart] = useState<RestartState>({ phase: "idle" });
  // Topology snapshot. Populated when the loaded schema has any
  // `componentKindHint` fields — those need to render as dropdowns
  // sourced from the agent's current components. Null while
  // unfetched / not applicable; the dropdown gracefully falls back
  // to a free-text input when topology is null.
  const [topology, setTopology] = useState<Component[] | null>(null);
  // The library's configured model roots, offered as suggestions for a
  // mapping's `from` (M11). Fetched only when the schema has a
  // `path_mappings` field; empty when the library cannot be asked.
  const [libraryRoots, setLibraryRoots] = useState<string[]>([]);

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
      setShowMore(false);
      setLoadError(null);
      setSaveError(null);
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
        // If this schema has any peer-reference fields, fetch the
        // agent topology so we can render them as dropdowns. Skip
        // the fetch entirely when nothing on the schema needs it
        // (the gateway's config has no kind hints, so there's no point
        // pinging the agent while loading it).
        if (schemaResp.fields.some((f) => f.valueType === "path_mappings")) {
          try {
            const library = await api.get<Record<string, unknown>>("library", "/v1/config");
            // `modelRoots` is a `library_folders` list since 2026-09-14 (a
            // `path_list` before); `parseFolders` reads either shape.
            if (!cancelled) setLibraryRoots(parseFolders(library.modelRoots).map((f) => f.path));
          } catch {
            // No library reachable: the `from` box stays a plain input.
          }
        }
        const hasKindHint = schemaResp.fields.some((f) => f.componentKindHint != null);
        if (hasKindHint) {
          try {
            const topo = await api.get<ComponentList>("agent", "/v1/components");
            if (!cancelled) setTopology(topo.components ?? []);
          } catch {
            // Topology fetch failing isn't fatal — the field falls
            // back to its free-text URL renderer. The operator just
            // loses the dropdown convenience this once.
            if (!cancelled) setTopology(null);
          }
        }
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

  useUnsavedChanges(dirtyKeys.size > 0);

  const labels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const f of schema?.fields ?? []) out[f.key] = f.label;
    return out;
  }, [schema]);

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
    // Any field edit invalidates the last test/save banners — they
    // describe an older draft. Keeping them on screen after a change is
    // misleading: a user who fixed the bad value still sees the stale
    // failure. Per ops feedback, clear on every action.
    setTestStatus(null);
    setSaveStatus(null);
    setSaveError(null);
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
      const restored = typeof value === "string" ? draftCacheRef.current[value] : undefined;
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
    setSaveError(null);
    // The test banner reflects an older draft; clearing it avoids a
    // stale "fail" sitting next to a successful save.
    setTestStatus(null);
    try {
      const patch: Record<string, unknown> = {};
      for (const k of dirtyKeys) {
        patch[k] = draft[k];
      }
      const result = await api.patch<ConfigUpdateResult>(target, "/v1/config", patch);
      if (result.rejected.length) setShowMore(true);
      setSaveStatus({
        applied: result.applied,
        rejected: result.rejected.map((r) => ({ key: r.key, message: r.message })),
        requiresRestart: result.requiresRestart,
        pendingRestart: result.pendingRestart ?? [],
      });
      // Auto-restart when the patch requires it. v0.2.x dropped the
      // "Restart now? / Later" modal — the overwhelming common case is
      // "I'm done editing, save and continue," not "I want to batch
      // multiple restart-required edits before restarting once." The
      // progress modal still surfaces so the operator sees what's
      // happening, and on success it auto-dismisses (see performRestart).
      if (result.requiresRestart) {
        void performRestart();
      }
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
      // The draft stays exactly as typed, so Save can simply be pressed
      // again once whatever refused it is fixed.
      setSaveError(formatError(e));
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    if (!serverDoc) return;
    setDraft({ ...(serverDoc as Record<string, unknown>) });
    setSaveStatus(null);
    setSaveError(null);
    setTestStatus(null);
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
        // Auto-dismiss the success state — the operator didn't ask for
        // a restart receipt, they just want to keep working. Timeout
        // and error phases still require an explicit Close because
        // they describe a real problem the operator needs to see.
        window.setTimeout(() => {
          setRestart((current) => (current.phase === "back" ? { phase: "idle" } : current));
        }, 1500);
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
          // Any test result that was visible before the restart described
          // the OLD running process. Clearing avoids the post-restart UI
          // showing a stale "fail" right next to a successful restart.
          setTestStatus(null);
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
      <div className="text-status-error p-4 text-sm">
        Failed to load <span className="font-mono">{label}</span>: {loadError}
      </div>
    );
  }
  if (!schema || !serverDoc) {
    return null;
  }

  const groups = configGroups(
    schema.component,
    schema.fields.filter((f) => isFieldVisible(f, draft)),
  );
  const categories = schema.categories ?? {};
  const hiddenChanges = groups.more.filter((f) => dirtyKeys.has(f.key)).length;

  function renderCategories(fields: ConfigFieldDef[]) {
    return Object.entries(groupByCategory(fields)).map(([category, entries]) => (
      <section key={category} className="mb-6">
        <h3 className="mb-2 font-mono text-xs tracking-wider text-[color:var(--muted)] uppercase">
          {categories[category] ?? category}
        </h3>
        {entries.map((f) => (
          <ConfigFieldInput
            key={f.key}
            field={fieldForRender(f, draft, serverDoc!)}
            value={draft[f.key]}
            savedValue={(serverDoc as Record<string, unknown>)[f.key]}
            pending={saving}
            topology={topology}
            browseTarget={target}
            pathSuggestions={libraryRoots}
            onChange={(v) => handleFieldChange(f.key, v)}
          />
        ))}
        {category === "modelStorage" && <ClearModelCopies target={target} />}
      </section>
    ));
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{label}</h2>
          <p className="text-[0.6875rem] text-[color:var(--muted)]">{schema.component}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[color:var(--muted)]">
            {dirtyKeys.size === 0 ? "no changes" : `${dirtyKeys.size} change(s)`}
          </span>
          {dirtyKeys.size > 0 && (
            <ConfirmButton
              label="Discard"
              confirmLabel="Discard changes"
              prompt="Put every field back as it was saved?"
              onConfirm={discard}
              disabled={saving}
              testId="config-discard"
              className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30"
            />
          )}
          <button
            type="button"
            onClick={test}
            disabled={testing || saving}
            title="Test the current draft against the running services without committing it."
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[color:var(--border)] disabled:hover:bg-transparent"
          >
            {testing ? "Testing…" : "Test"}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={dirtyKeys.size === 0 || saving}
            className="font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:brightness-100"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {testStatus && <TestStatusBanner status={testStatus} />}
      {saveError && (
        <div
          role="alert"
          className="status-error border-b px-4 py-3 text-sm"
          data-testid="config-save-error"
        >
          Could not save. Your changes are still here, so you can try again. {saveError}
        </div>
      )}
      {saveStatus && <SaveStatusBanner status={saveStatus} labels={labels} />}

      <div className="flex-1 overflow-y-auto p-4">
        {renderCategories(groups.common)}
        {groups.more.length > 0 && (
          <div className="border-t border-[color:var(--border)] pt-3">
            <button
              type="button"
              aria-expanded={showMore}
              aria-controls={moreId}
              onClick={() => setShowMore(!showMore)}
              className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2 text-sm"
            >
              {showMore ? "Show less" : "Show more"} · {groups.more.length} settings
              {hiddenChanges > 0 && ` · ${hiddenChanges} unsaved`}
            </button>
            <p className="my-2 text-sm text-[color:var(--muted)]">
              These settings usually work with their defaults.
            </p>
            <div id={moreId} hidden={!showMore}>
              {renderCategories(groups.more)}
            </div>
          </div>
        )}
      </div>

      {/* v0.2.x: RestartRequiredModal removed — save() auto-triggers
          performRestart() when the patch requires it, and the progress
          modal below renders the in-flight state. */}
      {restart.phase !== "idle" && (
        <RestartProgressModal
          phase={restart.phase}
          message={restart.message}
          onDismiss={dismissRestart}
        />
      )}
    </div>
  );
}

/**
 * What a save did, in the words the form uses.
 *
 * The server answers with keys (`modelRoots`), which is right for the
 * wire and wrong for a person who just edited a field called "Model
 * folders". The key stays one hover away, as a title, for whoever is
 * matching the screen against a config file.
 */
function SaveStatusBanner({
  status,
  labels,
}: {
  status: SaveStatus;
  labels: Record<string, string>;
}) {
  const name = (key: string) => (
    <span key={key} title={key}>
      {labels[key] ?? key}
    </span>
  );
  const list = (keys: string[]) =>
    keys.flatMap((k, i) => (i === 0 ? [name(k)] : [<span key={`${k}-sep`}>, </span>, name(k)]));
  return (
    <div
      role="status"
      className="border-b border-[color:var(--border)] bg-[color:var(--panel-soft)] px-4 py-3 text-sm"
    >
      {status.applied.length > 0 && (
        <p className="text-status-success">Saved: {list(status.applied)}</p>
      )}
      {status.rejected.length > 0 && (
        <ul className="text-status-error mt-1">
          {status.rejected.map((r) => (
            <li key={r.key}>
              {name(r.key)}: {r.message}
            </li>
          ))}
        </ul>
      )}
      {status.requiresRestart && (
        <p className="text-status-warn mt-1">Restart needed for: {list(status.pendingRestart)}</p>
      )}
    </div>
  );
}

function TestStatusBanner({ status }: { status: ConfigTestResult }) {
  return (
    <div className={`${status.ok ? "status-success" : "status-error"} border-b px-4 py-3 text-sm`}>
      <p>
        <span className="font-mono">
          {status.ok ? "ok" : "fail"} · {status.latencyMs}ms · {status.component}
        </span>
        {status.summary && <span> — {status.summary}</span>}
        {status.error && <span> — {status.error}</span>}
      </p>
      {status.sampleOutput && (
        <pre className="mt-2 max-h-40 overflow-auto rounded-[var(--radius)] bg-[color:var(--panel-soft)] p-2 font-mono text-[0.6875rem] leading-relaxed text-[color:var(--foreground)]">
          {status.sampleOutput}
        </pre>
      )}
    </div>
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
      ? "text-status-success"
      : phase === "timeout" || phase === "error"
        ? "text-status-error"
        : "text-status-warn";
  const dismissable = phase === "back" || phase === "timeout" || phase === "error";
  return (
    <ModalScrim labelledBy="restart-progress-heading">
      <h3 id="restart-progress-heading" className={`text-sm font-semibold ${tone}`}>
        {heading}
      </h3>
      {message && (
        <p className="mt-2 text-sm leading-relaxed text-[color:var(--muted)]">{message}</p>
      )}
      {dismissable && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onDismiss}
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
          >
            Close
          </button>
        </div>
      )}
    </ModalScrim>
  );
}

function ModalScrim({ children, labelledBy }: { children: React.ReactNode; labelledBy: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-live="polite"
        className="w-[28rem] max-w-[90vw] rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] p-5 shadow-xl"
      >
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
 * When the draft Provider differs from the saved one, the model
 * dropdown's enumValues are stale — they were populated from the SAVED
 * provider's `/v1/models` and have no relationship to the new
 * provider's catalog. Letting the operator pick from that list silently
 * sets a model that doesn't exist on the chosen backend (e.g. picking
 * "gpt-4o" from an OpenAI list while Provider is now MiniMax).
 *
 * Workaround: swap modelId to a free-text input until Save + Restart
 * refreshes the schema with the new provider's actual model list. The
 * operator can still type a model name they know is valid.
 */
function fieldForRender(
  field: ConfigFieldDef,
  draft: Record<string, unknown>,
  serverDoc: ConfigDocument,
): ConfigFieldDef {
  if (field.key !== "modelId") return field;
  const savedProvider = (serverDoc as Record<string, unknown>).provider;
  if (draft.provider === savedProvider) return field;
  return {
    ...field,
    valueType: "string",
    enumValues: undefined,
    enumLabels: undefined,
    description:
      (field.description ?? "") +
      "\n\nProvider has changed; the dropdown can't refresh until Save + Restart. Type a model name or leave blank to use the new provider's default.",
  };
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

/** Was: the status line plus `JSON.stringify(body)`.
 *
 * That is how a worker node's Gateway tab reported "the install's
 * gateway is not on this host" — as a wall of escaped JSON with the
 * one useful sentence buried in it. Every component writes that
 * sentence deliberately; this screen was the one that threw it away. */
const formatError = describeError;

/**
 * Delete this machine's local copies of its models.
 *
 * Lives under Model storage rather than on a screen of its own because
 * it is the other half of the toggle above it, and it carries the
 * sentence that would otherwise surprise whoever pressed it: **the
 * copies come back**. Someone clearing 60 GB to free a disk, with the
 * option still on, gets that space back for as long as it takes the
 * models to start again — so the button says so before it is pressed,
 * not after.
 *
 * It never stops a runtime to get at a file. A copy in use is reported,
 * by name, as one it could not remove: there is someone's inference
 * session on the other end of that decision and a button called Clear
 * must not make it.
 */
function ClearModelCopies({ target }: { target: ProxyTarget }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ModelCopyClearResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function clear() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.post<ModelCopyClearResult>(target, "/v1/model-copies/clear", {}));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2" data-testid="clear-model-copies">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={clear}
          disabled={busy}
          className="font-ui w-fit rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Deleting…" : "Delete the local copies"}
        </button>
        <p className="text-sm text-[color:var(--muted)]">
          Copies are made again the next time these models start. Turn the option off first if you
          want the space to stay free.
        </p>
      </div>
      {error && <p className="text-status-error text-sm">{error}</p>}
      {result && (
        <div className="text-sm text-[color:var(--muted)]" data-testid="clear-model-copies-result">
          <p>
            {result.deleted.length === 0
              ? "There was nothing to delete."
              : `Deleted ${result.deleted.length} ${result.deleted.length === 1 ? "copy" : "copies"}${
                  result.bytesFreed ? `, freeing ${formatBytesShort(result.bytesFreed)}` : ""
                }.`}
          </p>
          {result.skipped.length > 0 && (
            <ul className="mt-1 list-disc pl-4">
              {result.skipped.map((s: ModelCopySkipped) => (
                <li key={s.path}>
                  kept <span className="font-mono">{s.path}</span> — {s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
