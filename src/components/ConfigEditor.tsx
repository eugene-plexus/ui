"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { ConfigFieldInput } from "@/components/ConfigField";
import { ConfirmButton } from "@/components/ConfirmButton";
import { api, describeError } from "@/lib/api";
import {
  configGroups,
  isFieldVisible,
  isCustomized,
  needsAttention,
  settingSummary,
} from "@/lib/configPresentation";
import { invalidateConfigTrio, loadConfigTrio } from "@/lib/configTrio";
import { parseFolders } from "@/lib/libraryReach";
import { HIDDEN_KEYS, matchesQuery, fieldSearchTexts } from "@/lib/settingsTopics";
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
/**
 * Where a config trio lives and how its process is restarted.
 *
 * A component serves the trio at `/v1/config` and restarts itself through
 * `/v1/admin/restart`. An app does neither: the agent serves the app's
 * trio at `/v1/apps/{id}/config`, calling the app with an admin token the
 * operator never sees, and restarts it at `/v1/apps/{id}/restart`
 * (`specs/docs/design/apps-and-spokes.md` §11.2). Pointed at an app with
 * the component defaults, this editor would have PATCHed and restarted
 * the agent itself.
 */
export interface ConfigEndpoints {
  /** The trio's base path; `/schema` is appended for the schema. */
  config: string;
  /** Ask for a restart; resolves to the status line to show while waiting. */
  restart: () => Promise<string>;
  /** True once the process answers again within `timeoutMs`. */
  waitUntilBack: (timeoutMs: number) => Promise<boolean>;
  /** Whether `POST <config>/test` exists. */
  canTest: boolean;
}

function componentEndpoints(target: ProxyTarget): ConfigEndpoints {
  return {
    config: "/v1/config",
    restart: async () => {
      const result = await api.post<RestartResult>(target, "/v1/admin/restart", {});
      return `Process exiting in ~${result.delayMs}ms — waiting for it to come back…`;
    },
    waitUntilBack: (timeoutMs) => waitForHealthz(target, timeoutMs),
    canTest: true,
  };
}

/**
 * What a section of the Settings page tells the page about itself, so a
 * bar at the foot can count unsaved changes across sections and save
 * them in turn. The functions are stable wrappers over the section's
 * latest `save` and `discard`; only `dirty` changes.
 */
export interface SectionHandle {
  dirty: number;
  attention?: boolean;
  /** Sections that share a process share a restart (CX7): their target and config path. */
  process?: string;
  /** The process's name, for "Restarts: …". */
  label?: string;
  /** An unsaved field takes effect only after a restart. */
  restartDirty?: boolean;
  /**
   * Save. With `deferRestart`, a save that needs a restart does not start
   * one; it says so, and the page calls `restart` once per process.
   */
  save: (opts?: { deferRestart?: boolean }) => Promise<SaveOutcome>;
  /** Restart the process for what was saved; true once it is back. */
  restart?: () => Promise<boolean>;
  /** Read the config again after a restart another section ran. */
  reload?: () => Promise<void>;
  discard: () => void;
}

/** What one save did, for the page's save-all. */
export interface SaveOutcome {
  /** The PATCH was answered (some keys may still have been refused). */
  saved: boolean;
  /** The saved keys take effect only after a restart that has not run. */
  restartNeeded: boolean;
}

