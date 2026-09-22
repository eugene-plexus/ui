"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { isComposing } from "@/lib/composing";
import { type AttachmentText, checkAttachment, inlineAttachments } from "@/lib/diagnostic";
import {
  type ImageAttachment,
  buildMessageContent,
  checkImageAttachment,
  checkImageSet,
  imageDimensions,
  isImageMime,
  toDataUrl,
} from "@/lib/imageAttachments";
import type { MessageContentPart } from "@/lib/types";

/**
 * Bottom-anchored composer.
 *
 * Enter sends. Shift+Enter inserts a newline. An input method's Enter
 * (confirming a Japanese, Chinese or Korean word) does neither: it
 * belongs to the IME. Disabled while a turn is in flight, and while no
 * model is routable. The box grows with its text to ten lines
 * (`max-h-[calc(10lh + padding + border)]`), then scrolls.
 *
 * The composer owns its text, except that `seed` can put something in it -
 * that is how editing an earlier message works. It carries a nonce because
 * the same text seeded twice is still a second request to seed it, and
 * comparing the strings would silently ignore the second.
 *
 * **Attachments** come in two kinds, routed by MIME type. Text files
 * are read in the browser and inlined into the message with a fence
 * naming each one -- what a coding harness does when it pastes a file.
 * PNG and JPEG images become inline `image_url` content parts, the
 * only image form the contract carries (remote URLs are never
 * fetched). A message with no images is still a plain string, so
 * text-only requests are byte-for-byte what they always were.
 */
