"use client";

/**
 * The Library's `catalogue_sources` editor (LS4, library-sources-and-engines.md
 * §4.4): where Discover finds models.
 *
 * Two kinds of row. A **hub** is Hugging Face or anything speaking its API,
 * at its own address, with its own token. An **engine's list** is the models
 * an engine says it supports, as the node picked in Discover reports them;
 * no engine named means every engine's.
 *
 * The token follows `share_credentials`' rules, which the Library applies
 * on its side: `GET` never returns it, `hasToken` says whether one is
 * stored, a row sent back without one keeps it, and `""` clears it. So a
 * blank token box on a row that has one stored is never written back as
 * blank, and the row says *saved* rather than looking empty.
 */

import { useEffect, useRef, useState } from "react";

import { engineName } from "@/lib/issues";

type Kind = "hf_hub" | "engine_list";

export interface SourceRow {
  id: string;
  kind: Kind;
  label: string;
  enabled: boolean;
  address: string;
  /** null = keep whatever is stored; "" = forget it; text replaces it. */
  token: string | null;
  /** What the Library said when it last answered; null for a new row. */
  hasToken: boolean | null;
  /** engine_list only; "" = every engine's list. */
  engine: string;
}

const ENGINES = ["llama_cpp", "vllm", "mlx", "kev", "strata"];
const PUBLIC_HUB = "https://huggingface.co";

/** Whatever the Library or the draft holds, as rows; junk is dropped. */
export function parseSources(value: unknown): SourceRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || (r.kind !== "hf_hub" && r.kind !== "engine_list")) return [];
    return [
      {
        id: r.id,
        kind: r.kind,
        label: typeof r.label === "string" ? r.label : "",
        enabled: r.enabled !== false,
        address: typeof r.address === "string" ? r.address : "",
        token: typeof r.token === "string" ? r.token : null,
        hasToken: typeof r.hasToken === "boolean" ? r.hasToken : null,
        engine: typeof r.engine === "string" ? r.engine : "",
      },
    ];
  });
}

/** The rows as the Library takes them back. */
export function serializeSources(rows: SourceRow[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = { id: row.id, kind: row.kind, enabled: row.enabled };
    if (row.label.trim()) out.label = row.label.trim();
    if (row.kind === "hf_hub") {
      if (row.address.trim()) out.address = row.address.trim();
      // Absent keeps the stored token: GET never showed it.
      if (row.token !== null) out.token = row.token;
    } else if (row.engine) {
      out.engine = row.engine;
    }
    return out;
  });
}

/** A new row's id: from its label, unique among the others, and the shape
 * the Library accepts. Fixed once made, because downloads and a stored
 * token are kept under it. */
