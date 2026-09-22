"use client";

/**
 * Leaf inputs shared across wizard screens.
 *
 * Split out at M9 so a screen can be mounted on its own. Nothing here
 * knows about the wizard's draft, which is what makes them reusable and
 * what kept them from being the reason a screen needed the whole flow to
 * render.
 */

import { createContext, useContext, useId, useRef, useState } from "react";

/** The ids a control inside a `Field` takes, so the label names it and
 * the line under the label describes it. */
interface FieldControlIds {
  id: string;
  describedBy?: string;
}

const FieldControl = createContext<FieldControlIds | null>(null);

/**
 * The ids for the control inside the nearest `Field`, or null outside
 * one. A control rendered as a Field's child spreads these onto its
 * input; `SecretInput` and `FieldInput` below already do.
 */
export function useFieldControl(): FieldControlIds | null {
  return useContext(FieldControl);
}

/**
 * A label, an optional line of description, and the control.
 *
 * **The label is tied to the control by id.** It used to be a bare
 * `<label>` naming nothing, so the passphrase screen was two password
 * boxes with no accessible names, told apart only by position, and
 * clicking a label did not focus its box. The Field makes the id with
 * `useId` and hands it down by context rather than asking every caller
 * for one: the control is usually a component of its own (a
 * `SecretInput`), and an id prop threaded through each caller is the
 * thing that gets forgotten.
 */
export function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <FieldControl.Provider value={{ id, describedBy: descriptionId }}>
      <div className="mb-5">
        <label htmlFor={id} className="font-ui block text-sm font-medium">
          {label}
        </label>
        {description && (
          <p
            id={descriptionId}
            className="mt-1 mb-2 text-sm leading-relaxed text-[color:var(--muted)]"
          >
            {description}
          </p>
        )}
        {children}
      </div>
    </FieldControl.Provider>
  );
}

/** A plain input that takes its ids from the `Field` it sits in. */
export function FieldInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const control = useFieldControl();
  return <input id={control?.id} aria-describedby={control?.describedBy} {...props} />;
}

export function HostPortRow({
  host,
  port,
  onChange,
}: {
  host: string;
  port: number;
  onChange: (host: string, port: number) => void;
}) {
  return (
    <div className="mb-5 grid grid-cols-[2fr_1fr] gap-3">
      <Field label="Host">
        <FieldInput
          type="text"
          value={host}
          onChange={(e) => onChange(e.target.value, port)}
          className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
        />
      </Field>
      <Field label="Port">
        <FieldInput
          type="number"
          value={port}
          onChange={(e) => onChange(host, parseInt(e.target.value, 10) || 0)}
          className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
        />
      </Field>
    </div>
  );
}

export function Radio({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  description: string;
}) {
  return (
    <label
      className={`mb-3 flex cursor-pointer items-start gap-3 rounded-[var(--radius)] border px-4 py-3 transition-colors ${
        checked
          ? "border-[color:var(--accent-left)] bg-[color:var(--panel-soft)]"
          : "border-[color:var(--border)] hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
      }`}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        className="mt-1 accent-[color:var(--accent-left)]"
      />
      <span>
        <span className="font-ui block text-sm font-medium">{label}</span>
        <span className="mt-1 block text-sm leading-relaxed text-[color:var(--muted)]">
          {description}
        </span>
      </span>
    </label>
  );
}

export function Checkbox({
  checked,
  disabled = false,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
}) {
  const tone = disabled
    ? "cursor-not-allowed border-[color:var(--border)] opacity-70"
    : checked
      ? "cursor-pointer border-[color:var(--accent-left)] bg-[color:var(--panel-soft)]"
      : "cursor-pointer border-[color:var(--border)] hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]";
  return (
    <label
      className={`mb-3 flex items-start gap-3 rounded-[var(--radius)] border px-4 py-3 transition-colors ${tone}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 accent-[color:var(--accent-left)]"
      />
      <span>
        <span className="font-ui block text-sm font-medium">{label}</span>
        <span className="mt-1 block text-sm leading-relaxed text-[color:var(--muted)]">
          {description}
        </span>
      </span>
    </label>
  );
}

export function SecretInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [reveal, setReveal] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const control = useFieldControl();
  return (
    <div className="flex items-stretch gap-2">
      <input
        ref={inputRef}
        id={control?.id}
        aria-describedby={control?.describedBy}
        type={reveal ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="font-ui flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
      />
      <button
        type="button"
        onClick={() => setReveal((r) => !r)}
        className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
      >
        {reveal ? "Hide" : "Show"}
      </button>
    </div>
  );
}