export function ChatInput({
  onSend,
  disabled,
  seed,
  pending = false,
  onStop,
  imageNote,
}: {
  onSend: (content: string | MessageContentPart[]) => void;
  disabled: boolean;
  seed?: { text: string; nonce: number };
  /** A turn is in flight. With `onStop`, Send becomes Stop and Escape
   * cancels; whatever streamed so far is kept by the caller. */
  pending?: boolean;
  onStop?: () => void;
  /** Why attached images may not work against the selected model, or
   * null. Shown only while images are attached: it is about the
   * combination, not about either half alone. */
  imageNote?: string | null;
}) {
  const [value, setValue] = useState("");
  const [files, setFiles] = useState<AttachmentText[]>([]);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const seenNonce = useRef(0);
  const wasPending = useRef(false);

  // When the turn finishes, put the caret back in the composer: the
  // next thing an operator does after reading a reply is type, and a
  // disabled textarea drops focus so it cannot come back by itself.
  useEffect(() => {
    if (wasPending.current && !pending && !disabled) textarea.current?.focus();
    wasPending.current = pending;
  }, [pending, disabled]);

  // And on arrival: the page opens ready to type, without a click. The
  // composer starts disabled until a model is routable, so this fires
  // on the first enable rather than on mount — and only while nothing
  // else holds focus, because stealing the caret from a person already
  // typing in the diagnostic panel would be worse than the click.
  const focusedOnArrival = useRef(false);
  useEffect(() => {
    if (focusedOnArrival.current || disabled) return;
    focusedOnArrival.current = true;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    textarea.current?.focus();
  }, [disabled]);

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

  // Grow with the text, up to the cap the class sets (ten lines), and
  // scroll past it. Two rows used to be the whole box, so a pasted
  // paragraph scrolled inside a slot two lines tall. Measured before
  // paint so the box never shows at the wrong height, and set to `auto`
  // first because scrollHeight never reports less than the current
  // height: without that the box could grow but never shrink back after
  // a send. `rows={2}` stays the floor.
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    // border-box sizing: the height includes the border, scrollHeight
    // does not.
    const border = el.offsetHeight - el.clientHeight;
    el.style.height = `${el.scrollHeight + border}px`;
  }, [value]);

  const hasContent = value.trim() !== "" || files.length > 0 || images.length > 0;
  // The request-level image limits (count, total bytes) belong to the
  // set, not to any one file, so they are checked here where the set
  // is known and they block Send rather than surfacing as the
  // gateway's 400 after megabytes crossed the wire.
  const imageSetError = checkImageSet(images);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!hasContent || disabled || imageSetError !== null) return;
    onSend(buildMessageContent(inlineAttachments(value, files), images));
    setValue("");
    setFiles([]);
    setImages([]);
    setFileError(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // An input method's confirming Enter is the end of a word, not of the
    // message: let the IME have it. See `lib/composing.ts`.
    if (e.key === "Enter" && !e.shiftKey && !isComposing(e.nativeEvent)) {
      e.preventDefault();
      submit(e);
    }
  }

  // Escape stops the in-flight turn from anywhere on the page: the
  // textarea is disabled while pending, so a key handler on it would
  // never fire exactly when stopping is possible.
  useEffect(() => {
    if (!pending || !onStop) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onStop();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pending, onStop]);

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const added: AttachmentText[] = [];
    const addedImages: ImageAttachment[] = [];
    let error: string | null = null;
    for (const file of Array.from(list)) {
      // MIME decides the route: a PNG or JPEG becomes an inline image
      // part; everything else takes the text path, whose UTF-8 check
      // refuses any other binary rather than inlining mojibake.
      if (isImageMime(file.type)) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const refusal = checkImageAttachment(file.name, file.type, bytes);
        if (refusal) {
          error = refusal;
          continue;
        }
        // checkImageAttachment proved the header parses, so the
        // dimensions read again here cannot be null.
        const dims = imageDimensions(file.type, bytes);
        addedImages.push({
          name: file.name,
          mime: file.type,
          size: bytes.length,
          width: dims?.width ?? 0,
          height: dims?.height ?? 0,
          dataUrl: toDataUrl(file.type, bytes),
        });
        continue;
      }
      const text = new TextDecoder("utf-8").decode(await file.arrayBuffer());
      const refusal = checkAttachment(file.name, file.size, text);
      if (refusal) {
        error = refusal;
        continue;
      }
      added.push({ name: file.name, size: file.size, text });
    }
    setFiles((current) => [...current, ...added]);
    setImages((current) => [...current, ...addedImages]);
    setFileError(error);
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 border-t border-[color:var(--border)] bg-[color:var(--panel)] p-3"
    >
      {(files.length > 0 || images.length > 0 || fileError) && (
        <div className="font-ui flex flex-wrap items-center gap-2 text-[0.6875rem]">
          {images.map((img, i) => (
            <span
              key={`${img.name}-${i}`}
              data-testid="image-chip"
              className="flex items-center gap-1.5 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-1.5 py-0.5 text-[color:var(--muted)]"
            >
              {/* The pixels the model will see; alt is the filename the
                  chip already shows, so screen readers hear it once. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.dataUrl} alt="" className="h-7 w-7 rounded-[2px] object-cover" />
              <span className="font-mono text-[color:var(--foreground)]">{img.name}</span>
              <span>
                {img.width}×{img.height}
              </span>
              <button
                type="button"
                onClick={() => setImages((current) => current.filter((_, j) => j !== i))}
                title="Remove this image"
                className="px-1 hover:text-[color:var(--foreground)]"
                aria-label={`Remove ${img.name}`}
              >
                ×
              </button>
            </span>
          ))}
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
          {imageSetError && (
            <span
              data-testid="image-set-error"
              className="status-error rounded-[var(--radius)] px-2 py-0.5"
            >
              {imageSetError}
            </span>
          )}
          {images.length > 0 && !imageSetError && imageNote && (
            <span
              data-testid="image-model-note"
              className="status-warn rounded-[var(--radius)] px-2 py-0.5"
            >
              {imageNote}
            </span>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2 sm:flex-nowrap">
        <textarea
          ref={textarea}
          data-testid="composer"
          aria-label="Message"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder={
            disabled
              ? "Waiting…"
              : "Send a message… (Enter to send, Shift+Enter for newline; attach text files or PNG/JPEG images)"
          }
          disabled={disabled}
          className="max-h-[calc(10lh_+_1rem_+_2px)] min-w-0 basis-full resize-none overflow-y-auto rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm leading-relaxed transition-colors outline-none hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)] disabled:opacity-50 sm:flex-1 sm:basis-auto"
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
          title="Attach text files (inlined into the message, as a harness would paste them) or PNG/JPEG images (sent inline, up to 4 per request, 5 MB each)"
          className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2 text-sm text-[color:var(--muted)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30"
        >
          Attach
        </button>
        {pending && onStop ? (
          <button
            type="button"
            data-testid="stop-turn"
            onClick={onStop}
            title="Stop this turn (Escape). Whatever has streamed so far is kept."
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-4 py-2 text-sm font-medium text-[color:var(--foreground)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={disabled || !hasContent || imageSetError !== null}
            className="font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-4 py-2 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:brightness-100"
          >
            Send
          </button>
        )}
      </div>
    </form>
  );
}
