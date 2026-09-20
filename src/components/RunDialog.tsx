"use client";

import { useEffect, useRef } from "react";

import { answerInstall, dismissRun, useRuns, type RunTask } from "@/lib/oneClickRun";
import { engineLabel } from "@/lib/tasks";

/**
 * The one question one-click run ever asks (hobbyist UX decision #6, as
 * Troy amended it): *"I could not find llama.cpp on this machine. Install
 * it now?"* Install is the default and the primary button; Skip carries
 * the line that it is for advanced users and leaves the model listed on
 * Inference as stopped.
 *
 * Mounted once, in the shell, so the question appears wherever the person
 * is when the run reaches it — on the Library, on Home, on Discover — in
 * the same place they are looking (§7 S3: "a progress line in the same
 * place the user is looking"). It reads the run store; nothing is passed
 * in. Escape or Cancel abandons the run: nothing has been declared yet,
 * so there is nothing to undo.
 */
export function RunDialog() {
  const runs = useRuns();
  const asking = runs.find((r) => r.step === "awaiting-install") ?? null;
  if (!asking) return null;
  return <RunDialogView task={asking} />;
}

/** The rendering, apart from the store, so it can be driven in jsdom. */
export function RunDialogView({
  task,
  onAnswer = (id, answer) => answerInstall(id, answer),
  onCancel = (id) => dismissRun(id),
}: {
  task: RunTask;
  onAnswer?: (id: string, answer: "install" | "skip") => void;
  onCancel?: (id: string) => void;
}) {
  const install = useRef<HTMLButtonElement | null>(null);
  const label = engineLabel(task.engine ?? "llama_cpp");

  useEffect(() => {
    install.current?.focus();
  }, [task.id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel(task.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [task.id, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="run-dialog-title"
      data-testid="run-dialog"
    >
      <div className="w-full max-w-md rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-5 py-4 shadow-xl">
        <h2 id="run-dialog-title" className="font-ui text-base font-semibold">
          Install {label}?
        </h2>
        <p className="mt-2 text-sm leading-relaxed">
          I could not find {label} on {task.node.label}. Install it now?
        </p>
        <p className="mt-1 text-xs leading-relaxed text-[color:var(--muted)]">
          {label} is the program that runs models like {task.model.name}. The download is a few
          hundred megabytes and lands in Eugene&rsquo;s own folder; nothing else on the machine
          changes.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            ref={install}
            onClick={() => onAnswer(task.id, "install")}
            data-testid="run-install"
            className="font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-4 py-2 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter] hover:brightness-110"
          >
            Install
          </button>
          <button
            type="button"
            onClick={() => onAnswer(task.id, "skip")}
            data-testid="run-skip"
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-4 py-2 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => onCancel(task.id)}
            data-testid="run-cancel"
            className="font-ui px-2 py-2 text-sm text-[color:var(--muted)] underline-offset-2 hover:text-[color:var(--foreground)] hover:underline"
          >
            Cancel
          </button>
        </div>
        <p className="mt-3 text-[0.6875rem] leading-relaxed text-[color:var(--muted)]">
          Skip is for advanced users: the model cannot run until an engine is installed by hand. It
          stays listed on Inference as stopped, with the reason, until then.
        </p>
      </div>
    </div>
  );
}
