"use client";

/**
 * Which door the playground is trying. Rendered only when more than one
 * is offered: an install that serves chat alone sees the page it always
 * had.
 */

import type { Door, DoorId } from "@/lib/doors";

export function DoorPicker({
  doors,
  value,
  onChange,
  disabled,
}: {
  doors: readonly Door[];
  value: DoorId;
  onChange: (id: DoorId) => void;
  disabled?: boolean;
}) {
  if (doors.length < 2) return null;
  return (
    <div
      role="tablist"
      aria-label="What to try"
      data-testid="door-picker"
      className="flex flex-wrap gap-1"
    >
      {doors.map((door) => {
        const current = door.id === value;
        return (
          <button
            key={door.id}
            type="button"
            role="tab"
            aria-selected={current}
            data-testid={`door-${door.id}`}
            disabled={disabled}
            onClick={() => onChange(door.id)}
            title={door.hint}
            className={`font-ui rounded-[var(--radius)] border px-3 py-1 text-sm transition-colors hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30 ${
              current
                ? "border-[color:var(--accent-left)] text-[color:var(--foreground)]"
                : "border-[color:var(--border)] text-[color:var(--muted)]"
            }`}
          >
            {door.label}
          </button>
        );
      })}
    </div>
  );
}
