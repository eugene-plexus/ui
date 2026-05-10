"use client";

import type { ConfigField as ConfigFieldDef, DriverEntry } from "@/lib/types";

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
  onChange,
}: {
  field: ConfigFieldDef;
  value: unknown;
  pending: boolean;
  onChange: (newValue: unknown) => void;
}) {
  const baseInputClass =
    "w-full rounded border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none transition-colors hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[color:var(--border)]";

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
      return (
        <select
          value={(value as string | undefined) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={pending}
          className={baseInputClass}
        >
          {field.enumValues.map((v) => (
            <option key={v} value={v}>
              {v}
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
      const entries: DriverEntry[] = Array.isArray(value)
        ? (value as DriverEntry[]).map((d) => ({
            name: typeof d?.name === "string" ? d.name : "",
            // openapi-typescript types url as `string` even though the
            // spec uses format: uri; coerce defensively.
            url: typeof d?.url === "string" ? d.url : String(d?.url ?? ""),
          }))
        : [];

      const update = (next: DriverEntry[]) => onChange(next);

      return (
        <div className="flex flex-col gap-2">
          {entries.length === 0 && (
            <p className="text-xs text-[color:var(--muted)]">
              No drivers configured. Add one to dispatch bicameral passes.
            </p>
          )}
          {entries.map((entry, i) => (
            <div key={i} className="grid grid-cols-[1fr_2fr_auto] items-center gap-2">
              <input
                type="text"
                value={entry.name}
                placeholder="name (e.g. left)"
                onChange={(e) => {
                  const next = entries.slice();
                  next[i] = { ...entry, name: e.target.value };
                  update(next);
                }}
                disabled={pending}
                className={baseInputClass}
              />
              <input
                type="text"
                value={entry.url}
                placeholder="http://host:port"
                onChange={(e) => {
                  const next = entries.slice();
                  next[i] = { ...entry, url: e.target.value };
                  update(next);
                }}
                disabled={pending}
                className={baseInputClass}
              />
              <button
                type="button"
                onClick={() => update(entries.filter((_, j) => j !== i))}
                disabled={pending || entries.length <= 1}
                title={
                  entries.length <= 1
                    ? "v0.1 requires at least one driver."
                    : "Remove this driver."
                }
                className="font-ui rounded border border-[color:var(--border)] px-2 py-1 text-xs transition-colors hover:border-rose-700 hover:bg-rose-950/40 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[color:var(--border)] disabled:hover:bg-transparent"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => update([...entries, { name: "", url: "" }])}
            disabled={pending}
            className="font-ui w-fit rounded border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30"
          >
            + Add driver
          </button>
        </div>
      );
    }

    // string, url, file_path
    return (
      <input
        type="text"
        value={(value as string | undefined) ?? ""}
        pattern={field.pattern ?? undefined}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        className={baseInputClass}
      />
    );
  }

  return (
    <div className="grid grid-cols-[200px_1fr] items-start gap-4 border-b border-[color:var(--border)] py-3">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium">
          {field.label}
          {field.required && <span className="ml-1 text-rose-400">*</span>}
        </label>
        <code className="font-mono text-[10px] text-[color:var(--muted)]">{field.key}</code>
        {field.requiresRestart && (
          <span className="w-fit rounded bg-amber-900/40 px-1.5 py-0.5 text-[9px] tracking-wider text-amber-300 uppercase">
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