export function newSourceId(label: string, taken: string[]): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "source";
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base}-${n}`;
  return id;
}

export function CatalogueSourcesInput({
  value,
  pending,
  onChange,
}: {
  value: unknown;
  pending: boolean;
  onChange: (newValue: unknown) => void;
}) {
  const [rows, setRows] = useState<SourceRow[]>(() => parseSources(value));
  const mirrored = useRef<string>(JSON.stringify(serializeSources(parseSources(value))));

  useEffect(() => {
    const parsed = parseSources(value);
    const serialized = JSON.stringify(serializeSources(parsed));
    if (serialized !== mirrored.current) {
      mirrored.current = serialized;
      setRows(parsed);
    }
  }, [value]);

  function update(next: SourceRow[]) {
    setRows(next);
    const out = serializeSources(next);
    mirrored.current = JSON.stringify(out);
    onChange(out);
  }

  function edit(index: number, change: Partial<SourceRow>) {
    const next = [...rows];
    next[index] = { ...rows[index]!, ...change };
    update(next);
  }

  /** Searches answer in the list's order, whatever a source's kind (LS7). */
  function move(index: number, by: -1 | 1) {
    const to = index + by;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    [next[index], next[to]] = [next[to]!, next[index]!];
    update(next);
  }

  function add(kind: Kind) {
    const label = kind === "hf_hub" ? "Another hub" : "An engine's list";
    update([
      ...rows,
      {
        id: newSourceId(
          label,
          rows.map((r) => r.id),
        ),
        kind,
        label,
        enabled: true,
        address: kind === "hf_hub" ? PUBLIC_HUB : "",
        token: null,
        hasToken: false,
        engine: "",
      },
    ]);
  }

  const inputClass =
    "min-w-0 flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 font-mono text-xs outline-none transition-colors hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)] disabled:cursor-not-allowed disabled:opacity-50";
  const buttonClass =
    "action-button font-ui shrink-0 rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";

  return (
    <div className="flex flex-col gap-3" data-testid="catalogue-sources">
      {rows.length === 0 && (
        <p className="text-sm text-[color:var(--muted)] italic">
          No sources: Discover has nowhere to look. Add a hub, or an engine&rsquo;s list.
        </p>
      )}
      {rows.length > 1 && (
        <p className="text-xs text-[color:var(--muted)]">
          Discover shows each source&rsquo;s results in this order: move one up to see its models
          first.
        </p>
      )}
      {rows.map((row, index) => (
        <div
          key={row.id}
          data-testid={`source-${row.id}`}
          className="flex flex-col gap-2 rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2"
        >
          <div className="flex flex-wrap items-center gap-2">
            <label className="font-ui flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(e) => edit(index, { enabled: e.target.checked })}
                disabled={pending}
                aria-label={`Search ${row.label || row.id}`}
              />
              {row.kind === "hf_hub" ? "Hub" : "Engine's list"}
            </label>
            <input
              type="text"
              value={row.label}
              placeholder={row.id}
              aria-label="Name"
              onChange={(e) => edit(index, { label: e.target.value })}
              disabled={pending}
              className={inputClass}
            />
            <span className="font-mono text-[0.6875rem] text-[color:var(--muted)]" title="Its id">
              {row.id}
            </span>
            <button
              type="button"
              onClick={() => move(index, -1)}
              disabled={pending || index === 0}
              className={buttonClass}
              aria-label={`Move ${row.label || row.id} up`}
              title="Its results come before the source above it."
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(index, 1)}
              disabled={pending || index === rows.length - 1}
              className={buttonClass}
              aria-label={`Move ${row.label || row.id} down`}
              title="Its results come after the source below it."
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => update(rows.filter((_, i) => i !== index))}
              disabled={pending}
              className={buttonClass}
              title="Stop using this source. Models already downloaded from it stay where they are."
            >
              remove
            </button>
          </div>
          {row.kind === "hf_hub" ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={row.address}
                spellCheck={false}
                placeholder={PUBLIC_HUB}
                aria-label="Hub address"
                onChange={(e) => edit(index, { address: e.target.value })}
                disabled={pending}
                className={inputClass}
              />
              <input
                type="password"
                value={row.token ?? ""}
                autoComplete="new-password"
                placeholder={
                  row.hasToken === true
                    ? "token saved - leave blank to keep it"
                    : row.hasToken === null
                      ? "leave blank to keep any saved token"
                      : "no token: public models only"
                }
                aria-label="Access token"
                onChange={(e) =>
                  edit(index, { token: e.target.value === "" ? null : e.target.value })
                }
                disabled={pending}
                className={inputClass}
              />
              {row.hasToken !== false && (
                <button
                  type="button"
                  data-testid={`source-forget-${row.id}`}
                  onClick={() => edit(index, { token: "", hasToken: false })}
                  disabled={pending}
                  className={buttonClass}
                  title="Forget the saved token for this hub."
                >
                  forget token
                </button>
              )}
            </div>
          ) : (
            <select
              value={row.engine}
              aria-label="Whose list"
              onChange={(e) => edit(index, { engine: e.target.value })}
              disabled={pending}
              className={inputClass}
            >
              <option value="">Every engine&rsquo;s list</option>
              {ENGINES.map((e) => (
                <option key={e} value={e}>
                  {engineName(e)}&rsquo;s list
                </option>
              ))}
            </select>
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => add("hf_hub")}
          disabled={pending}
          className={buttonClass}
        >
          add a hub
        </button>
        <button
          type="button"
          onClick={() => add("engine_list")}
          disabled={pending}
          className={buttonClass}
        >
          add an engine&rsquo;s list
        </button>
      </div>
    </div>
  );
}
