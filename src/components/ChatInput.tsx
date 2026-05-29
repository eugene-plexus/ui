"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";

/**
 * Bottom-anchored composer.
 *
 * Enter sends. Shift+Enter inserts a newline. Disabled while a turn is
 * in flight to prevent racing the bicameral loop.
 */
export function ChatInput({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(e);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex items-end gap-2 border-t border-[color:var(--border)] bg-[color:var(--panel)] p-3"
    >
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        rows={2}
        placeholder={
          disabled
            ? "Eugene is thinking…"
            : "Message Eugene… (Enter to send, Shift+Enter for newline)"
        }
        disabled={disabled}
        className="flex-1 resize-none rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm leading-relaxed transition-colors outline-none hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)] disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-4 py-2 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:brightness-100"
      >
        Send
      </button>
    </form>
  );
}
