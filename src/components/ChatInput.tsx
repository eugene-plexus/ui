"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { type AttachmentText, checkAttachment, inlineAttachments } from "@/lib/diagnostic";

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
 *
 * **Attachments** are text files, read in the browser and inlined into
 * the message with a fence naming each one -- the only wire shape the
 * contract has (`content` is a string) and the one a coding harness uses
 * when it pastes a file into a conversation. `onSend` still receives one
 * string: what is sent is what the transcript shows.
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
  const [files, setFiles] = useState<AttachmentText[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
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

  const hasContent = value.trim() !== "" || files.length > 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!hasContent || disabled) return;
    onSend(inlineAttachments(value, files));
    setValue("");
    setFiles([]);
    setFileError(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(e);
    }
  }

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const added: AttachmentText[] = [];
    let error: string | null = null;
    for (const file of Array.from(list)) {
      // Decoded as UTF-8 with replacement, so a binary file announces
      // itself as U+FFFD and is refused rather than inlined as mojibake.
      const text = new TextDecoder("utf-8").decode(await file.arrayBuffer());
      const refusal = checkAttachment(file.name, file.size, text);
      if (refusal) {
        error = refusal;
        continue;
      }
      added.push({ name: file.name, size: file.size, text });
    }
    setFiles((current) => [...current, ...added]);
    setFileError(error);
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 border-t border-[color:var(--border)] bg-[color:var(--panel)] p-3"
    >
      {(files.length > 0 || fileError) && (
        <div className="font-ui flex flex-wrap items-center gap-2 text-[11px]">
          {files.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              data-testid="attachment-chip"
              className="flex items-center gap-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-0.5 text-[color:var(--muted)]"
            >
              <span className="font-mono text-[color:var(--foreground)]">{f.name}</span>
              <span>{f.size.toLocaleString("en-US")} bytes</span>
              <button
                type="button"
                onClick={() => setFiles((current) => current.filter((_, j) => j !== i))}
                title="Remove this attachment"
                className="px-1 hover:text-[color:var(--foreground)]"
                aria-label={`Remove ${f.name}`}
              >
                ×
              </button>
            </span>
          ))}
          {fileError && (
            <span className="status-error rounded-[var(--radius)] px-2 py-0.5">{fileError}</span>
          )}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={textarea}
          data-testid="composer"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder={
            disabled
              ? "Waiting…"
              : "Send a message… (Enter to send, Shift+Enter for newline; attach text files to inline them)"
          }
          disabled={disabled}
          className="flex-1 resize-none rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm leading-relaxed transition-colors outline-none hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)] disabled:opacity-50"
        />
        <input
          ref={fileInput}
          data-testid="attach-input"
          type="file"
          multiple
          onChange={(e) => void addFiles(e.target.files)}
          className="hidden"
          tabIndex={-1}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={disabled}
          title="Attach text files; their contents are inlined into the message, as a harness would paste them"
          className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2 text-sm text-[color:var(--muted)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30"
        >
          Attach
        </button>
        <button
          type="submit"
          disabled={disabled || !hasContent}
          className="font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-4 py-2 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:brightness-100"
        >
          Send
        </button>
      </div>
    </form>
  );
}
