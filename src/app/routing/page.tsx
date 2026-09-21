"use client";

/**
 * The gateway's priority lists, as their own page.
 *
 * `modelSlots` was the last `ConfigValueType` still edited as raw JSON in
 * the generic Config form, and the one whose real failure mode was never
 * malformed JSON — it was a **misspelled target**, which the gateway
 * accepts, resolves to an empty tier, and fails silently at request time.
 * So this page's two jobs, in order:
 *
 * 1. **Pick, don't type.** Every model-id input carries a datalist of the
 *    ids the routing table knows. Free text stays allowed — a target may
 *    name a model that is not launched yet, deliberately — but anything
 *    nothing serves is flagged on its own row, at edit time.
 * 2. **Show what each entry resolves to right now**, off the same
 *    `GET /v1/admin/routing` snapshot requests are routed from. The
 *    implicit self tier renders as a fixed first row so the mental model
 *    matches the routing semantics: a list's own drivers are tried first,
 *    and only a purely virtual alias starts at its first target (R3.3).
 *
 * Reordering is move up / move down buttons, not drag and drop: the lists
 * are 2–4 entries long, buttons are keyboard-accessible for free, they
 * work at 430px, and they are testable without simulating drags.
 *
 * A dedicated page rather than a Config field because these lists grow
 * with the install — the Config form stays a form, and this page gets a
 * filter. The Config page's `modelSlots` row links here and this page
 * links back (`cross-link-related-settings`). The JSON view survives as
 * the expert override, and is also the fallback when the stored value
 * does not parse into slots.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ApiError, api, describeError } from "@/lib/api";
import {
  addSlot,
  addTarget,
  knownModelIds,
  moveTarget,
  parseModelSlots,
  removeSlot,
  removeTarget,
  renameSlot,
  resolveTarget,
  selfTier,
  serializeModelSlots,
  setTarget,
  slotProblems,
  slotWarnings,
  slotsEqual,
  unconfiguredServedModels,
  type ModelSlot,
} from "@/lib/modelSlots";
import type { ConfigUpdateResult, RoutingTableView } from "@/lib/types";

const DATALIST_ID = "routing-known-models";

const inputClass =
  "rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-1.5 font-mono text-sm transition-colors outline-none hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)] disabled:cursor-not-allowed disabled:opacity-50";

const smallButtonClass =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40";

interface SaveState {
  applied: string[];
  rejected: { key?: string; message?: string }[];
  requiresRestart: boolean;
}

export default function RoutingPage() {
  const [serverSlots, setServerSlots] = useState<ModelSlot[]>([]);
  const [rawValue, setRawValue] = useState<unknown>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ModelSlot[]>([]);
  const [routing, setRouting] = useState<RoutingTableView | null>(null);
  const [routingError, setRoutingError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<SaveState | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [newListName, setNewListName] = useState("");

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const doc = await api.get<Record<string, unknown>>("gateway", "/v1/config");
      const parsed = parseModelSlots(doc.modelSlots);
      setRawValue(doc.modelSlots ?? []);
      setParseError(parsed.error);
      setServerSlots(parsed.slots);
      setDraft(parsed.slots.map((s) => ({ ...s, targets: [...s.targets] })));
    } catch (e) {
      setLoadError(describeError(e));
    }
    // The routing table is the resolution overlay, never the subject: the
    // page must keep editing config when the table is missing (safe mode
    // answers 503), so its failure is soft and named.
    try {
      const table = await api.get<RoutingTableView>("gateway", "/v1/admin/routing");
      setRouting(table);
      setRoutingError(null);
    } catch (e) {
      setRouting(null);
      setRoutingError(
        e instanceof ApiError && e.status === 503
          ? "The gateway is in safe mode, so there is no routing table to read — the lists are still editable."
          : describeError(e),
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const problems = useMemo(() => slotProblems(draft), [draft]);
  const warnings = useMemo(() => slotWarnings(draft), [draft]);
  const dirty = useMemo(() => !slotsEqual(draft, serverSlots), [draft, serverSlots]);
  const known = useMemo(() => knownModelIds(routing), [routing]);
  const unconfigured = useMemo(() => unconfiguredServedModels(routing, draft), [routing, draft]);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    setSaveState(null);
    try {
      const result = await api.patch<ConfigUpdateResult>("gateway", "/v1/config", {
        modelSlots: serializeModelSlots(draft),
      });
      setSaveState({
        applied: result.applied ?? [],
        rejected: (result.rejected ?? []) as SaveState["rejected"],
        requiresRestart: Boolean(result.requiresRestart),
      });
      if (!result.rejected || result.rejected.length === 0) {
        await load();
      }
    } catch (e) {
      setSaveError(describeError(e));
    } finally {
      setSaving(false);
    }
  }, [draft, load]);

  const revert = useCallback(() => {
    setDraft(serverSlots.map((s) => ({ ...s, targets: [...s.targets] })));
    setSaveState(null);
    setSaveError(null);
  }, [serverSlots]);

  const addList = useCallback(
    (model: string) => {
      const name = model.trim();
      if (!name) return;
      if (draft.some((s) => s.model.trim() === name)) return;
      setDraft((d) => addSlot(d, name));
      setNewListName("");
    },
    [draft],
  );

  // Filter by name or target, keeping original indices so the edit ops
  // land on the right list whatever is hidden.
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return draft
      .map((slot, index) => ({ slot, index }))
      .filter(
        ({ slot }) =>
          !needle ||
          slot.model.toLowerCase().includes(needle) ||
          slot.targets.some((t) => t.toLowerCase().includes(needle)),
      );
  }, [draft, filter]);

  return (
    <AppShell
      controls={
        <button type="button" onClick={() => void load()} className={smallButtonClass}>
          Refresh
        </button>
      }
    >
      <main className="relative z-10 mx-auto max-w-4xl px-6 py-8">
        <p className="mb-2 text-sm text-[color:var(--muted)]">
          A priority list gives one model name an ordered set of fallbacks: a request for the name
          is served by its own backends first, then by each target in order when everything before
          it failed. Targets are model ids — each one means every backend serving that id.
        </p>
        <p className="mb-6 text-sm text-[color:var(--muted)]">
          These lists are the gateway&rsquo;s <span className="font-mono">modelSlots</span> setting
          — the rest of its settings are on{" "}
          <Link href="/config?tab=gateway&sel=gateway" className="underline">
            the gateway&rsquo;s Config page
          </Link>
          . What is actually running is on{" "}
          <Link href="/inference" className="underline">
            Inference
          </Link>
          ; which tier served each request is on{" "}
          <Link href="/metrics?sel=gateway" className="underline">
            Metrics
          </Link>
          .
        </p>

        {loading && <p className="font-ui text-sm text-[color:var(--muted)]">Loading…</p>}

        {loadError && (
          <p className="status-error mb-4 text-sm" data-testid="routing-load-error">
            {loadError}
          </p>
        )}

        {!loading && !loadError && (
          <>
            {routingError && (
              <p
                className="mb-4 text-sm text-[color:var(--muted)]"
                data-testid="routing-soft-error"
              >
                {routingError}
              </p>
            )}

            <datalist id={DATALIST_ID}>
              {known.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>

            {parseError ? (
              <section className="mb-6 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-4">
                <p className="status-error mb-2 text-sm" data-testid="slots-parse-error">
                  The stored value does not parse into lists: {parseError}. Fix it as JSON below —
                  the structured editor would have to guess which entries to keep.
                </p>
                <JsonEditor slots={draft} onApply={setDraft} disabled={saving} raw={rawValue} />
              </section>
            ) : (
              <>
                {draft.length > 5 && (
                  <div className="mb-4">
                    <input
                      type="search"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="Filter lists by model or target"
                      aria-label="Filter lists by model or target"
                      className={`${inputClass} w-full max-w-sm`}
                    />
                  </div>
                )}

                {draft.length === 0 && (
                  <p className="mb-4 text-sm text-[color:var(--muted)]" data-testid="no-slots">
                    No priority lists yet. Without one, a request is served only by the backends
                    serving the exact model it asked for — add a list to give a model fallbacks.
                  </p>
                )}

                <div className="space-y-4">
                  {visible.map(({ slot, index }) => (
                    <SlotCard
                      key={index}
                      slot={slot}
                      routing={routing}
                      disabled={saving}
                      onRename={(name) => setDraft((d) => renameSlot(d, index, name))}
                      onRemove={() => setDraft((d) => removeSlot(d, index))}
                      onSetTarget={(j, id) => setDraft((d) => setTarget(d, index, j, id))}
                      onMoveTarget={(j, delta) => setDraft((d) => moveTarget(d, index, j, delta))}
                      onRemoveTarget={(j) => setDraft((d) => removeTarget(d, index, j))}
                      onAddTarget={(id) => setDraft((d) => addTarget(d, index, id))}
                    />
                  ))}
                </div>

                {filter.trim() && visible.length === 0 && draft.length > 0 && (
                  <p className="text-sm text-[color:var(--muted)]">
                    Nothing matches &ldquo;{filter.trim()}&rdquo;.
                  </p>
                )}

                <section className="mt-6 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-4">
                  <h2 className="font-ui mb-2 text-base font-semibold">Add a priority list</h2>
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      addList(newListName);
                    }}
                  >
                    <input
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      list={DATALIST_ID}
                      placeholder="model name clients ask for"
                      aria-label="Model name for the new list"
                      disabled={saving}
                      className={`${inputClass} w-64 max-w-full`}
                    />
                    <button
                      type="submit"
                      disabled={
                        saving ||
                        !newListName.trim() ||
                        draft.some((s) => s.model.trim() === newListName.trim())
                      }
                      className={smallButtonClass}
                    >
                      Add list
                    </button>
                    {draft.some((s) => s.model.trim() === newListName.trim()) &&
                      newListName.trim() && (
                        <span className="text-sm text-[color:var(--muted)]">
                          &ldquo;{newListName.trim()}&rdquo; already has a list.
                        </span>
                      )}
                  </form>
                  {unconfigured.length > 0 && (
                    <div className="mt-3">
                      <p className="mb-1 text-sm text-[color:var(--muted)]">
                        Running now with no fallbacks configured:
                      </p>
                      <ul className="flex flex-wrap gap-2">
                        {unconfigured.map((model) => (
                          <li key={model}>
                            <button
                              type="button"
                              onClick={() => addList(model)}
                              disabled={saving}
                              className={`${smallButtonClass} font-mono`}
                              title={`Add a priority list for ${model}`}
                            >
                              {model} +
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              </>
            )}

            {warnings.length > 0 && (
              <ul className="mt-4 space-y-1" data-testid="slot-warnings">
                {warnings.map((w) => (
                  <li key={w} className="text-sm text-[color:var(--status-warn-fg)]">
                    ⚠ {w}
                  </li>
                ))}
              </ul>
            )}

            {problems.length > 0 && (
              <ul className="mt-4 space-y-1" data-testid="slot-problems">
                {problems.map((p) => (
                  <li key={p} className="status-error text-sm">
                    {p}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !dirty || problems.length > 0}
                className="font-ui rounded-[var(--radius)] border border-[color:var(--accent-left)] px-4 py-1.5 text-sm font-semibold transition-colors hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={revert}
                disabled={saving || !dirty}
                className={smallButtonClass}
              >
                Revert
              </button>
              {!dirty && !saveState && !saveError && (
                <span className="text-sm text-[color:var(--muted)]">No unsaved changes.</span>
              )}
            </div>

            {saveError && (
              <p className="status-error mt-3 text-sm" data-testid="save-error">
                Not saved: {saveError}
              </p>
            )}
            {saveState && saveState.rejected.length > 0 && (
              <ul className="mt-3 space-y-1" data-testid="save-rejected">
                {saveState.rejected.map((r, i) => (
                  <li key={i} className="status-error text-sm">
                    Not saved: {r.message ?? "rejected"}
                  </li>
                ))}
              </ul>
            )}
            {saveState && saveState.rejected.length === 0 && (
              <p className="mt-3 text-sm text-[color:var(--muted)]" data-testid="save-applied">
                Saved. The gateway reads the lists on its next routing refresh
                {saveState.requiresRestart ? " — and reports a restart is required" : ""}.
              </p>
            )}

            {!parseError && (
              <details className="mt-8">
                <summary className="font-ui cursor-pointer text-sm text-[color:var(--muted)]">
                  Edit as JSON
                </summary>
                <div className="mt-2">
                  <JsonEditor slots={draft} onApply={setDraft} disabled={saving} raw={null} />
                </div>
              </details>
            )}
          </>
        )}
      </main>
    </AppShell>
  );
}

/* ───────────────────────────── slot card ────────────────────────────── */

