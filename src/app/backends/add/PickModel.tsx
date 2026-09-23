"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Which model the new app should answer for.
 *
 * The wizard's last screen until S2 of the hobbyist UX plan; now the second
 * step of `/backends/add`. Renders a choice and reports it upwards; the
 * page owns the write.
 *
 * A separate step rather than a field on the form because the app has to
 * be added before it can be asked what it serves. The alternative was
 * making the person hand-type an exact model id, which is what this
 * replaced.
 */

/** The select's value for "type one in", which no model id can be. */
const OTHER = "__other__";

export function PickModel({
  driverName,
  models,
  value,
  disabled = false,
  onChange,
}: {
  driverName: string;
  models: string[];
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  // Whether the type-in box is the choice. Held here rather than read off
  // `value`: "Something else..." used to store a single space, which reads
  // as empty once trimmed, so the box never opened, the select snapped
  // back to "Choose a model..." and a model pulled after the list was read
  // could not be entered at all -- and clearing the box closed it.
  const listed = models.includes(value);
  const [typing, setTyping] = useState(value.trim() !== "" && !listed);
  const other = typing || (value.trim() !== "" && !listed);
  const typeIn = useRef<HTMLInputElement | null>(null);
  const [focusTypeIn, setFocusTypeIn] = useState(false);
  useEffect(() => {
    if (!focusTypeIn) return;
    typeIn.current?.focus();
    setFocusTypeIn(false);
  }, [focusTypeIn]);

  return (
    <>
      <p className="mb-4 text-sm leading-relaxed text-[color:var(--muted)]">
        <span className="font-mono">{driverName}</span> is connected.{" "}
        {models.length > 0
          ? "These are the models it reports having."
          : "It reported no models — it may have none pulled yet. Type an id if you know one."}
      </p>
      {models.length > 0 && (
        <div className="mb-5">
          <label htmlFor="backend-model" className="font-ui block text-sm font-medium">
            Model
          </label>
          <p className="mt-1 mb-2 text-sm leading-relaxed text-[color:var(--muted)]">
            What Eugene sends to this app.
          </p>
          <select
            id="backend-model"
            value={other ? OTHER : value}
            disabled={disabled}
            onChange={(e) => {
              const picked = e.target.value;
              if (picked === OTHER) {
                setTyping(true);
                setFocusTypeIn(true);
                onChange("");
              } else {
                setTyping(false);
                onChange(picked);
              }
            }}
            className={input}
          >
            <option value="">Choose a model…</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value={OTHER}>Something else…</option>
          </select>
        </div>
      )}
      {(other || models.length === 0) && (
        <div className="mb-5">
          <label htmlFor="backend-model-id" className="font-ui block text-sm font-medium">
            Model id
          </label>
          <p className="mt-1 mb-2 text-sm leading-relaxed text-[color:var(--muted)]">
            Exactly as the app names it. Something pulled just now will not be in the list.
          </p>
          <input
            ref={typeIn}
            id="backend-model-id"
            type="text"
            // Untrimmed while typing; Save trims.
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            className={input}
          />
        </div>
      )}
    </>
  );
}

const input =
  "font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)] disabled:opacity-60";
