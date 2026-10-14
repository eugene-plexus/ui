"use client";

import type { SetupGateState } from "@/lib/useSetupGate";

/**
 * What an install-root page shows until the setup gate opens.
 *
 * One component for the three pages that use `useSetupGate`, because
 * each of them had its own copy of the "Checking" line and a page that
 * forgets the `unreachable` case renders its whole body over reads that
 * will all fail. Rendered for every state that is not `ready`, so a new
 * state added to the gate lands here rather than in a page's body.
 *
 * The unreachable sentence names what a person can check (is it still
 * starting, did it stop) and offers the one action that helps from a
 * browser. Reloading would also work, but a reload of a page served by
 * the thing that is not answering is a browser error page, which is
 * worse than this one.
 */
export function SetupGateScreen({
  state,
  onRetry,
}: {
  state: Exclude<SetupGateState, "ready">;
  onRetry: () => void;
}) {
  if (state === "unreachable") {
    return (
      <main className="relative z-10 flex h-screen items-center justify-center p-4">
        <div
          role="alert"
          data-testid="setup-gate-unreachable"
          className="font-ui flex max-w-sm flex-col items-center gap-3 text-center text-sm"
        >
          <p className="font-medium text-[color:var(--foreground)]">
            Can&rsquo;t reach Eugene on this machine.
          </p>
          <p className="text-[color:var(--muted)]">
            It may still be starting, or it may have stopped. Check that it is running, then try
            again.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1.5 font-medium text-[color:var(--on-accent-left)] hover:brightness-110"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }
  return (
    <main className="relative z-10 flex h-screen items-center justify-center">
      <p className="font-ui text-sm text-[color:var(--muted)]">Checking setup state…</p>
    </main>
  );
}
