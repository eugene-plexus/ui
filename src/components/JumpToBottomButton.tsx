"use client";

/**
 * Floating button that appears when a scroll container is not pinned to
 * its bottom. Click to smooth-scroll back. Used by both `ChatLog` and
 * `ConsciousnessStream`.
 */
export function JumpToBottomButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Scroll to bottom"
      className="absolute right-4 bottom-4 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--panel)] text-[color:var(--foreground)] shadow-lg backdrop-blur-md transition-colors hover:bg-[color:var(--panel-soft)]"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 5v14M19 12l-7 7-7-7" />
      </svg>
    </button>
  );
}
