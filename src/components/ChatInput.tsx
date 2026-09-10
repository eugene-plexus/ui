"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

/**
 * Bottom-anchored composer.
 *
 * Enter sends. Shift+Enter inserts a newline. Disabled while a turn is
 * in flight, and while no model is routable.
 *
 * The composer owns its text, except that `seed` can put something in it -
 * that is how editing an earlier message works. It carries a nonce because
 * the same text seeded twice is still a second request to seed it, and
 * comparing the strings would silently ignore the second.
 */
export function ChatInput({
  onSend,
  disabled,
  seed,
}: {
  onSend: (text: string) => void;
  disabled: boolean;
  seed?: { text: string; nonce: number };
}) {
  const [value, setValue] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const seenNonce = useRef(0);

  useEffect(() => {
    if (!seed || seed.nonce === seenNonce.current) return;
    seenNonce.current = seed.nonce;
    setValue(seed.text);
    // Focus with the caret at the end: the operator is here to change the
    // message, not to retype it.
    const el = textarea.current;
    if (el) {
      el.focus();
      requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
    }
  }, [seed]);

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
        ref={textarea}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        rows={2}
        placeholder={
          disabled ? "Waiting…" : "Send a message… (Enter to send, Shift+Enter for newline)"
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
