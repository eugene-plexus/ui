"use client";

/**
 * The frame around every screen: the step indicator and the navigation
 * buttons. Split from the screens at M9 because the rule about which
 * buttons appear is a property of the flow, not of any one screen.
 */

import { TOTAL_SCREENS } from "./draft";

export function WizardHeader({ screen }: { screen: number }) {
  // Progress fill = current screen / total. Screen 1 reads 20% (the user
  // has landed on the first screen, not made zero progress); the last
  // screen reads 100%, where Start is the only action left.
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
  onCancel,
  onBack,
  onNext,
  onStart,
  startLabel,
  starting,
  canContinue,
}: {
  screen: number;
  onCancel: () => void;
  onBack: () => void;
  onNext: () => void;
  onStart: () => void;
  startLabel: string;
  starting: boolean;
  canContinue: boolean;
}) {
  const showCancel = screen === 1;
  const showBack = screen > 1;
  const showStart = screen === TOTAL_SCREENS;

  return (
    <footer className="flex items-center justify-between border-t border-[color:var(--border)] bg-[color:var(--panel)] px-6 py-4">
      <div>
        {showCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-4 py-2 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
          >
            Cancel
          </button>
        ) : showBack ? (
          <button
            type="button"
            onClick={onBack}
            disabled={starting}
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-4 py-2 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Back
          </button>
        ) : null}
      </div>
      <div>
        {showStart ? (
          <button
            type="button"
            onClick={onStart}
            disabled={starting}
            className="font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-5 py-2 text-xs font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {starting ? "Working…" : startLabel}
          </button>
        ) : (
          <button
            type="button"
            onClick={onNext}
            disabled={!canContinue}
            className="font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-5 py-2 text-xs font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continue →
          </button>
        )}
      </div>
    </footer>
  );
}
