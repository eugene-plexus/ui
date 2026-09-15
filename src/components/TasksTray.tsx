"use client";

import { Activity } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import type { Task } from "@/lib/tasks";
import { useTasks } from "@/lib/useTasks";

/**
 * The header's tasks tray: what is happening in the background, from
 * every signed-in screen.
 *
 * Principle P7 of the hobbyist UX design (*background work is visible
 * everywhere*), and its §0.7 measurement: a download started on Discover
 * was invisible from Config, an engine install from anywhere but the
 * Inference row that started it, a model loading from anywhere but
 * Inference. Proxmox's task log is the model — one place, every task,
 * always in view.
 *
 * A button with a count, opening a list. Each task is a link to the
 * screen that can act on it, with a progress bar when the work has a
 * known total. A disclosure, not a route: `Escape` and a click outside
 * close it, focus returns to the button, and the list is a list — no
 * pause or cancel here, because those verbs have consequences the
 * Downloads panel spells out beside them and a tray should not.
 */
export function TasksTray() {
  const { tasks } = useTasks();
  return <TasksTrayView tasks={tasks} />;
}

/** The rendering, apart from the polling, so it can be driven in jsdom. */
export function TasksTrayView({ tasks }: { tasks: Task[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    }
    function onPointer(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  const count = tasks.length;
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        ref={button}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={popoverId}
        data-testid="tasks-tray"
        className={`font-ui flex items-center gap-1.5 rounded-[var(--radius)] border px-2.5 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] ${
          count > 0 ? "border-[color:var(--accent-left)]" : "border-[color:var(--border)]"
        }`}
        title="Downloads, installs, models loading and runs you started, wherever they were started"
      >
        <Activity size={14} aria-hidden="true" data-icon="Activity" />
        Tasks
        {count > 0 && (
          <span
            data-testid="tasks-count"
            className="rounded-full bg-[color:var(--accent-left)] px-1.5 text-[10px] font-semibold text-[color:var(--on-accent-left)] tabular-nums"
          >
            {count}
          </span>
        )}
      </button>
      {open && (
        <div
          id={popoverId}
          role="region"
          aria-label="Background tasks"
          data-testid="tasks-popover"
          className="absolute right-0 z-30 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] p-2 shadow-lg"
        >
          {count === 0 ? (
            <p className="font-ui px-1 py-1.5 text-xs text-[color:var(--muted)]">
              Nothing is running in the background.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {tasks.map((task) => (
                <li key={task.id}>
                  <TaskRow task={task} onFollow={() => setOpen(false)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, onFollow }: { task: Task; onFollow: () => void }) {
  const percent = task.progress !== undefined ? Math.round(task.progress * 100) : null;
  const detailClass =
    task.tone === "error"
      ? "text-status-error"
      : task.tone === "ok"
        ? "text-status-success"
        : "text-[color:var(--muted)]";
  return (
    // The dismiss is a sibling of the link, not a child: a button inside
    // an anchor is not valid HTML and screen readers read it as one thing.
    <div className="relative">
      <Link
        href={task.href}
        onClick={onFollow}
        data-task-kind={task.kind}
        data-task-tone={task.tone}
        className="font-ui block rounded-[var(--radius)] px-2 py-1.5 text-xs transition-colors hover:bg-[color:var(--panel-hover)]"
      >
        <span className={`block truncate ${task.dismiss ? "pr-6" : ""}`} title={task.title}>
          {task.title}
        </span>
        {task.detail && (
          // A failure is the one line here that must not truncate: it is
          // the component's own sentence naming the fix.
          <span
            className={`block text-[11px] tabular-nums ${detailClass} ${task.tone === "error" ? "" : "truncate"}`}
            title={task.detail}
          >
            {task.detail}
          </span>
        )}
        {percent !== null && (
          <span
            className="mt-1 block h-1 overflow-hidden rounded-full bg-[color:var(--panel-hover)]"
            role="progressbar"
            aria-label={task.title}
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span
              className="block h-full rounded-full bg-[color:var(--accent-left)] transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </span>
        )}
      </Link>
      {task.dismiss && (
        // The browser's own finished task: dismissing it changes nothing
        // on any component, which is why this verb is allowed here and
        // pause / cancel are not.
        <button
          type="button"
          aria-label={`Dismiss: ${task.title}`}
          data-testid="task-dismiss"
          onClick={() => task.dismiss?.()}
          className="absolute top-1 right-1 rounded px-1 text-[11px] text-[color:var(--muted)] hover:bg-[color:var(--border)] hover:text-[color:var(--foreground)]"
        >
          ×
        </button>
      )}
    </div>
  );
}
