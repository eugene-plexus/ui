"use client";

import type { ConfigField as ConfigFieldDef } from "@/lib/types";

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
    "w-full rounded border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)] disabled:opacity-50";

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
