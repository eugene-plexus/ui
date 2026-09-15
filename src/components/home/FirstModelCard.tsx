"use client";

import Link from "next/link";

import type { FirstModelState } from "@/lib/home";
import type { Task } from "@/lib/tasks";

/**
 * The card that names the next thing to do, until there is nothing left
 * to do before chatting.
 *
 * Hobbyist UX §6.1 and §0.3: before S1 the first thing a new user saw
 * after the wizard was a disabled text box reading "Waiting…". This is
 * the replacement — one primary button per state (P3, P8), in the
 * person's words (P5).
 *
 * A state machine on `state.kind` and nothing else, so S6's recommended
 * model ("Recommended for your card: …") arrives as one more `kind` with
 * one more branch here, not as a rewrite. A download in flight is shown
 * inside whichever state applies, because the person who just clicked
 * Download on Discover and came back here should see it moving.
 */
export function FirstModelCard({
  state,
  downloads,
}: {
  state: FirstModelState;
  /** The tray's download tasks, rendered inside the card while any run. */
  downloads: Task[];
}) {
  if (state.kind === "loading" || state.kind === "hidden") return null;

  if (state.kind === "library-unreachable") {
    return (
      <section data-testid="home-first-model" data-state={state.kind} className={card}>
        {/* Plain text, not a `.status-error` banner: this is the page a
            person lands on while the fleet restarts after sign-in, and
            the browser arc reads any error banner on landing as a wall of
            errors. */}
        <p className="text-sm text-[color:var(--muted)]">
          The library did not answer, so what is on disk is unknown right now.{" "}
          <Link href="/inference" className="underline">
            See what is running
          </Link>
          .
        </p>
      </section>
    );
  }

  return (
    <section data-testid="home-first-model" data-state={state.kind} className={card}>
      <h2 className="font-ui text-base font-semibold">
        {state.kind === "no-models" ? "Get your first model" : "Run a model"}
      </h2>
      <p className="mt-1 text-sm text-[color:var(--muted)]">
        {state.kind === "no-models"
          ? "Nothing is on disk yet. Find a model to download, or point Eugene at a folder that already has some."
          : `${state.count} model${state.count === 1 ? "" : "s"} on disk, none running.`}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {state.kind === "no-models" ? (
          <>
            <Link href="/discover" className={primary} data-testid="home-primary">
              Find a model
            </Link>
            <Link href="/library/folders?sel=library" className={secondary}>
              I already have models
            </Link>
          </>
        ) : (
          <Link href="/library" className={primary} data-testid="home-primary">
            Choose a model to run
          </Link>
        )}
        {/* Third, and quiet: an Ollama or a cloud CLI the person already
            runs is a way to a first answer that needs no download (S2 moved
            this out of the wizard). Tertiary so the one primary stays one. */}
        <Link href="/backends/add" className={tertiary}>
          Add an app you already run
        </Link>
      </div>
      {downloads.length > 0 && (
        <ul data-testid="home-downloads" className="mt-3 flex flex-col gap-2">
          {downloads.map((task) => (
            <li key={task.id} className="text-xs">
              <Link href={task.href} className="block truncate hover:underline">
                {task.title}
              </Link>
              {task.detail && (
                <span className="block text-[11px] text-[color:var(--muted)] tabular-nums">
                  {task.detail}
                </span>
              )}
              {task.progress !== undefined && (
                <span
                  className="mt-1 block h-1 overflow-hidden rounded-full bg-[color:var(--panel-hover)]"
                  role="progressbar"
                  aria-label={task.title}
                  aria-valuenow={Math.round(task.progress * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span
                    className="block h-full rounded-full bg-[color:var(--accent-left)] transition-[width] duration-300"
                    style={{ width: `${Math.round(task.progress * 100)}%` }}
                  />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const card =
  "rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-4";
const primary =
  "font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-4 py-2 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter] hover:brightness-110";
const secondary =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-4 py-2 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]";
const tertiary =
  "font-ui px-2 py-2 text-sm text-[color:var(--muted)] underline-offset-2 transition-colors hover:text-[color:var(--foreground)] hover:underline";