function SlotCard({
  slot,
  routing,
  disabled,
  onRename,
  onRemove,
  onSetTarget,
  onMoveTarget,
  onRemoveTarget,
  onAddTarget,
}: {
  slot: ModelSlot;
  routing: RoutingTableView | null;
  disabled: boolean;
  onRename: (name: string) => void;
  onRemove: () => void;
  onSetTarget: (targetIndex: number, id: string) => void;
  onMoveTarget: (targetIndex: number, delta: -1 | 1) => void;
  onRemoveTarget: (targetIndex: number) => void;
  onAddTarget: (id: string) => void;
}) {
  const [newTarget, setNewTarget] = useState("");
  const self = selfTier(routing, slot.model);

  return (
    <section
      data-testid="routing-slot"
      className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-4"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={slot.model}
          onChange={(e) => onRename(e.target.value)}
          list={DATALIST_ID}
          aria-label="Model name this list answers for"
          disabled={disabled}
          className={`${inputClass} w-64 max-w-full font-semibold`}
        />
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className={smallButtonClass}
          title="Remove this list. The models themselves are untouched — requests for this name just stop cascading."
        >
          Remove list
        </button>
      </div>

      <ol className="space-y-2">
        <li
          data-testid="self-tier"
          className="flex flex-wrap items-baseline gap-2 rounded-[var(--radius)] border border-dashed border-[color:var(--border)] px-3 py-2"
        >
          <span className="font-ui text-xs text-[color:var(--muted)]">tried first</span>
          <span className="font-mono text-sm">{slot.model.trim() || "…"}</span>
          <SelfResolutionLine self={self} />
        </li>
        {slot.targets.map((target, j) => (
          <li
            key={j}
            data-testid="target-row"
            className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2"
          >
            <span className="font-ui text-xs text-[color:var(--muted)]">then</span>
            <input
              value={target}
              onChange={(e) => onSetTarget(j, e.target.value)}
              list={DATALIST_ID}
              aria-label={`Fallback ${j + 1} for ${slot.model}`}
              disabled={disabled}
              className={`${inputClass} w-64 max-w-full`}
            />
            <span className="flex gap-1">
              <button
                type="button"
                onClick={() => onMoveTarget(j, -1)}
                disabled={disabled || j === 0}
                aria-label={`Try ${target || "this fallback"} earlier`}
                className={smallButtonClass}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => onMoveTarget(j, 1)}
                disabled={disabled || j === slot.targets.length - 1}
                aria-label={`Try ${target || "this fallback"} later`}
                className={smallButtonClass}
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => onRemoveTarget(j)}
                disabled={disabled}
                aria-label={`Remove ${target || "this fallback"}`}
                className={smallButtonClass}
              >
                Remove
              </button>
            </span>
            <ResolutionLine resolution={resolveTarget(routing, target)} />
          </li>
        ))}
      </ol>

      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newTarget.trim()) {
            onAddTarget(newTarget);
            setNewTarget("");
          }
        }}
      >
        <input
          value={newTarget}
          onChange={(e) => setNewTarget(e.target.value)}
          list={DATALIST_ID}
          placeholder="model id to try next"
          aria-label={`Add a fallback to ${slot.model}`}
          disabled={disabled}
          className={`${inputClass} w-64 max-w-full`}
        />
        <button type="submit" disabled={disabled || !newTarget.trim()} className={smallButtonClass}>
          Add fallback
        </button>
      </form>
    </section>
  );
}

