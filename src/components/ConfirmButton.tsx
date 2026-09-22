"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

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
 * harmless answer. Escape is the same answer.
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
  testId,
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
  testId?: string;
}) {
  const [asking, setAsking] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (asking) cancelRef.current?.focus();
  }, [asking]);

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        disabled={disabled}
        className={className}
        title={title}
        data-testid={testId}
      >
        {label}
      </button>
    );
  }

  return (
    <span
      role="group"
      aria-label="Confirm"
      className="inline-flex flex-wrap items-center gap-1"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setAsking(false);
        }
      }}
    >
      {prompt && <span className="text-xs">{prompt}</span>}
      <button
        type="button"
        onClick={() => {
          setAsking(false);
          void onConfirm();
        }}
        disabled={disabled}
        className={`${className} text-status-error ${confirmClassName}`}
        data-testid={testId ? `${testId}-confirm` : undefined}
      >
        {confirmLabel ?? label}
      </button>
      <button
        type="button"
        ref={cancelRef}
        onClick={() => setAsking(false)}
        className={className}
        data-testid={testId ? `${testId}-cancel` : undefined}
      >
        {cancelLabel}
      </button>
    </span>
  );
}
