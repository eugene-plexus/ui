"use client";

import { useState } from "react";

import { ApiError, api } from "@/lib/api";
import type {
  ComponentKind,
  ConfigField as ConfigFieldDef,
  DriverEntry,
  DriverHealth,
  TopologyComponent,
} from "@/lib/types";

/**
 * Render a single config field's input based on its `valueType`.
 *
 * The orchestrator's spec carries everything we need to drive the UI:
 * label, description, default, valueType, validation hints, sensitive
 * flag, restart-required flag. This is the OpenClaw-mistake fix made
 * concrete — no per-component UI code, the form follows the schema.
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
  /** Current watchdog topology snapshot — used to render
   * `componentKindHint`-bearing fields as dropdowns. Null while
   * loading or when the parent decided not to fetch (e.g. the schema
   * has no peer-reference fields). The dropdown falls back to a free-
   * text URL input when topology is unavailable. */
  topology?: TopologyComponent[] | null;
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

    if (field.valueType === "driver_list") {
      return (
        <DriverListInput
          value={value}
          pending={pending}
          onChange={onChange}
          baseInputClass={baseInputClass}
          componentKindHint={field.componentKindHint}
          topology={topology}
        />
      );
    }

    // Peer-reference dropdown: a `componentKindHint` tells us this
    // field points at a watchdog topology entry of the given kind.
    // Render as a dropdown sourced from the live topology so the
    // operator doesn't have to copy URLs by hand. The wire value is
    // still the peer's URL — the hint only changes the input UX.
    //
    // For single-instance kinds (memory, identity, connector in stock
    // topology) the dropdown effectively becomes an on/off toggle:
    // `(off)` + the one peer. For multi-instance kinds (hemisphere-
    // driver, typically `left` + `right`) the operator picks one.
    //
    // Falls back to a free-text URL input when topology is null —
    // either still loading, or the watchdog fetch failed. Better to
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

interface RowTestStatus {
  state: "testing" | "ok" | "fail";
  message: string;
}

/**
 * Driver-list editor. Each driver *slot* has a `name` and an ordered
 * priority list of backend `urls` (v0.2.1 failover). Within a slot,
 * every URL gets its own dropdown/free-text field + a per-URL Test
 * button (Sonarr/Radarr-style). Test posts to
 * `/v1/admin/drivers/probe` on the orchestrator, which probes that one
 * URL's `/v1/info` and returns reachability + backend identity.
 *
 * The orchestrator tries a slot's URLs in order on each turn and
 * cascades to the next on transport error / 5xx / timeout, so the order
 * here IS the failover order — `urls[0]` is the primary.
 */
