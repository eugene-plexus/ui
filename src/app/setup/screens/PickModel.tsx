"use client";

/**
 * Wizard screen: Which model the new backend should serve.
 *
 * One screen per module since M9. Nothing here reads or writes the
 * install - a screen renders the draft and reports edits upwards, and
 * every write happens once, in `page.tsx`, when Start is pressed.
 */

import { Field } from "../fields";

/**
 * Pick the model, from a list the backend actually reported.
 *
 * A separate screen rather than a field on the backend screen because a
 * driver has to exist before it can be asked what it serves, and one cannot
 * exist before Start - there is no session token until the passphrase is set.
 * The alternative was making the operator hand-type an exact model id, which
 * is what this replaces.
 */
export function ScreenPickModel({
  driverName,
  models,
  value,
  onChange,
  starting,
  startMessage,
  startError,
}: {
  driverName: string;
  models: string[];
  value: string;
  onChange: (v: string) => void;
  starting: boolean;
  startMessage: string | null;
  startError: string | null;
}) {
  const listed = models.includes(value);
  const other = value.trim() !== "" && !listed;

  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Which model?</h2>
      <p className="mb-4 text-sm leading-relaxed text-[color:var(--muted)]">
        <span className="font-mono">{driverName}</span> is connected.{" "}
        {models.length > 0
          ? "These are the models it reports having."
          : "It reported no models — it may have none pulled yet. Type an id if you know one."}
      </p>
      {models.length > 0 && (
        <Field label="Model" description="What the gateway routes to for this backend.">
          <select
            value={other ? "__other__" : value}
            onChange={(e) => onChange(e.target.value === "__other__" ? " " : e.target.value)}
            className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
          >
            <option value="">Choose a model…</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value="__other__">Something else…</option>
          </select>
        </Field>
      )}
      {(other || models.length === 0) && (
        <Field
          label="Model id"
          description="Exactly as the backend names it. Something pulled just now will not be in the list."
        >
          <input
            type="text"
            value={value.trim()}
            onChange={(e) => onChange(e.target.value)}
            className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
          />
        </Field>
      )}
      <p className="mb-4 text-xs leading-relaxed text-[color:var(--muted)]">
        You can skip this and choose later from Config — the backend just will not route anything
        until you do.
      </p>
      {starting && startMessage && (
        <p className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-xs text-[color:var(--muted)]">
          {startMessage}
        </p>
      )}
      {startError && (
        <p className="status-error rounded-[var(--radius)] border px-3 py-2 text-xs">
          {startError}
        </p>
      )}
    </section>
  );
}