/** What the routing table says about a target id, on the row where a typo
 * would otherwise be invisible. Null routing renders nothing — "unknown"
 * must not read as "nothing serves this". */
function ResolutionLine({ resolution }: { resolution: ReturnType<typeof resolveTarget> }) {
  if (!resolution) return null;
  if (resolution.servedBy.length === 0) {
    return (
      <span className="text-sm text-[color:var(--status-warn-fg)]" data-testid="target-unserved">
        ⚠ nothing serves this right now
      </span>
    );
  }
  return (
    <span className="text-sm text-[color:var(--muted)]" data-testid="target-served">
      served by {resolution.servedBy.join(", ")}
      {resolution.eligibleCount < resolution.servedBy.length
        ? ` · ${resolution.eligibleCount} of ${resolution.servedBy.length} ready`
        : ""}
    </span>
  );
}

function SelfResolutionLine({ self }: { self: ReturnType<typeof selfTier> }) {
  if (!self) {
    return (
      <span className="text-sm text-[color:var(--muted)]">
        its own backends, before any fallback
      </span>
    );
  }
  if (!self.declared) {
    return (
      <span className="text-sm text-[color:var(--muted)]" data-testid="self-alias">
        nothing runs under this name, so it works as an alias — the first fallback below is tried
        first
      </span>
    );
  }
  return (
    <span className="text-sm text-[color:var(--muted)]" data-testid="self-served">
      served by {self.servedBy.join(", ")}
      {self.eligibleCount < self.servedBy.length
        ? ` · ${self.eligibleCount} of ${self.servedBy.length} ready`
        : ""}
    </span>
  );
}