function DriverListInput({
  value,
  pending,
  onChange,
  baseInputClass,
  componentKindHint,
  topology,
}: {
  value: unknown;
  pending: boolean;
  onChange: (next: DriverEntry[]) => void;
  baseInputClass: string;
  /** When set, each URL field renders as a dropdown of watchdog
   * components of this kind instead of a free-text input. Falls back to
   * free-text input when `topology` is null (still loading / probe
   * failed). */
  componentKindHint?: ComponentKind;
  topology?: TopologyComponent[] | null;
}) {
  const dropdownEntries =
    componentKindHint && topology
      ? topology.filter((c) => c.kind === componentKindHint && typeof c.url === "string")
      : null;
  const entries: DriverEntry[] = Array.isArray(value)
    ? (value as Array<Record<string, unknown>>).map((d) => ({
        name: typeof d?.name === "string" ? d.name : "",
        // Canonical shape is `urls: string[]`. Tolerate the pre-v0.2.1
        // single-`url` shape in case unsaved/loaded state predates the
        // server-side migration. openapi-typescript types URLs as
        // `string`; coerce defensively.
        urls: Array.isArray(d?.urls)
          ? (d.urls as unknown[]).map((u) => (typeof u === "string" ? u : String(u ?? "")))
          : typeof d?.url === "string"
            ? [d.url]
            : [],
      }))
    : [];

  // Test status is keyed per (slot, url) so a slot with several backends
  // shows an independent result line under each one.
  const [statusByKey, setStatusByKey] = useState<Record<string, RowTestStatus>>({});
  const keyOf = (si: number, ui: number) => `${si}:${ui}`;

  function setStatus(si: number, ui: number, status: RowTestStatus | null) {
    setStatusByKey((prev) => {
      const key = keyOf(si, ui);
      if (status === null) {
        if (!(key in prev)) return prev;
        const copy = { ...prev };
        delete copy[key];
        return copy;
      }
      return { ...prev, [key]: status };
    });
  }

  function setSlotUrls(si: number, urls: string[]) {
    const next = entries.slice();
    next[si] = { ...entries[si]!, urls };
    onChange(next);
  }

  async function probe(si: number, ui: number) {
    const entry = entries[si];
    const url = entry?.urls[ui];
    if (!entry || !url) return;
    setStatus(si, ui, { state: "testing", message: "Probing…" });
    try {
      const result = await api.post<DriverHealth>("orchestrator", "/v1/admin/drivers/probe", {
        name: entry.name || "<unnamed>",
        url,
      });
      if (result.reachable) {
        const parts = [
          result.backend ? `backend: ${result.backend}` : null,
          result.modelId ? `model: ${result.modelId}` : null,
          result.version ? `v${result.version}` : null,
        ].filter(Boolean);
        setStatus(si, ui, {
          state: "ok",
          message: parts.length > 0 ? parts.join(" · ") : "reachable",
        });
      } else {
        setStatus(si, ui, { state: "fail", message: result.error ?? "unreachable" });
      }
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `${e.status} ${e.statusText}`
          : e instanceof Error
            ? e.message
            : String(e);
      setStatus(si, ui, { state: "fail", message: msg });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {entries.length === 0 && (
        <p className="text-xs text-[color:var(--muted)]">
          No drivers configured. Add one to dispatch bicameral passes.
        </p>
      )}
      {entries.map((entry, si) => (
        <div
          key={si}
          className="flex flex-col gap-2 rounded-[var(--radius)] border border-[color:var(--border)] p-2"
        >
          <div className="grid grid-cols-[1fr_auto] items-center gap-2">
            <input
              type="text"
              value={entry.name}
              placeholder="name (e.g. left)"
              onChange={(e) => {
                const next = entries.slice();
                next[si] = { ...entry, name: e.target.value };
                onChange(next);
              }}
              disabled={pending}
              className={baseInputClass}
            />
            <button
              type="button"
              onClick={() => onChange(entries.filter((_, j) => j !== si))}
              disabled={pending || entries.length <= 1}
              title={
                entries.length <= 1
                  ? "The bicameral loop requires at least one driver slot."
                  : "Remove this driver slot."
              }
              className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-xs transition-colors hover:border-[color:var(--status-error-border)] hover:bg-[color:var(--status-error-bg)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[color:var(--border)] disabled:hover:bg-transparent"
            >
              Remove slot
            </button>
          </div>

          {/* Priority list of backend URLs for this slot. urls[0] is the
              primary; the rest are failover targets tried in order. */}
          {entry.urls.map((url, ui) => {
            const status = statusByKey[keyOf(si, ui)];
            const canTest = url.trim().length > 0 && !pending && status?.state !== "testing";
            const updateUrl = (newUrl: string) => {
              const urls = entry.urls.slice();
              urls[ui] = newUrl;
              setStatus(si, ui, null); // URL change invalidates prior test
              setSlotUrls(si, urls);
            };
            return (
              <div key={ui} className="flex flex-col gap-1 pl-2">
                <div className="grid grid-cols-[auto_2fr_auto_auto] items-center gap-2">
                  <span
                    className="font-ui text-[11px] text-[color:var(--muted)]"
                    title={ui === 0 ? "Primary backend" : `Failover backend #${ui}`}
                  >
                    {ui === 0 ? "primary" : `#${ui}`}
                  </span>
                  {dropdownEntries ? (
                    <select
                      value={normalizeUrl(url)}
                      onChange={(e) => updateUrl(e.target.value)}
                      disabled={pending}
                      className={baseInputClass}
                    >
                      <option value="">(pick a driver…)</option>
                      {dropdownEntries.map((c) => (
                        <option key={c.name} value={normalizeUrl(c.url)}>
                          {c.name}
                        </option>
                      ))}
                      {url &&
                        !dropdownEntries.some((c) => normalizeUrl(c.url) === normalizeUrl(url)) && (
                          <option value={normalizeUrl(url)}>(unknown: {normalizeUrl(url)})</option>
                        )}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={url}
                      placeholder="http://host:port"
                      onChange={(e) => updateUrl(e.target.value)}
                      disabled={pending}
                      className={baseInputClass}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => void probe(si, ui)}
                    disabled={!canTest}
                    title={
                      canTest
                        ? "Probe this URL's /v1/info to verify the backend is reachable."
                        : "Enter a URL first."
                    }
                    className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[color:var(--border)] disabled:hover:bg-transparent"
                  >
                    {status?.state === "testing" ? "Testing…" : "Test"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStatus(si, ui, null);
                      setSlotUrls(
                        si,
                        entry.urls.filter((_, j) => j !== ui),
                      );
                    }}
                    disabled={pending || entry.urls.length <= 1}
                    title={
                      entry.urls.length <= 1
                        ? "A slot needs at least one backend URL."
                        : "Remove this backend URL."
                    }
                    className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-xs transition-colors hover:border-[color:var(--status-error-border)] hover:bg-[color:var(--status-error-bg)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[color:var(--border)] disabled:hover:bg-transparent"
                  >
                    ✕
                  </button>
                </div>
                {status && (
                  <p
                    className={
                      "ml-1 text-[11px] " +
                      (status.state === "ok"
                        ? "text-status-success"
                        : status.state === "fail"
                          ? "text-status-error"
                          : "text-[color:var(--muted)]")
                    }
                  >
                    {status.state === "ok" && "✓ "}
                    {status.state === "fail" && "✗ "}
                    {status.message}
                  </p>
                )}
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => setSlotUrls(si, [...entry.urls, ""])}
            disabled={pending}
            title="Add a failover backend tried after the ones above."
            className="font-ui ml-2 w-fit rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-[11px] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30"
          >
            + Add failover URL
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...entries, { name: "", urls: [""] }])}
        disabled={pending}
        className="font-ui w-fit rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30"
      >
        + Add driver
      </button>
    </div>
  );
}

/**
 * Match identity's server-side normalization: peer URLs are stored
 * with no trailing slash (see `resolve_peer_url` in identity/app.py).
 * Use this when comparing topology URLs to the saved value so
 * "http://x:1/" and "http://x:1" don't show as different selections.
 */
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