export function ConfigEditor({
  target,
  label,
  endpoints,
  only,
  matchedKeys,
  initialQuery = "",
  compact = false,
  hint,
  expandMore = false,
  focusKey = null,
  sectionId,
  onSection,
}: {
  target: ProxyTarget;
  label: string;
  /** Omitted for a component; see `ConfigEndpoints`. */
  endpoints?: ConfigEndpoints;
  /**
   * Render only these keys (a topic's share of the component), in the
   * schema's order. Absent, every field. The *Customize* fold is decided
   * on the whole schema either way, so a field folds on the topic page
   * exactly when it folds on the component's own.
   */
  only?: readonly string[];
  /** Search filters the view, never the mounted editor or the saved draft. */
  matchedKeys?: readonly string[];
  initialQuery?: string;
  /**
   * A section of the Settings page: no page header, the owner's name as
   * a heading, Save and Discard shown only while there is something to
   * save, and a category heading only where the section spans two.
   */
  compact?: boolean;
  /** Hover text for the compact heading: the implementation noun. */
  hint?: string;
  /** Open the fold: a search matched a field behind it. */
  expandMore?: boolean;
  /** A field to open on, scroll to and mark: the `#key` of a deep link. */
  focusKey?: string | null;
  /** With `onSection`, this section's id in the page's save-all bar. */
  sectionId?: string;
  onSection?: (id: string, handle: SectionHandle | null) => void;
}) {
  const ends = useMemo(() => endpoints ?? componentEndpoints(target), [endpoints, target]);
  const [schema, setSchema] = useState<ConfigSchema | null>(null);
  const [serverDoc, setServerDoc] = useState<ConfigDocument | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [showMore, setShowMore] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  useEffect(() => setQuery(initialQuery), [initialQuery]);
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  useEffect(() => {
    const readAnchor = () => {
      try {
        setAnchorKey(decodeURIComponent(window.location.hash.slice(1)) || null);
      } catch {
        setAnchorKey(null);
      }
    };
    readAnchor();
    window.addEventListener("hashchange", readAnchor);
    return () => window.removeEventListener("hashchange", readAnchor);
  }, []);
  focusKey = focusKey ?? anchorKey;
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
  // A save that landed and could not be read back: the draft is not what
  // is on the server any more, and nothing here knows what is.
  const [readBackError, setReadBackError] = useState<string | null>(null);
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
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Why each refused field was refused, for the field itself to say.
  const refusedMessages = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of saveStatus?.rejected ?? []) out[r.key] = r.message;
    return out;
  }, [saveStatus]);

  // A save that was refused moves focus to the first refused field on the
  // page, so the person lands where the fix is. Not while the restart
  // dialog is up: it holds focus, and gives it back here when it closes.
  useEffect(() => {
    const refused = new Set(Object.keys(refusedMessages));
    if (refused.size === 0 || restart.phase !== "idle") return;
    const rows = rootRef.current?.querySelectorAll<HTMLElement>("[data-config-key]") ?? [];
    const first = Array.from(rows).find((r) => refused.has(r.dataset.configKey ?? ""));
    first?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
  }, [refusedMessages, restart.phase]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setShowMore(false);
      setLoadError(null);
      setSaveError(null);
      setSaveStatus(null);
      try {
        // Shared with every other section of the Settings page that is
        // reading the same component at the same moment.
        const { schema: schemaResp, doc: docResp } = await loadConfigTrio(target, ends.config);
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
            // `modelRoots` is a `library_folders` list; `parseFolders` reads it.
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
  }, [target, ends.config]);

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

  // A search matched a field behind the fold: open it for the person who
  // searched. Never closes it -- that is theirs to do.
  useEffect(() => {
    if (expandMore) setShowMore(true);
  }, [expandMore]);

  // The page's save-all bar. The handle's functions read the latest
  // `save`/`discard` through a ref, so the page is told again only when
  // the count changes rather than on every render.
  const latest = useRef<{
    save: (opts?: { deferRestart?: boolean }) => Promise<SaveOutcome>;
    discard: () => void;
    restart: () => Promise<boolean>;
    reload: () => Promise<void>;
  }>({
    save: async () => ({ saved: false, restartNeeded: false }),
    discard: () => {},
    restart: async () => false,
    reload: async () => {},
  });
  // The unsaved fields that take effect only after a restart (CX7): the
  // schema says which, so the button can say so before anyone presses it.
  const restartDirty = useMemo(
    () => (schema?.fields ?? []).some((f) => f.requiresRestart && dirtyKeys.has(f.key)),
    [schema, dirtyKeys],
  );
  const attention = Boolean(
    saveError ||
    readBackError ||
    loadError ||
    saveStatus?.rejected.length ||
    schema?.fields.some((f) => (!only || only.includes(f.key)) && needsAttention(f, draft[f.key])),
  );
  useEffect(() => {
    if (!sectionId || !onSection) return;
    const id = sectionId;
    onSection(id, {
      dirty: dirtyKeys.size,
      attention,
      process: `${target} ${ends.config}`,
      label,
      restartDirty,
      save: (opts) => latest.current.save(opts),
      restart: () => latest.current.restart(),
      reload: () => latest.current.reload(),
      discard: () => latest.current.discard(),
    });
    return () => onSection(id, null);
  }, [sectionId, onSection, dirtyKeys.size, attention, target, ends.config, label, restartDirty]);

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

  // What a deferred save's server refused, kept for the restart the page
  // runs later: the reload after it must not lose those values.
  const deferredRefused = useRef<Record<string, unknown>>({});

  async function save(opts: { deferRestart?: boolean } = {}): Promise<SaveOutcome> {
    const outcome: SaveOutcome = { saved: false, restartNeeded: false };
    if (!schema || dirtyKeys.size === 0) return outcome;
    setSaving(true);
    setSaveStatus(null);
    setSaveError(null);
    setReadBackError(null);
    // The test banner reflects an older draft; clearing it avoids a
    // stale "fail" sitting next to a successful save.
    setTestStatus(null);
    try {
      const patch: Record<string, unknown> = {};
      for (const k of dirtyKeys) {
        patch[k] = draft[k];
      }
      const result = await api.patch<ConfigUpdateResult>(target, ends.config, patch);
      outcome.saved = true;
      // Whatever another section read a moment ago is out of date now.
      invalidateConfigTrio(target);
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
        // What was refused has to outlive the restart: the reload after it
        // replaced the draft with the server's values and cleared the
        // banner, so a partly-applied save lost the refused value AND the
        // sentence saying why, behind a "back online" that closed itself.
        const refused: Record<string, unknown> = {};
        for (const r of result.rejected) refused[r.key] = patch[r.key];
        // Save all restarts each process once, after its last save (CX7):
        // a second section's PATCH must not reach a process on its way out.
        if (opts.deferRestart) {
          outcome.restartNeeded = true;
          deferredRefused.current = { ...deferredRefused.current, ...refused };
        } else void performRestart(refused);
      }
      // Refresh from server so the editor reflects any server-side coercions.
      // A read-back that fails is NOT a save that failed: the values are
      // saved, and saying "Could not save" would send somebody to save them
      // again (settings never lie, 2026-09-30). The schema is read too --
      // what is pending a restart, what an unset value now resolves to.
      let fresh: ConfigDocument;
      try {
        const trio = await loadConfigTrio(target, ends.config);
        fresh = trio.doc;
        setSchema(trio.schema);
      } catch (e) {
        setReadBackError(
          `Saved, but the saved values could not be read back (${formatError(e)}). ` +
            "Reload the page to see them.",
        );
        return outcome;
      }
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
    return outcome;
  }

  /** The restart a deferred save left to the page (CX7). */
  async function restartDeferred(): Promise<boolean> {
    const refused = deferredRefused.current;
    deferredRefused.current = {};
    return performRestart(refused);
  }

  /** After a restart another section of this process ran: read what is in effect now. */
  async function reloadAfterRestart() {
    try {
      invalidateConfigTrio(target);
      const { schema: schemaResp, doc: docResp } = await loadConfigTrio(target, ends.config);
      setSchema(schemaResp);
      setServerDoc(docResp);
      setDraft({ ...(docResp as Record<string, unknown>), ...deferredRefused.current });
      deferredRefused.current = {};
      setSaveStatus((current) =>
        current ? { ...current, requiresRestart: false, pendingRestart: [] } : null,
      );
    } catch {
      // The banner keeps "Restart needed"; a reload of the page reads it again.
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
      const result = await api.post<ConfigTestResult>(target, `${ends.config}/test`, body);
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
  async function performRestart(refused: Record<string, unknown> = {}): Promise<boolean> {
    setRestart({ phase: "scheduled", message: "Asking the process to exit…" });
    try {
      const waiting = await ends.restart();
      setRestart({ phase: "waiting", message: waiting });
      const ok = await ends.waitUntilBack(30_000);
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
          invalidateConfigTrio(target);
          const { schema: schemaResp, doc: docResp } = await loadConfigTrio(target, ends.config);
          setSchema(schemaResp);
          setServerDoc(docResp);
          setDraft({ ...(docResp as Record<string, unknown>), ...refused });
          // The restart line is done with; a refusal is not.
          setSaveStatus((current) =>
            current && current.rejected.length > 0
              ? { ...current, requiresRestart: false, pendingRestart: [] }
              : null,
          );
          // Any test result that was visible before the restart described
          // the OLD running process. Clearing avoids the post-restart UI
          // showing a stale "fail" right next to a successful restart.
          setTestStatus(null);
        } catch {
          // If the reload fails the modal still reports "back" — the
          // operator can manually refresh the page.
        }
        return true;
      } else {
        setRestart({
          phase: "timeout",
          message:
            "Did not see the process come back within 30s. Without a supervisor (systemd, Docker), relaunch it manually, then close this dialog.",
        });
      }
    } catch (e) {
      setRestart({ phase: "error", message: formatError(e) });
    }
    return false;
  }

  function dismissRestart() {
    setRestart({ phase: "idle" });
  }

  latest.current = { save, discard, restart: restartDeferred, reload: reloadAfterRestart };

  // A deep link's field: open the fold it may be behind, scroll to it and
  // mark it for a moment. Once per key, after the form exists.
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (!focusKey || loading || !schema || focused.current === focusKey) return;
    if (!schema.fields.some((f) => f.key === focusKey)) return;
    if (only && !only.includes(focusKey)) return;
    focused.current = focusKey;
    setShowMore(true);
    const id = window.setTimeout(() => {
      const row = rootRef.current?.querySelector<HTMLElement>(
        `[data-config-key="${CSS.escape(focusKey)}"]`,
      );
      if (!row) return;
      row.scrollIntoView({ block: "center" });
      row.setAttribute("data-focused", "true");
      row.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
      window.setTimeout(() => row.removeAttribute("data-focused"), 2500);
    }, 0);
    return () => window.clearTimeout(id);
  }, [focusKey, loading, schema, only]);

  if (loading) {
    return <p className="p-4 text-sm text-[color:var(--muted)]">Loading {label}…</p>;
  }
  if (loadError) {
    return (
      <div role="alert" className="text-status-error p-4 text-sm">
        Failed to load <span className="font-mono">{label}</span>: {loadError}
      </div>
    );
  }
  if (!schema || !serverDoc) {
    return null;
  }

  // The fold is decided on everything the component serves, THEN the
  // section's share is taken -- so a topic page and the component's own
  // page fold the same fields. The wizard's flag and the two dead
  // appearance knobs are shown nowhere.
  const all = configGroups(
    schema.component,
    schema.fields.filter((f) => !HIDDEN_KEYS.has(f.key) && isFieldVisible(f, draft, schema.fields)),
  );
  const inScope = (f: ConfigFieldDef) => !only || only.includes(f.key);
  const relevant = (f: ConfigFieldDef) =>
    (matchedKeys === undefined || matchedKeys.includes(f.key)) &&
    matchesQuery(
      query,
      fieldSearchTexts(f, {
        topic: "",
        owner: label,
        categoryLabel: schema.categories?.[f.category ?? ""],
      }),
    );
  const urgent = (f: ConfigFieldDef) =>
    Boolean(refusedMessages[f.key]) ||
    needsAttention(fieldForRender(f, draft, serverDoc), draft[f.key]);
  const shown = (f: ConfigFieldDef) =>
    inScope(f) && (relevant(f) || dirtyKeys.has(f.key) || urgent(f) || f.key === focusKey);
  const groups = {
    common: [...all.common, ...all.more.filter(urgent)].filter(shown),
    more: all.more.filter((f) => !urgent(f) && shown(f)),
  };
  const searching = Boolean(query.trim() || matchedKeys);
  const detailsOpen = showMore || searching;
  const categories = schema.categories ?? {};
  const hiddenChanges = groups.more.filter((f) => dirtyKeys.has(f.key)).length;
  const dirtyInScope = [...dirtyKeys].filter((k) => !only || only.includes(k)).length;
  // A compact section names its category only where it spans two: one
  // heading under a card that already says the topic is a caption.
  const spanned = new Set([...groups.common, ...groups.more].map((f) => f.category));
  const showCategoryHeadings = !compact || spanned.size > 1;

  function renderCategories(fields: ConfigFieldDef[]) {
    return Object.entries(groupByCategory(fields)).map(([category, entries]) => (
      <section key={category} className={compact ? "mb-3" : "section-panel mb-4"}>
        {showCategoryHeadings && (
          <h3 className="mb-2 font-mono text-xs tracking-wider text-[color:var(--muted)] uppercase">
            {categories[category] ?? category}
          </h3>
        )}
        {entries.map((f) => (
          <ConfigFieldInput
            key={f.key}
            field={fieldForRender(f, draft, serverDoc!)}
            value={draft[f.key]}
            savedValue={(serverDoc as Record<string, unknown>)[f.key]}
            error={refusedMessages[f.key] ?? null}
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

  const discardButton = (
    <ConfirmButton
      label="Discard"
      confirmLabel="Discard changes"
      prompt="Put every field back as it was saved?"
      onConfirm={discard}
      disabled={saving}
      testId="config-discard"
      className="action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30"
    />
  );
  const testButton = ends.canTest && (
    <button
      type="button"
      onClick={test}
      disabled={testing || saving}
      title="Test the current draft against the running services without committing it."
      className="action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[color:var(--border)] disabled:hover:bg-transparent"
    >
      {testing ? "Testing…" : "Test"}
    </button>
  );
  const saveButton = (
    <button
      type="button"
      onClick={() => void save()}
      disabled={dirtyKeys.size === 0 || saving}
      className="action-button action-button--primary font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:brightness-100"
    >
      {saving ? "Saving…" : restartDirty ? "Save and restart" : "Save"}
    </button>
  );
  // Said before the click, not after (CX7): the save restarts the process
  // at once, and a gateway's restart ends every answer an app is reading.
  const restartNote = restartDirty && (
    <span className="text-sm text-[color:var(--muted)]" data-testid="restart-note">
      {restartNoteText(label, schema?.component)}
    </span>
  );

  const banners = (
    <>
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
      {readBackError && (
        <div
          role="alert"
          className="status-warn border-b px-4 py-3 text-sm"
          data-testid="config-read-back-error"
        >
          {readBackError}
        </div>
      )}
      {saveStatus && <SaveStatusBanner status={saveStatus} labels={labels} />}
    </>
  );

  const body = (
    <>
      {renderCategories(groups.common)}
      {groups.more.length > 0 && (
        <div className="border-t border-[color:var(--border)] pt-3">
          <button
            type="button"
            aria-expanded={detailsOpen}
            aria-controls={moreId}
            onClick={() => setShowMore(!detailsOpen)}
            disabled={searching}
            className="action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2 text-sm"
          >
            {detailsOpen ? "Hide customization" : "Customize"} · {groups.more.length}{" "}
            {groups.more.length === 1 ? "setting" : "settings"}
            {hiddenChanges > 0 && ` · ${hiddenChanges} unsaved`}
          </button>
          <p className="my-2 text-sm text-[color:var(--muted)]">
            Fine-tune these settings when you need more control.
          </p>
          {!detailsOpen && (
            <ul className="mb-3 space-y-2 text-sm" aria-label="Current custom settings">
              {groups.more
                .filter((f) => isCustomized(f, draft[f.key]) || dirtyKeys.has(f.key) || f.status)
                .map((f) => (
                  <li key={f.key} className="break-words">
                    <span className="font-medium">{f.label}</span>
                    {" — "}
                    {settingSummary(f, draft[f.key])}
                    <span className="text-[color:var(--muted)]">
                      {dirtyKeys.has(f.key)
                        ? " · Unsaved"
                        : isCustomized(f, draft[f.key])
                          ? " · Customized"
                          : ""}
                    </span>
                    {f.status && <p className="text-[color:var(--muted)]">{f.status.text}</p>}
                  </li>
                ))}
            </ul>
          )}
          <div id={moreId} hidden={!detailsOpen}>
            {renderCategories(groups.more)}
          </div>
        </div>
      )}
    </>
  );

  if (compact) {
    // A section of a topic card: the owner's name, the fields, and the
    // buttons only while there is something for them to do. A dirty count
    // elsewhere in the component (another section's edits) is not this
    // section's to report, so the count is of the fields it shows.
    return (
      <div
        ref={rootRef}
        data-testid="settings-section"
        data-target={target}
        data-dirty={dirtyInScope}
        className="section-inset flex flex-col"
      >
        <div className="section-heading flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-ui text-sm font-semibold" title={hint}>
            {label}
          </h3>
          {dirtyInScope > 0 && (
            <div className="flex items-center gap-2" data-testid="section-actions">
              <span className="text-sm text-[color:var(--muted)]">{dirtyInScope} unsaved</span>
              {discardButton}
              {testButton}
              {restartNote}
              {saveButton}
            </div>
          )}
        </div>
        {banners}
        {body}
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

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{label}</h2>
          <p className="text-[0.6875rem] text-[color:var(--muted)]">{schema.component}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[color:var(--muted)]">
            {dirtyKeys.size === 0
              ? "no changes"
              : `${dirtyKeys.size} ${dirtyKeys.size === 1 ? "change" : "changes"}`}
          </span>
          {dirtyKeys.size > 0 && discardButton}
          {testButton}
          {restartNote}
          {saveButton}
        </div>
      </header>

      {banners}

      <div className="flex-1 overflow-y-auto p-4">
        <label className="mb-4 block text-sm">
          Find a setting
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search names, descriptions or config keys"
            className="mt-1 w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2"
          />
        </label>
        {groups.common.length + groups.more.length === 0 && query.trim() && (
          <p role="status">No settings match “{query}”.</p>
        )}
        {body}
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
    <ModalScrim
      labelledBy="restart-progress-heading"
      onEscape={dismissable ? onDismiss : undefined}
    >
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
            className="action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
          >
            Close
          </button>
        </div>
      )}
    </ModalScrim>
  );
}

/**
 * A modal that behaves like one: focus moves in when it opens, Tab stays
 * inside, Escape closes it when there is something to close, and focus
 * goes back to where it was. It used to be a box drawn over the page with
 * focus left behind it, so a keyboard user tabbed through a form they
 * could not see.
 */
function ModalScrim({
  children,
  labelledBy,
  onEscape,
}: {
  children: React.ReactNode;
  labelledBy: string;
  /** Absent while the dialog cannot be closed (a restart in flight). */
  onEscape?: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      if (onEscape) {
        e.preventDefault();
        onEscape();
      }
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const items = Array.from(
      ref.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
      ),
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      e.preventDefault();
      return;
    }
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        ref={ref}
        tabIndex={-1}
        onKeyDown={onKeyDown}
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
    // A state, not help: said beside the control, so it never lands behind
    // the description's "More".
    status: {
      level: "warning",
      text: "Provider has changed; the list refreshes after Save and restart. Type a model name, or leave it blank for the new provider's default.",
    },
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
          className="action-button font-ui w-fit rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Deleting…" : "Delete the local copies"}
        </button>
        <p className="text-sm text-[color:var(--muted)]">
          Copies are made again the next time these models start. Turn the option off first if you
          want the space to stay free.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-status-error text-sm">
          {error}
        </p>
      )}
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

/**
 * The line beside "Save and restart" (CX7). A gateway's restart is the one
 * that stops apps mid-answer, so it alone says so.
 */
export function restartNoteText(label: string, component?: string | null): string {
  return component === "gateway"
    ? `Restarts ${label}. Answers that apps are reading stop.`
    : `Restarts ${label}.`;
}