/* ───────────────────────────── JSON view ────────────────────────────── */

/**
 * The expert override, and the fallback for a stored value that does not
 * parse into slots. Same contract as the old Config-field editor: parsed
 * on every keystroke, an error shown, and nothing applied that does not
 * parse — a half-typed list never reaches the draft.
 */
function JsonEditor({
  slots,
  onApply,
  disabled,
  raw,
}: {
  slots: ModelSlot[];
  onApply: (slots: ModelSlot[]) => void;
  disabled: boolean;
  /** The stored value, for the malformed case where `slots` is empty and
   * showing `[]` would hide what needs fixing. */
  raw: unknown;
}) {
  const serialized = JSON.stringify(
    raw !== null && raw !== undefined && slots.length === 0 ? raw : serializeModelSlots(slots),
    null,
    2,
  );
  const [text, setText] = useState(serialized);
  const [error, setError] = useState<string | null>(null);
  const mirrored = useRef(serialized);

  useEffect(() => {
    if (serialized !== mirrored.current) {
      mirrored.current = serialized;
      setText(serialized);
      setError(null);
    }
  }, [serialized]);

  return (
    <div className="space-y-1">
      <textarea
        value={text}
        rows={Math.min(20, Math.max(4, text.split("\n").length + 1))}
        spellCheck={false}
        disabled={disabled}
        aria-label="Priority lists as JSON"
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          try {
            const parsedJson: unknown = JSON.parse(next);
            const parsed = parseModelSlots(parsedJson);
            if (parsed.error) {
              setError(parsed.error);
              return;
            }
            setError(null);
            mirrored.current = JSON.stringify(serializeModelSlots(parsed.slots), null, 2);
            onApply(parsed.slots);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
        className="w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 font-mono text-xs transition-colors outline-none hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)] disabled:cursor-not-allowed disabled:opacity-50"
      />
      {error && (
        <p className="status-error text-sm" data-testid="json-error">
          Not applied: {error}
        </p>
      )}
    </div>
  );
}
