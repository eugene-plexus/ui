"use client";

/**
 * The frame around every screen: the step indicator and the navigation
 * buttons. Split from the screens at M9 because the rule about which
 * buttons appear is a property of the flow, not of any one screen.
 *
 * Since S2 there are two screens and each has ONE primary action that
 * writes: Continue commits the passphrase and Finish commits the folder.
 * There is no Back, because after Continue the install exists and there
 * is nothing on screen 1 left to change; and Cancel is offered only on
 * screen 1 before Continue is pressed, for the same reason.
 */

import { TOTAL_SCREENS } from "./draft";

export function WizardHeader({ screen }: { screen: number }) {
  // Progress fill = current screen / total. Screen 1 reads 50% (the user
  // has landed on the first screen, not made zero progress); screen 2
  // reads 100%, where Finish is the only action left.
  const progressPercent = Math.round((screen / TOTAL_SCREENS) * 100);
  return (
    <header className="bg-[color:var(--panel)]">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <p className="font-mono text-[10px] tracking-wider text-[color:var(--muted)] uppercase">
            first-run setup
          </p>
          <h1 className="font-ui text-base font-semibold">Eugene Plexus</h1>
        </div>
        <p className="font-mono text-[11px] text-[color:var(--muted)]">
          Step {screen} of {TOTAL_SCREENS}
        </p>
      </div>
      <div
        className="h-1 w-full bg-[color:var(--border)]"
        role="progressbar"
        aria-valuenow={progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Setup progress: step ${screen} of ${TOTAL_SCREENS}`}
      >
        <div
          className="h-full bg-[color:var(--accent-left)] transition-[width] duration-300 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </header>
  );
}

export function WizardFooter({
  screen,
  working,
  canProceed,
  onCancel,
  onPrimary,
}: {
  screen: number;
  /** A write is in flight: the primary button shows its working label and
   * nothing on the footer can be pressed. */
  working: boolean;
  canProceed: boolean;
  onCancel: () => void;
  onPrimary: () => void;
}) {
  const last = screen === TOTAL_SCREENS;
  const label = last ? "Finish" : "Continue";
  const workingLabel = last ? "Finishing…" : "Setting up…";
  // Cancel only before anything has been written. Once Continue has run
  // the install is initialized, and "cancel" would promise an undo that
  // does not exist.
  const showCancel = screen === 1 && !working;

  return (
    <footer className="flex items-center justify-between border-t border-[color:var(--border)] bg-[color:var(--panel)] px-6 py-4">
      <div>
        {showCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-4 py-2 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
          >
            Cancel
          </button>
        )}
      </div>
      <div>
        <button
          type="button"
          onClick={onPrimary}
          disabled={working || !canProceed}
          className="font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-5 py-2 text-xs font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {working ? workingLabel : label}
        </button>
      </div>
    </footer>
  );
}
