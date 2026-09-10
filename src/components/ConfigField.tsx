"use client";

import { useEffect, useRef, useState } from "react";

import type { Component, ConfigField as ConfigFieldDef } from "@/lib/types";

/**
 * Render a single config field's input based on its `valueType`.
 *
 * A component's own `/v1/config/schema` carries everything needed to
 * drive the UI: label, description, default, valueType, validation
 * hints, sensitive flag, restart-required flag. This is the
 * OpenClaw-mistake fix made concrete — no per-component UI code, the
 * form follows the schema. Adding a knob to a component is a
 * server-side change only.
 */
export function ConfigFieldInput({
  field,
  value,
  pending,
  topology,
  onChange,
}: {
  field: ConfigFieldDef;
  value: unknown;
  pending: boolean;
  /** Current agent topology snapshot — used to render
   * `componentKindHint`-bearing fields as dropdowns. Null while
   * loading or when the parent decided not to fetch (e.g. the schema
   * has no peer-reference fields). The dropdown falls back to a free-
   * text URL input when topology is unavailable. */
  topology?: Component[] | null;
  onChange: (newValue: unknown) => void;
}) {
  const baseInputClass =
    "w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none transition-colors hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[color:var(--border)]";

  function renderInput() {
    if (field.valueType === "boolean") {
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          disabled={pending}
          className="h-4 w-4 align-middle"
        />
      );
    }

    if (field.valueType === "enum" && field.enumValues) {
      const labels = field.enumLabels ?? [];
      return (
        <select
          value={(value as string | undefined) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={pending}
          className={baseInputClass}
        >
          {field.enumValues.map((v, i) => (
            <option key={v} value={v}>
              {/* "" in enumValues is the "(use default)" sentinel for
                  the modelId field; show it as a friendly label. */}
              {v === "" ? "(use adapter default)" : (labels[i] ?? v)}
            </option>
          ))}
        </select>
      );
    }

    if (
      field.valueType === "integer" ||
      field.valueType === "number" ||
      field.valueType === "duration"
    ) {
      return (
        <input
          type="number"
          value={(value as number | string | undefined) ?? ""}
          step={field.valueType === "integer" ? 1 : "any"}
          min={field.minimum ?? undefined}
          max={field.maximum ?? undefined}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange(null);
              return;
            }
            const parsed = field.valueType === "integer" ? parseInt(raw, 10) : parseFloat(raw);
            onChange(Number.isFinite(parsed) ? parsed : null);
          }}
          disabled={pending}
          className={baseInputClass}
        />
      );
    }

    if (field.valueType === "secret") {
      return (
        <input
          type="password"
          value={(value as string | undefined) ?? ""}
          placeholder={value === "<redacted>" ? "<redacted — type to overwrite>" : ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={pending}
          className={baseInputClass}
        />
      );
    }

    // An ordered list of directory paths — the library's model roots are
    // the only user so far. Rendered as an add/remove list rather than a
    // text field because asking someone to comma-separate Windows paths
    // is asking for a bug report, and because the order is meaningful:
    // it is the order the operator sees, and M3's downloader offers the
    // first entry as the default destination.
    if (field.valueType === "path_list") {
      return (
        <StringListInput
          value={Array.isArray(value) ? (value as unknown[]).map(String) : []}
          pending={pending}
          onChange={onChange}
          copy={PATH_LIST_COPY}
        />
      );
    }

    // `url_list` is the same widget with different words: an ordered
    // add/remove list of strings. Added at M5 for the control root's
    // standby endpoints, which are inherently plural — "N standbys is a
    // configuration, not a mechanism" — and which would otherwise fall
    // through to the text input below and render a JSON array in a
    // single-line box.
    //
    // One editor parameterized rather than two that look alike: a
    // second near-identical list component is how the two drift, and
    // the difference between them is genuinely only the copy.
    if (field.valueType === "url_list") {
      return (
        <StringListInput
          value={Array.isArray(value) ? (value as unknown[]).map(String) : []}
          pending={pending}
          onChange={onChange}
          copy={URL_LIST_COPY}
        />
      );
    }

    // `model_slots` (M6): the gateway's priority lists, an ordered array
    // of `{model, targets}`. Edited as JSON in a textarea for now — the
    // design names a structured editor as the UI gap it is. Parsed on
    // every keystroke; a parse error is shown and nothing is sent, so a
    // half-typed list never reaches the server as a rejected patch.
    if (field.valueType === "model_slots") {
      return <ModelSlotsInput value={value} pending={pending} onChange={onChange} />;
    }

    // Peer-reference dropdown: a `componentKindHint` tells us this
    // field points at a agent topology entry of the given kind.
    // Render as a dropdown sourced from the live topology so the
    // operator doesn't have to copy URLs by hand. The wire value is
    // still the peer's URL — the hint only changes the input UX.
    //
    // For a single-instance kind (the gateway) the dropdown is
    // effectively an on/off toggle: `(off)` + the one peer. For a
    // multi-instance kind (inference-driver, one per backend) the
    // operator picks one.
    //
    // Falls back to a free-text URL input when topology is null —
    // either still loading, or the agent fetch failed. Better to
    // let the operator type a URL by hand than block them entirely.
    if (field.componentKindHint && topology != null) {
      const matches = topology.filter(
        (c) => c.kind === field.componentKindHint && typeof c.url === "string",
      );
      const currentUrl = typeof value === "string" ? value : "";
      const currentNorm = normalizeUrl(currentUrl);
      const savedKnown =
        currentNorm === "" || matches.some((m) => normalizeUrl(m.url) === currentNorm);
      return (
        <select
          value={currentNorm}
          onChange={(e) => onChange(e.target.value)}
          disabled={pending}
          className={baseInputClass}
        >
          <option value="">(off)</option>
          {matches.map((c) => (
            <option key={c.name} value={normalizeUrl(c.url)}>
              {c.name}
            </option>
          ))}
          {!savedKnown && (
            // The saved URL doesn't match any current topology entry —
            // surface it as a synthetic option so the operator can see
            // what's stored AND change it. Without this branch the
            // dropdown would silently render with no selection while
            // the saved value sits invisibly in state.
            <option value={currentNorm}>(unknown: {currentNorm})</option>
          )}
        </select>
      );
    }

    // string, url, file_path. When the field carries `suggestions`,
    // render a combobox (text input + native datalist dropdown) so the
    // operator can either pick a discovered value or paste an
    // arbitrary one. `modelId` uses this for live-discovered model
    // ids that may not include something the operator just pulled.
    const suggestions = field.suggestions ?? [];
    const datalistId = suggestions.length > 0 ? `cf-${field.key}-suggestions` : undefined;
    return (
      <>
        <input
          type="text"
          value={(value as string | undefined) ?? ""}
          pattern={field.pattern ?? undefined}
          list={datalistId}
          onChange={(e) => onChange(e.target.value)}
          disabled={pending}
          className={baseInputClass}
        />
        {datalistId && (
          <datalist id={datalistId}>
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        )}
      </>
    );
  }

  return (
    <div className="grid grid-cols-[200px_1fr] items-start gap-4 border-b border-[color:var(--border)] py-3">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium">
          {field.label}
          {field.required && <span className="text-status-error ml-1">*</span>}
        </label>
        <code className="font-mono text-[10px] text-[color:var(--muted)]">{field.key}</code>
        {field.requiresRestart && (
          <span className="status-warn w-fit rounded-[var(--radius)] px-1.5 py-0.5 text-[9px] tracking-wider uppercase">
            restart required
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {renderInput()}
        {field.description && (
          <p className="text-xs leading-relaxed text-[color:var(--muted)]">{field.description}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Topology URLs come back with a trailing slash (pydantic's AnyUrl
 * normalises them that way) while a saved peer reference usually
 * doesn't. Strip it on both sides so "http://x:1/" and "http://x:1"
 * don't render as different selections.
 */
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/** The words that differ between a list of paths and a list of URLs. */
type ListCopy = {
  empty: string;
  placeholder: string;
  addLabel: string;
  removeTitle: string;
  /** Monospace suits a filesystem path; a URL reads better without it. */
  mono: boolean;
};

const PATH_LIST_COPY: ListCopy = {
  empty:
    "No directories yet. Point this at wherever you already keep models — nothing is moved or renamed.",
  placeholder: "D:\\models",
  addLabel: "add directory",
  removeTitle: "Stop scanning this directory. The files in it are untouched.",
  mono: true,
};

const URL_LIST_COPY: ListCopy = {
  empty:
    "No standbys yet. A standby replicates this root's log and can be promoted if this host is not coming back — none is required, and more than one is a configuration rather than a mechanism.",
  placeholder: "http://other-host:8083",
  addLabel: "add address",
  removeTitle: "Stop replicating to this address. Nothing on that host is touched.",
  mono: false,
};

/**
 * Editor for an ordered list of strings — `path_list` and `url_list`.
 *
 * Rows are keyed by index deliberately. Entries are edited in place and
 * the list is short; a synthetic id would have to survive a round-trip
 * through a plain `string[]` on the wire, which it cannot.
 *
 * Empty rows are kept in local state while typing and stripped on the
 * way out, so adding a row doesn't immediately produce a validation
 * error for an entry the operator hasn't finished typing. The server
 * rejects duplicates rather than silently de-duplicating them — two
 * spellings of one directory would scan it twice, two spellings of one
 * standby would report it twice, and dropping one of the operator's
 * entries without saying so is worse than an error either way.
 */
/**
 * Editor for `model_slots`: the JSON array itself, with a parse check.
 *
 * Deliberately not a structured form yet. A slot is `{model, targets[]}`
 * and the server validates every entry with a message that names the
 * line; a textarea that shows the array as the server holds it, and
 * refuses to send what does not parse, is honest and small. The
 * structured editor is a `ui` change with no contract consequence.
 */
function ModelSlotsInput({
  value,
  pending,
  onChange,
}: {
  value: unknown;
  pending: boolean;
  onChange: (newValue: unknown) => void;
}) {
  const serialized = JSON.stringify(Array.isArray(value) ? value : [], null, 2);
  const [text, setText] = useState<string>(serialized);
  const [parseError, setParseError] = useState<string | null>(null);
  const mirrored = useRef<string>(serialized);

  useEffect(() => {
    if (serialized !== mirrored.current) {
      mirrored.current = serialized;
      setText(serialized);
      setParseError(null);
    }
  }, [serialized]);

  return (
    <div className="space-y-1">
      <textarea
        value={text}
        rows={Math.min(14, Math.max(4, text.split("\n").length + 1))}
        spellCheck={false}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          try {
            const parsed: unknown = JSON.parse(next);
            if (!Array.isArray(parsed)) {
              setParseError("must be a JSON array of {model, targets} entries");
              return;
            }
            setParseError(null);
            mirrored.current = JSON.stringify(parsed, null, 2);
            onChange(parsed);
          } catch (err) {
            setParseError(err instanceof Error ? err.message : String(err));
          }
        }}
        className="w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 font-mono text-xs transition-colors outline-none hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)] disabled:cursor-not-allowed disabled:opacity-50"
      />
      <p className="text-xs leading-relaxed text-[color:var(--muted)]">
        One entry per name a client may ask for:{" "}
        <span className="font-mono">
          {'{"model": "coder", "targets": ["qwen3-coder-30b", "claude-opus-4-7"]}'}
        </span>
        . Targets are model ids — each one is every replica serving it — tried in order after the
        model&rsquo;s own drivers.
      </p>
      {parseError && <p className="status-error text-xs">Not saved: {parseError}</p>}
    </div>
  );
}

function StringListInput({
  value,
  pending,
  onChange,
  copy,
}: {
  value: string[];
  pending: boolean;
  onChange: (newValue: unknown) => void;
  copy: ListCopy;
}) {
  // Rows live here, empties included, so a freshly added row survives
  // until it is typed into. The parent only ever sees trimmed, non-empty
  // paths — propagating an empty string would make "add directory"
  // immediately produce a validation error for a path nobody has
  // finished typing.
  const [rows, setRows] = useState<string[]>(value);
  const mirrored = useRef<string>(JSON.stringify(value));

  // Resync when the value changes from outside: a reload after save, or
  // a revert. Compared against what we last pushed up, so our own
  // round-trips don't clobber a half-typed row.
  useEffect(() => {
    const incoming = JSON.stringify(value);
    if (incoming !== mirrored.current) {
      mirrored.current = incoming;
      setRows(value);
    }
  }, [value]);

  function update(next: string[]) {
    setRows(next);
    const cleaned = next.map((p) => p.trim()).filter((p) => p.length > 0);
    mirrored.current = JSON.stringify(cleaned);
    onChange(cleaned);
  }

  const rowClass = `flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 ${
    copy.mono ? "font-mono text-xs" : "text-sm"
  } outline-none transition-colors hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)] disabled:cursor-not-allowed disabled:opacity-50`;
  const buttonClass =
    "font-ui shrink-0 rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";

  return (
    <div className="flex flex-col gap-2">
      {rows.length === 0 && (
        <p className="text-xs text-[color:var(--muted)] italic">{copy.empty}</p>
      )}
      {rows.map((path, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            type="text"
            value={path}
            spellCheck={false}
            placeholder={copy.placeholder}
            onChange={(e) => {
              const next = [...rows];
              next[index] = e.target.value;
              update(next);
            }}
            disabled={pending}
            className={rowClass}
          />
          <button
            type="button"
            onClick={() => update(rows.filter((_, i) => i !== index))}
            disabled={pending}
            className={buttonClass}
            title={copy.removeTitle}
          >
            remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setRows([...rows, ""])}
        disabled={pending}
        className={`${buttonClass} w-fit`}
      >
        {copy.addLabel}
      </button>
    </div>
  );
}
