"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { FolderPicker } from "@/components/FolderPicker";
import {
  type MountShape,
  libraryFoldersHref,
  mountFor,
  parseFolders,
  shapeOf,
  withMount,
} from "@/lib/libraryReach";
import type {
  Component,
  ConfigField as ConfigFieldDef,
  LibraryFolder,
  PathMapping,
} from "@/lib/types";

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
/** One button style, shared by every editor here that has a button. */
const buttonClass =
  "font-ui shrink-0 rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";

export function ConfigFieldInput({
  field,
  value,
  pending,
  topology,
  browseTarget,
  pathSuggestions,
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
  /** The proxy target whose host a path field is about — the component
   * being edited. When set, `path_list` rows and a mapping's `to` get a
   * Browse button that lists THAT host's directories (M11). Absent, the
   * fields stay typeable and nothing is offered to browse. */
  browseTarget?: string | null;
  /** The library's configured model roots, offered as suggestions for a
   * mapping's `from` — which in every case this exists for is one. */
  pathSuggestions?: string[];
  onChange: (newValue: unknown) => void;
}) {
  const baseInputClass =
    "w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none transition-colors hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[color:var(--border)]";
  // Whether the picker is open for a single `file_path` field. Held
  // here rather than in the branch that renders it, because hooks
  // cannot live inside `renderInput`.
  const [browsingPath, setBrowsingPath] = useState(false);

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
          browseTarget={browseTarget ?? null}
        />
      );
    }

    // `library_folders` (2026-09-14): the Library's folders with their
    // mounts. The generic editor keeps a full editor for it -- GUI
    // equality -- and points at the Folders page for the per-node grid.
    if (field.valueType === "library_folders") {
      return (
        <LibraryFoldersInput
          value={value}
          pending={pending}
          onChange={onChange}
          browseTarget={browseTarget ?? null}
        />
      );
    }

    // `path_mappings` (M11; this node's OVERRIDES since 2026-09-14): where
    // this machine mounts a Library folder somewhere other than the
    // folder's own mounts say. Rows of `from` → `to`; the left side offers
    // the library's folders, the right side browses this host.
    if (field.valueType === "path_mappings") {
      return (
        <PathMappingsInput
          value={value}
          pending={pending}
          onChange={onChange}
          browseTarget={browseTarget ?? null}
          suggestions={pathSuggestions ?? []}
        />
      );
    }

    // `share_credentials` (R2.6): who this machine says it is when it
    // reaches a file server. One row per SERVER, not per share --
    // Windows allows one login per server and refuses a second (1219).
    if (field.valueType === "share_credentials") {
      return <ShareCredentialsInput value={value} pending={pending} onChange={onChange} />;
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
    // A single `file_path` gets Browse for the same reason a `path_list`
    // row does, and did not have one until a field asked for it: the
    // picker was wired into the list editors and the mapping editor
    // only. A folder someone has to type from memory is the typed path
    // the two-screen wizard exists to have removed.
    const browsable = field.valueType === "file_path" && browseTarget != null;
    return (
      <>
        <div className="flex gap-2">
          <input
            type="text"
            value={(value as string | undefined) ?? ""}
            pattern={field.pattern ?? undefined}
            list={datalistId}
            onChange={(e) => onChange(e.target.value)}
            disabled={pending}
            className={baseInputClass}
          />
          {browsable && (
            <button
              type="button"
              onClick={() => setBrowsingPath(true)}
              disabled={pending}
              className={`${buttonClass} shrink-0`}
              data-testid={`browse-${field.key}`}
            >
              Browse
            </button>
          )}
        </div>
        {browsable && browsingPath && (
          <FolderPicker
            target={browseTarget}
            initialPath={(value as string | undefined) || null}
            onClose={() => setBrowsingPath(false)}
            onPick={(path) => {
              onChange(path);
              setBrowsingPath(false);
            }}
          />
        )}
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
    <div className="grid grid-cols-1 items-start gap-2 border-b border-[color:var(--border)] py-3 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium">
          {field.label}
          {field.required && <span className="text-status-error ml-1">*</span>}
        </label>
        <code className="font-mono text-[0.625rem] text-[color:var(--muted)]">{field.key}</code>
        {field.requiresRestart && (
          <span className="status-warn w-fit rounded-[var(--radius)] px-1.5 py-0.5 text-[0.5625rem] tracking-wider uppercase">
            restart required
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {renderInput()}
        {field.description && (
          <p className="text-xs leading-relaxed text-[color:var(--muted)]">{field.description}</p>
        )}
        {field.key === "advertiseUrl" && (
          // `cross-link-related-settings` (Troy, standing): the other
          // half of this setting is Home's "Reach it from other
          // devices", which writes this field, restarts the components
          // and settles the firewall in one click. Somebody who found
          // the expert control should be told the easy one exists; a
          // half added without its link is a defect.
          <p className="text-xs text-[color:var(--muted)]">
            The one-click version of this is{" "}
            <Link href="/" className="underline">
              Reach it from other devices
            </Link>{" "}
            on Home, which also restarts what has to restart and offers to settle the firewall. What
            you type here wins over what it would have chosen.
          </p>
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
  browseTarget = null,
}: {
  value: string[];
  pending: boolean;
  onChange: (newValue: unknown) => void;
  copy: ListCopy;
  /** When set, each row gets a Browse button over this target's host. */
  browseTarget?: string | null;
}) {
  // Rows live here, empties included, so a freshly added row survives
  // until it is typed into. The parent only ever sees trimmed, non-empty
  // paths — propagating an empty string would make "add directory"
  // immediately produce a validation error for a path nobody has
  // finished typing.
  const [rows, setRows] = useState<string[]>(value);
  const mirrored = useRef<string>(JSON.stringify(value));
  // Which row's Browse is open, if any.
  const [browsing, setBrowsing] = useState<number | null>(null);

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
          {browseTarget !== null && (
            <button
              type="button"
              onClick={() => setBrowsing(index)}
              disabled={pending}
              className={buttonClass}
              title="Pick a directory on the machine this component runs on."
            >
              browse
            </button>
          )}
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
      {browsing !== null && browseTarget !== null && (
        <FolderPicker
          target={browseTarget}
          initialPath={rows[browsing] || null}
          onClose={() => setBrowsing(null)}
          onPick={(path) => {
            const next = [...rows];
            next[browsing] = path;
            update(next);
            setBrowsing(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Editor for `path_mappings` (M11): rows of `from` → `to`.
 *
 * `from` is a directory as ANOTHER machine states it — the library's
 * model root, spelled exactly as the library lists it — so the input
 * offers the library's roots as suggestions and accepts anything typed.
 * `to` is the same directory on the host this component runs on, so its
 * Browse lists that host. Both sides are kept in local state until they
 * are non-empty, the same way the list editor above keeps a half-typed
 * row: a half-filled mapping must not reach the server as a rejected
 * patch. The server validates shape (absolute on both sides, no
 * duplicate `from`) and never existence; the Test button does that,
 * against the library's real files.
 */
function PathMappingsInput({
  value,
  pending,
  onChange,
  browseTarget,
  suggestions,
}: {
  value: unknown;
  pending: boolean;
  onChange: (newValue: unknown) => void;
  browseTarget: string | null;
  suggestions: string[];
}) {
  const incoming = parseMappings(value);
  const [rows, setRows] = useState<PathMapping[]>(incoming);
  const mirrored = useRef<string>(JSON.stringify(incoming));
  const [browsing, setBrowsing] = useState<number | null>(null);

  useEffect(() => {
    const serialized = JSON.stringify(parseMappings(value));
    if (serialized !== mirrored.current) {
      mirrored.current = serialized;
      setRows(parseMappings(value));
    }
  }, [value]);

  function update(next: PathMapping[]) {
    setRows(next);
    const complete = next
      .map((m) => ({ from: m.from.trim(), to: m.to.trim() }))
      .filter((m) => m.from.length > 0 && m.to.length > 0);
    mirrored.current = JSON.stringify(complete);
    onChange(complete);
  }

  const inputClass =
    "min-w-0 flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 font-mono text-xs outline-none transition-colors hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)] disabled:cursor-not-allowed disabled:opacity-50";
  const buttonClass =
    "font-ui shrink-0 rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";
  const datalistId = suggestions.length > 0 ? "cf-path-mappings-from" : undefined;

  return (
    <div className="flex flex-col gap-2">
      {rows.length === 0 && (
        <p className="text-xs text-[color:var(--muted)] italic">
          No overrides. This machine inherits each Library folder&rsquo;s mount for its kind of
          node, set once on{" "}
          <Link
            href={libraryFoldersHref(null)}
            className="underline"
            data-testid="folder-mounts-link"
          >
            Library &rarr; Folders
          </Link>
          . Add a row only if this machine mounts a folder somewhere else.
        </p>
      )}
      {rows.map((mapping, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={mapping.from}
            list={datalistId}
            spellCheck={false}
            placeholder="/models  (the Library folder, as the Library lists it)"
            aria-label="Library folder, as the Library states it"
            onChange={(e) => {
              const next = [...rows];
              next[index] = { ...mapping, from: e.target.value };
              update(next);
            }}
            disabled={pending}
            className={inputClass}
          />
          <span className="text-xs text-[color:var(--muted)]" aria-hidden="true">
            →
          </span>
          <input
            type="text"
            value={mapping.to}
            spellCheck={false}
            placeholder="Z:\\models  (where it is on this machine)"
            aria-label="The same directory on this host"
            onChange={(e) => {
              const next = [...rows];
              next[index] = { ...mapping, to: e.target.value };
              update(next);
            }}
            disabled={pending}
            className={inputClass}
          />
          {browseTarget !== null && (
            <button
              type="button"
              onClick={() => setBrowsing(index)}
              disabled={pending}
              className={buttonClass}
              title="Pick the directory on the machine this agent runs on."
            >
              browse
            </button>
          )}
          <button
            type="button"
            onClick={() => update(rows.filter((_, i) => i !== index))}
            disabled={pending}
            className={buttonClass}
            title="Remove this override; this machine goes back to the folder's mount. Nothing on disk is touched."
          >
            remove
          </button>
        </div>
      ))}
      {datalistId && (
        <datalist id={datalistId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      <button
        type="button"
        onClick={() => setRows([...rows, { from: suggestions[0] ?? "", to: "" }])}
        disabled={pending}
        className={`${buttonClass} w-fit`}
      >
        add override
      </button>
      {browsing !== null && browseTarget !== null && (
        <FolderPicker
          target={browseTarget}
          initialPath={rows[browsing]?.to || null}
          onClose={() => setBrowsing(null)}
          onPick={(path) => {
            const next = [...rows];
            const row = next[browsing] ?? { from: "", to: "" };
            next[browsing] = { ...row, to: path };
            update(next);
            setBrowsing(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Editor for `library_folders` (2026-09-14): the Library's folders, each
 * with its path on the Library's host and its mounts -- where Linux/macOS
 * nodes and Windows nodes find the same directory. Stated once here;
 * every node inherits the mount of its kind. The Folders page renders
 * the same field as a grid against every node, with a picker per node;
 * this is the generic editor's whole-field view of it.
 */
function LibraryFoldersInput({
  value,
  pending,
  onChange,
  browseTarget,
}: {
  value: unknown;
  pending: boolean;
  onChange: (newValue: unknown) => void;
  browseTarget: string | null;
}) {
  const incoming = parseFolders(value);
  const [rows, setRows] = useState<LibraryFolder[]>(incoming);
  const mirrored = useRef<string>(JSON.stringify(incoming));
  const [browsing, setBrowsing] = useState<number | null>(null);

  useEffect(() => {
    const serialized = JSON.stringify(parseFolders(value));
    if (serialized !== mirrored.current) {
      mirrored.current = serialized;
      setRows(parseFolders(value));
    }
  }, [value]);

  function update(next: LibraryFolder[]) {
    setRows(next);
    const complete = next
      .map((f) => ({ path: f.path.trim(), mounts: (f.mounts ?? []).map((m) => m.trim()) }))
      .filter((f) => f.path.length > 0)
      .map((f) => ({ path: f.path, mounts: f.mounts.filter((m) => m.length > 0) }));
    mirrored.current = JSON.stringify(complete);
    onChange(complete);
  }

  function setMount(index: number, shape: MountShape, text: string) {
    update(rows.map((f, i) => (i === index ? withMount(f, shape, text) : f)));
  }

  const inputClass =
    "min-w-0 flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 font-mono text-xs outline-none transition-colors hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)] disabled:cursor-not-allowed disabled:opacity-50";
  const buttonClass =
    "font-ui shrink-0 rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";

  return (
    <div className="flex flex-col gap-3" data-testid="library-folders-input">
      {rows.length === 0 && (
        <p className="text-xs text-[color:var(--muted)] italic">
          No folders. Add the directory where your models already are; nothing is moved or copied.
        </p>
      )}
      <p className="text-xs text-[color:var(--muted)]">
        A folder&rsquo;s mounts cover every node of that kind. A machine that mounts a folder
        somewhere else gets an <em>override</em> of its own, under that machine on{" "}
        <Link
          href={libraryFoldersHref(null)}
          className="underline"
          data-testid="node-overrides-link"
        >
          Library &rarr; Folders
        </Link>
        , or as <em>Library folder overrides</em> in that machine&rsquo;s agent Config.
      </p>
      {rows.map((folder, index) => (
        <div
          key={index}
          className="flex flex-col gap-1.5 rounded-[var(--radius)] border border-[color:var(--border)] p-2"
        >
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={folder.path}
              spellCheck={false}
              placeholder="/models  (on the machine the Library runs on)"
              aria-label="Folder on the Library's machine"
              onChange={(e) => {
                const next = [...rows];
                next[index] = { ...folder, path: e.target.value };
                update(next);
              }}
              disabled={pending}
              className={inputClass}
            />
            {browseTarget !== null && (
              <button
                type="button"
                onClick={() => setBrowsing(index)}
                disabled={pending}
                className={buttonClass}
                title="Pick the directory on the machine the Library runs on."
              >
                browse
              </button>
            )}
            <button
              type="button"
              onClick={() => update(rows.filter((_, i) => i !== index))}
              disabled={pending}
              className={buttonClass}
              title="Stop cataloguing this folder. Nothing on disk is touched."
            >
              remove
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 pl-2 text-[0.6875rem] text-[color:var(--muted)]">
            <span className="w-full sm:w-auto">mounted on Linux/macOS nodes at</span>
            <input
              type="text"
              value={mountFor(folder, "posix") ?? ""}
              spellCheck={false}
              placeholder="/mnt/models  (blank: same path, or not reachable)"
              aria-label="Mount on Linux and macOS nodes"
              onChange={(e) => setMount(index, "posix", e.target.value)}
              disabled={pending}
              className={`${inputClass} ${
                mountFor(folder, "posix") && shapeOf(mountFor(folder, "posix") ?? "") !== "posix"
                  ? "border-[color:var(--status-error,#f85149)]"
                  : ""
              }`}
            />
            <span className="w-full sm:w-auto">on Windows nodes at</span>
            <input
              type="text"
              value={mountFor(folder, "windows") ?? ""}
              spellCheck={false}
              placeholder="\\\\NAS\\models"
              aria-label="Mount on Windows nodes"
              onChange={(e) => setMount(index, "windows", e.target.value)}
              disabled={pending}
              className={inputClass}
            />
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setRows([...rows, { path: "", mounts: [] }])}
          disabled={pending}
          className={`${buttonClass} w-fit`}
        >
          add folder
        </button>
        <a href="/library/folders?sel=library" className="text-[0.6875rem] underline">
          every node&rsquo;s view of these folders: Library → Folders
        </a>
      </div>
      {browsing !== null && browseTarget !== null && (
        <FolderPicker
          target={browseTarget}
          initialPath={rows[browsing]?.path || null}
          onClose={() => setBrowsing(null)}
          onPick={(path) => {
            const next = [...rows];
            const row = next[browsing] ?? { path: "", mounts: [] };
            next[browsing] = { ...row, path };
            update(next);
            setBrowsing(null);
          }}
        />
      )}
    </div>
  );
}

type ShareCredentialRow = { host: string; username: string; password: string | null };

/**
 * Editor for `share_credentials` (R2.6): who this machine says it is
 * when it reaches a file server.
 *
 * **The password box is the whole design problem.** `GET /v1/config`
 * redacts every password to null — a UI must never hold one — so every
 * row arrives blank in a field that already has a value on the server.
 * Rendering that as an empty password box would invite somebody to
 * "fix" it, and writing the blank back would clear a secret the install
 * needs to read its models. So:
 *
 *   * a row the server already knows shows **"saved"** and an empty box
 *     with a placeholder that says leaving it alone keeps it;
 *   * `password: null` on the wire means *keep what you have*, which is
 *     what an untouched row sends;
 *   * clearing one is an explicit **forget** button, which sends `""`.
 *
 * The three states are the agent's merge rule seen from the other side;
 * they have to agree or a password is lost at the next reboot with
 * nothing saying so.
 */
function ShareCredentialsInput({
  value,
  pending,
  onChange,
}: {
  value: unknown;
  pending: boolean;
  onChange: (newValue: unknown) => void;
}) {
  const incoming = parseShareCredentials(value);
  const [rows, setRows] = useState<ShareCredentialRow[]>(incoming);
  // Which rows had a password when the server last answered. Typing in
  // the box does not change this; it is what the row LOOKED like on
  // arrival, and it is the only way to tell "saved, not shown" from
  // "never set".
  // **Seeded from the first render, not left false until the value
  // changes.** The effect below only fires when the serialized value
  // MOVES, which it does not on mount — so initialising this to all-false
  // made every row the server already holds look like a row with no
  // password, which is the exact confusion this flag exists to prevent.
  const [stored, setStored] = useState<boolean[]>(() =>
    incoming.map((r) => r.host.trim().length > 0),
  );
  const mirrored = useRef<string>(JSON.stringify(incoming));

  useEffect(() => {
    const parsed = parseShareCredentials(value);
    const serialized = JSON.stringify(parsed);
    if (serialized !== mirrored.current) {
      mirrored.current = serialized;
      setRows(parsed);
      // A row that came back from the server with a host is a row the
      // server is holding a credential for. The password itself is
      // never on the wire, so its presence cannot be read from it.
      setStored(parsed.map((r) => r.host.trim().length > 0));
    }
  }, [value]);

  function update(next: ShareCredentialRow[], nextStored?: boolean[]) {
    setRows(next);
    if (nextStored) setStored(nextStored);
    const complete = next
      .filter((r) => r.host.trim().length > 0 && r.username.trim().length > 0)
      .map((r) => ({
        host: r.host.trim(),
        username: r.username.trim(),
        // null = keep whatever is stored. "" = forget it. A typed value
        // replaces it.
        password: r.password,
      }));
    mirrored.current = JSON.stringify(complete);
    onChange(complete);
  }

  const inputClass =
    "min-w-0 flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 font-mono text-xs outline-none transition-colors hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)] disabled:cursor-not-allowed disabled:opacity-50";
  const buttonClass =
    "font-ui shrink-0 rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";

  return (
    <div className="flex flex-col gap-2" data-testid="share-credentials">
      {rows.length === 0 && (
        <p className="text-xs text-[color:var(--muted)] italic">
          No logins. Add one only if a model folder lives on a server that asks this machine to sign
          in.
        </p>
      )}
      {rows.map((row, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={row.host}
            spellCheck={false}
            placeholder="192.168.16.252  (the server, not a whole path)"
            aria-label="File server"
            onChange={(e) => {
              const next = [...rows];
              next[index] = { ...row, host: e.target.value };
              update(next);
            }}
            disabled={pending}
            className={inputClass}
          />
          <input
            type="text"
            value={row.username}
            spellCheck={false}
            placeholder="your name on that server"
            aria-label="User name on the file server"
            onChange={(e) => {
              const next = [...rows];
              next[index] = { ...row, username: e.target.value };
              update(next);
            }}
            disabled={pending}
            className={inputClass}
          />
          <input
            type="password"
            value={row.password ?? ""}
            autoComplete="new-password"
            placeholder={stored[index] ? "saved - leave blank to keep it" : "password"}
            aria-label="Password for the file server"
            onChange={(e) => {
              const next = [...rows];
              next[index] = { ...row, password: e.target.value };
              update(next);
            }}
            disabled={pending}
            className={inputClass}
          />
          {stored[index] && (
            <button
              type="button"
              data-testid={`share-forget-${index}`}
              onClick={() => {
                const next = [...rows];
                next[index] = { ...row, password: "" };
                const nextStored = [...stored];
                nextStored[index] = false;
                update(next, nextStored);
              }}
              disabled={pending}
              className={buttonClass}
              title="Forget the stored password for this server."
            >
              forget password
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              update(
                rows.filter((_, i) => i !== index),
                stored.filter((_, i) => i !== index),
              );
            }}
            disabled={pending}
            className={buttonClass}
            title="Remove this server. Nothing on the server is touched."
          >
            remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          setRows([...rows, { host: "", username: "", password: null }]);
          setStored([...stored, false]);
        }}
        disabled={pending}
        className={`${buttonClass} w-fit`}
      >
        add a server
      </button>
      {/* `cross-link-related-settings` (Troy, standing): this says WHO
          this machine is on that server; where the folder is mounted is
          the other half, and both name each other. */}
      <p className="text-xs text-[color:var(--muted)]">
        Where each folder is mounted is set on{" "}
        <Link href={libraryFoldersHref(null)} className="underline">
          Library &rarr; Folders
        </Link>
        , and overridden for this machine in Library folder overrides above.
      </p>
    </div>
  );
}

/** Whatever the server or the draft holds, as rows. A redacted password
 * (null) is preserved as null, because null is the value that means
 * *keep the stored one* on the way back. */
function parseShareCredentials(value: unknown): ShareCredentialRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.host !== "string") return [];
    return [
      {
        host: record.host,
        username: typeof record.username === "string" ? record.username : "",
        password: typeof record.password === "string" ? record.password : null,
      },
    ];
  });
}

/** Whatever the server or the draft holds, as rows. Junk entries are
 * dropped rather than rendered as blanks that would be re-sent. */
function parseMappings(value: unknown): PathMapping[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.from !== "string" || typeof record.to !== "string") return [];
    return [{ from: record.from, to: record.to }];
  });
}
