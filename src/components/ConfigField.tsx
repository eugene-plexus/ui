"use client";

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
  /** Current watchdog topology snapshot — used to render
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

    // `driver_list` is still in ConfigValueType but no component emits
    // one: the gateway derives its routing table from the watchdog
    // topology instead of holding a configured list. The bespoke editor
    // for it is gone rather than kept warm — a renderer for a shape
    // nothing produces is how a UI drifts away from the contract.
    // Configured model->driver priority lists arrive with load
    // balancing at M5; the renderer comes back with them.

    // Peer-reference dropdown: a `componentKindHint` tells us this
    // field points at a watchdog topology entry of the given kind.
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

/**
 * Topology URLs come back with a trailing slash (pydantic's AnyUrl
 * normalises them that way) while a saved peer reference usually
 * doesn't. Strip it on both sides so "http://x:1/" and "http://x:1"
 * don't render as different selections.
 */
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
