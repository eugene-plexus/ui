"use client";

/**
 * Leaf inputs shared across wizard screens.
 *
 * Split out at M9 so a screen can be mounted on its own. Nothing here
 * knows about the wizard's draft, which is what makes them reusable and
 * what kept them from being the reason a screen needed the whole flow to
 * render.
 */

import { useRef, useState } from "react";

export function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <label className="font-ui block text-sm font-medium">{label}</label>
      {description && (
        <p className="mt-1 mb-2 text-xs leading-relaxed text-[color:var(--muted)]">{description}</p>
      )}
      {children}
    </div>
  );
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
        <input
          type="text"
          value={host}
          onChange={(e) => onChange(e.target.value, port)}
          className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
        />
      </Field>
      <Field label="Port">
        <input
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
        <span className="mt-1 block text-xs leading-relaxed text-[color:var(--muted)]">
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
  return (
    <div className="flex items-stretch gap-2">
      <input
        ref={inputRef}
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
        className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
      >
        {reveal ? "Hide" : "Show"}
      </button>
    </div>
  );
}
