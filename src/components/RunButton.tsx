"use client";

import Link from "next/link";

import type { TargetNode } from "@/lib/nodeBudget";
import {
  describeRunDetail,
  dismissRun,
  findRun,
  isTerminal,
  startRun,
  useRuns,
  type RunTask,
} from "@/lib/oneClickRun";
import type { LibraryModel } from "@/lib/types";

/**
 * **Run**: the one button that takes a model on disk to `ready`
 * (hobbyist UX §7 S3). Where it appears — a finished download, the
 * Library's model detail, Home's first-model card — it is the primary
 * action, and the profile editor beside it is the expert path.
 *
 * The button starts a run in the store (`lib/oneClickRun.ts`) and then
 * renders that run's line under itself: the step, the install's bytes,
 * the failure in the component's own words with *Try again*. The same
 * object is in the header tray, so leaving the screen loses nothing.
 */
export function RunButton({
  model,
  node,
  size = "primary",
  label = "Run",
  disabledReason = null,
  className = "",
}: {
  model: LibraryModel;
  /** Where it runs. Null until the picker has resolved; the button waits. */
  node: TargetNode | null;
  size?: "primary" | "small";
  label?: string;
  /** When set, the button is disabled and this is its tooltip. */
  disabledReason?: string | null;
  className?: string;
}) {
  const runs = useRuns();
  const task = node ? (findRun(model.id, node.target) ?? null) : null;
  const busy = task !== null && !isTerminal(task.step);
  // `runs` is read so a store change re-renders this button; `findRun`
  // reads the same store synchronously.
  void runs;

  const disabled = !node || busy || disabledReason !== null || model.status !== "present";
  const title = disabledReason
    ? disabledReason
    : model.status !== "present"
      ? "The file is not where the library last saw it."
      : node
        ? `Start ${model.name} on ${node.local ? "this machine" : node.label}. If nothing here can run it yet, you will be asked before anything is installed.`
        : "Working out which machine this would run on…";

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => node && startRun(model, node)}
        disabled={disabled}
        title={title}
        data-testid="run-button"
        className={size === "primary" ? primary : small}
      >
        {busy ? "Running…" : label}
      </button>
      {task && <RunStatus task={task} onRetry={() => node && startRun(model, node)} />}
    </div>
  );
}

/** One line about a run, under the button that started it. */
export function RunStatus({ task, onRetry }: { task: RunTask; onRetry: () => void }) {
  const { detail, progress } = describeRunDetail(task);
  const tone =
    task.step === "failed"
      ? "status-error"
      : task.step === "ready"
        ? "status-success"
        : task.step === "skipped"
          ? "status-warn"
          : "";
  return (
    <div
      className={`mt-2 rounded-[var(--radius)] border px-3 py-2 text-sm leading-relaxed ${tone || "border-[color:var(--border)] bg-[color:var(--panel-soft)]"}`}
      data-testid="run-status"
      data-step={task.step}
    >
      <p className="tabular-nums">{detail}</p>
      {progress !== undefined && (
        <span
          className="mt-1 block h-1 overflow-hidden rounded-full bg-[color:var(--panel-hover)]"
          role="progressbar"
          aria-label={`Installing on ${task.node.label}`}
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span
            className="block h-full rounded-full bg-[color:var(--accent-left)] transition-[width] duration-300"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </span>
      )}
      {isTerminal(task.step) && (
        <p className="mt-1.5 flex flex-wrap items-center gap-2">
          {task.step === "ready" && (
            <Link href="/" className="underline" data-testid="run-try-it">
              Try it on Home
            </Link>
          )}
          {task.step !== "ready" && (
            <Link href="/inference" className="underline">
              See it on Inference
            </Link>
          )}
          {task.step === "failed" && (
            <button type="button" onClick={onRetry} className={small} data-testid="run-retry">
              Try again
            </button>
          )}
          <button
            type="button"
            onClick={() => dismissRun(task.id)}
            className="text-[color:var(--muted)] underline-offset-2 hover:underline"
            data-testid="run-dismiss"
          >
            Dismiss
          </button>
        </p>
      )}
    </div>
  );
}

const primary =
  "font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-4 py-2 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100";
const small =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-0.5 text-[0.6875rem] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";
