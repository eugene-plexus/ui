"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * A button for something that cannot be taken back, asked twice inline.
 *
 * The first click does nothing but ask: it swaps the button for a short
 * sentence saying what will happen, the action itself and a way out. This
 * is the shape the downloads panel already used ("delete partial" / "keep"),
 * made one component so every irreversible action in the UI asks the same
 * way instead of some using the browser's dialog and some asking nothing.
 *
 * Focus moves to the way OUT, not to the action: a second Enter on a
 * button that has just changed underneath the pointer should be the
 * harmless answer. Escape is the same answer. And backing out puts focus
 * back on the button that asked -- both ways out unmount the element
 * holding it, which otherwise drops a keyboard user onto <body>.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  cancelLabel = "Keep",
  prompt,
  onConfirm,
  disabled = false,
  className = "",
  confirmClassName = "",
  title,
  ariaLabel,
  testId,
  onAsking,
}: {
  /** What the button says before anyone has asked. */
  label: ReactNode;
  /** What the action says once asked; the label when omitted. */
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  /** One sentence saying what will be lost. */
  prompt?: ReactNode;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
  className?: string;
  /** Extra classes for the action once asked (usually a danger colour). */
  confirmClassName?: string;
  title?: string;
  /** The button's accessible name before it asks, when its words alone
   * repeat on every row ("Remove"): name what it acts on. */
  ariaLabel?: string;
  testId?: string;
  /**
   * Told when it starts and stops asking, so a screen can step its other
   * buttons aside while the question is open: a row's action area has no
   * room for a sentence beside four buttons (ui#14).
   */
  onAsking?: (asking: boolean) => void;
}) {
  const [asking, setAsking] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const returnFocus = useRef(false);
  const promptId = useId();

  useEffect(() => {
    onAsking?.(asking);
    // Told on a change of `asking` only, not on a new callback each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking]);

  useEffect(() => {
    if (asking) cancelRef.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [asking]);

  function backOut() {
    returnFocus.current = true;
    setAsking(false);
  }

  if (!asking) {
    return (
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setAsking(true)}
        disabled={disabled}
        className={className}
        title={title}
        aria-label={ariaLabel}
        data-testid={testId}
      >
        {label}
      </button>
    );
  }

  // The question sits on a line of its own above its two answers, and is
  // allowed to wrap: a row's action cell is often `whitespace-nowrap`, and
  // a sentence that inherits that widens the table until its buttons need
  // a sideways scroll to reach (ui#14).
  return (
    <span
      role="group"
      aria-label="Confirm"
      className="inline-flex max-w-[16rem] flex-wrap items-center justify-end gap-1 text-left whitespace-normal"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          backOut();
        }
      }}
    >
      {prompt && (
        <span id={promptId} className="basis-full text-xs">
          {prompt}
        </span>
      )}
      <button
        type="button"
        onClick={() => {
          setAsking(false);
          void onConfirm();
        }}
        disabled={disabled}
        aria-describedby={prompt ? promptId : undefined}
        className={`${className} text-status-error ${confirmClassName}`}
        data-testid={testId ? `${testId}-confirm` : undefined}
      >
        {confirmLabel ?? label}
      </button>
      <button
        type="button"
        ref={cancelRef}
        aria-describedby={prompt ? promptId : undefined}
        onClick={backOut}
        className={className}
        data-testid={testId ? `${testId}-cancel` : undefined}
      >
        {cancelLabel}
      </button>
    </span>
  );
}
