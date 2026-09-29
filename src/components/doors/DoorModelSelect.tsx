"use client";

import type { Model } from "@/lib/types";

import { fieldLabel, inputClass } from "./doorStyles";

/** The models one door can be sent to, and nothing else. */
export function DoorModelSelect({
  models,
  value,
  onChange,
  disabled,
}: {
  models: readonly Model[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className={fieldLabel}>
      <span className="text-[color:var(--muted)]">Model</span>
      <select
        data-testid="door-model"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={inputClass}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.id}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The model to keep selected when the list changes: the current one if
 * it is still offered, else the first. */
export function keepModel(models: readonly Model[], current: string): string {
  return models.some((m) => m.id === current) ? current : (models[0]?.id ?? "");
}
