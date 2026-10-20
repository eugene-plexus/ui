"use client";

import { useEffect, useRef, type ReactNode } from "react";

import {
  answerAsk,
  answerInstall,
  cancelRun,
  closeRunQuestion,
  runQuestion,
  useRuns,
  type RunTask,
} from "@/lib/oneClickRun";
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
 * in.
 *
 * CX3: a download chain asks at the click, before anything is submitted
 * (`confirming`), so a long download ends in a running model, not in this
 * question. Escape there is Cancel: nothing has started. On a run already
 * waiting for its answer, Escape and Later only close the dialog; the run
 * keeps waiting and its tray row opens the question again. Cancel the run
 * is its own button.
 */
export function RunDialog() {
  const asking = runQuestion(useRuns());
  if (!asking) return null;
  return <RunDialogView task={asking} />;
}

/** The rendering, apart from the store, so it can be driven in jsdom. */
export function RunDialogView({
  task,
  onAnswer = (id, answer) => answerInstall(id, answer),
  onAsked = (id, answer) => answerAsk(id, answer),
  onCancel = (id) => cancelRun(id),
  onClose = (id) => closeRunQuestion(id),
}: {
  task: RunTask;
  onAnswer?: (id: string, answer: "install" | "skip") => void;
  onAsked?: (id: string, answer: "install" | "cancel") => void;
  onCancel?: (id: string) => void;
  onClose?: (id: string) => void;
}) {
  const asked = Boolean(task.confirming);
  const install = useRef<HTMLButtonElement | null>(null);
  const label = engineLabel(task.engine ?? "llama_cpp");

  useEffect(() => {
    install.current?.focus();
  }, [task.id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (asked) onAsked(task.id, "cancel");
      else onClose(task.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [task.id, asked, onAsked, onClose]);

  if (asked) {
    const what = task.preparing
      ? `prepares ${task.model.name} and then runs it`
      : `runs models like ${task.model.name}`;
    return (
      <Frame>
        <h2 id="run-dialog-title" className="font-ui text-base font-semibold">
          Install {label} too?
        </h2>
        <p className="mt-2 text-sm leading-relaxed">
          {task.node.label} does not have {label}, the program that {what}. Eugene downloads{" "}
          {task.model.name}, then installs {label} and starts it, so you can leave it running.
        </p>
        <p className="mt-1 text-sm leading-relaxed text-[color:var(--muted)]">
          {label} is a few hundred megabytes and lands in Eugene&rsquo;s own folder; nothing else on
          the machine changes.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            ref={install}
            onClick={() => onAsked(task.id, "install")}
            data-testid="run-install"
            className={primaryClass}
          >
            Install and run
          </button>
          <button
            type="button"
            onClick={() => onAsked(task.id, "cancel")}
            data-testid="run-cancel"
            className={quietClass}
          >
            Cancel
          </button>
        </div>
      </Frame>
    );
  }

  return (
    <Frame>
      <h2 id="run-dialog-title" className="font-ui text-base font-semibold">
        Install {label}?
      </h2>
      <p className="mt-2 text-sm leading-relaxed">
        I could not find {label} on {task.node.label}. Install it now?
      </p>
      <p className="mt-1 text-sm leading-relaxed text-[color:var(--muted)]">
        {task.preparing
          ? `${label} is the program that prepares ${task.model.name} and then runs it.`
          : `${label} is the program that runs models like ${task.model.name}.`}{" "}
        The download is a few hundred megabytes and lands in Eugene&rsquo;s own folder; nothing else
        on the machine changes.
      </p>
      {task.error && (
        <p role="alert" className="mt-2 text-sm">
          {task.error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          ref={install}
          onClick={() => onAnswer(task.id, "install")}
          data-testid="run-install"
          className={primaryClass}
        >
          Install
        </button>
        {/* A preparation needs its engine: without it nothing can be
              made, so there is no Skip (LS5, B54). */}
        {!task.preparing && (
          <button
            type="button"
            onClick={() => onAnswer(task.id, "skip")}
            data-testid="run-skip"
            className="action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-4 py-2 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
          >
            Skip
          </button>
        )}
        <button
          type="button"
          onClick={() => onClose(task.id)}
          data-testid="run-later"
          className={quietClass}
        >
          Later
        </button>
        <button
          type="button"
          onClick={() => onCancel(task.id)}
          data-testid="run-cancel"
          className={quietClass}
        >
          Cancel the run
        </button>
      </div>
      {!task.preparing && (
        <p className="mt-3 text-[0.6875rem] leading-relaxed text-[color:var(--muted)]">
          Skip is for advanced users: the model cannot run until an engine is installed by hand. It
          stays listed on Inference as stopped, with the reason, until then.
        </p>
      )}
      <p className="mt-1 text-[0.6875rem] leading-relaxed text-[color:var(--muted)]">
        Later keeps the run waiting; its row under Tasks asks again.
      </p>
    </Frame>
  );
}

const primaryClass =
  "action-button action-button--primary font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-4 py-2 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter] hover:brightness-110";
const quietClass =
  "font-ui px-2 py-2 text-sm text-[color:var(--muted)] underline-offset-2 hover:text-[color:var(--foreground)] hover:underline";

function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="run-dialog-title"
      data-testid="run-dialog"
    >
      <div className="w-full max-w-md rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-5 py-4 shadow-xl">
        {children}
      </div>
    </div>
  );
}
