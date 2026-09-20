"use client";

import Link from "next/link";
import { useState } from "react";

import { RunButton } from "@/components/RunButton";
import type { FirstModelState } from "@/lib/home";
import { startDownloadAndRun } from "@/lib/oneClickRun";
import { downloadSize, shortName } from "@/lib/starter";
import type { TargetNode } from "@/lib/nodeBudget";
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
 * A state machine on `state.kind` and nothing else, which is what let
 * S6's recommended model arrive as one more `kind` with one more branch
 * rather than as a rewrite. A download in flight is shown inside
 * whichever state applies, because the person who just clicked Download
 * on Discover and came back here should see it moving.
 */
export function FirstModelCard({
  state,
  downloads,
  node,
  onDownloadStarted,
}: {
  state: FirstModelState;
  /** The tray's download tasks, rendered inside the card while any run. */
  downloads: Task[];
  /** This machine, as Run's target (S3). Home runs models here. */
  node: TargetNode;
  /** Refresh the page's reads once a download has been accepted, so the
   * tray picks it up without waiting out a poll. */
  onDownloadStarted?: () => void;
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

  if (state.kind === "no-models-recommended") {
    return (
      <SuggestedModelCard
        model={state.model}
        reason={state.reason}
        downloads={downloads}
        node={node}
        onDownloadStarted={onDownloadStarted}
      />
    );
  }

  return (
    <section data-testid="home-first-model" data-state={state.kind} className={card}>
      <h2 className="font-ui text-base font-semibold">
        {state.kind === "no-models" ? "Get your first model" : "Run a model"}
      </h2>
      <p className="mt-1 text-sm text-[color:var(--muted)]">
        {state.kind === "no-models"
          ? "Find a model that fits this machine and download it into your own folder. Or point Eugene at models you already have."
          : state.only
            ? `${state.only.name} is on disk and not running.`
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
        ) : state.only ? (
          <>
            {/* One model, one click (S3): Run is the primary action, and
                its status line renders under it. The Library is where a
                different engine or hand-chosen flags live. */}
            <RunButton
              model={state.only}
              node={node}
              label={`Run ${state.only.name}`}
              className="min-w-0 flex-1 basis-full"
            />
            <Link href={`/library?model=${encodeURIComponent(state.only.id)}`} className={tertiary}>
              Choose settings in the Library
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
          Add an existing app or subscription
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
                <span className="block text-[0.6875rem] text-[color:var(--muted)] tabular-nums">
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

/**
 * Nothing on disk, and one model named for this machine.
 *
 * **One primary button, and it goes all the way to a running model** —
 * not "open the catalogue", and not "download and then come back".
 * §0.2 measured first chat at fifteen clicks after install and most of
 * them were choosing: a size, a quant, a publisher, a context. The
 * starter set has already made every one of those choices against this
 * machine's own memory, and says why in a sentence the person can argue
 * with. Choosing differently is one click away and stays a link, not a
 * second button (P3).
 *
 * **The chain survives this tab** (§6.3): the download carries
 * `runWhenReady`, so a person who closes the laptop across a 16 GB
 * transfer comes back to a console that claims the record and carries
 * on. Which is why there is no local error state here — the run store
 * owns the whole thing from the click, and the tray row is where it
 * says what happened.
 */
function SuggestedModelCard({
  model,
  reason,
  downloads,
  node,
  onDownloadStarted,
}: {
  model: NonNullable<Extract<FirstModelState, { kind: "no-models-recommended" }>["model"]>;
  reason: string;
  downloads: Task[];
  /** This machine, as the chain's target. Home runs models here. */
  node: TargetNode;
  onDownloadStarted?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const started = downloads.length > 0;

  function downloadAndRun() {
    setBusy(true);
    // One action, one task: the download, the engine question, the
    // profile and the launch are one tray entry from here (§6.3). The
    // store owns the failure from this point, so there is no local
    // error state -- the tray row says what went wrong and where.
    startDownloadAndRun(
      {
        repo: model.repo,
        file: model.file,
        label: shortName(model.baseModel),
        sizeBytes: model.sizeBytes,
      },
      node,
    );
    onDownloadStarted?.();
    setBusy(false);
  }

  return (
    <section data-testid="home-first-model" data-state="no-models-recommended" className={card}>
      <h2 className="font-ui text-base font-semibold">Get your first model</h2>
      <p className="mt-1 text-sm text-[color:var(--muted)]">
        Nothing is on disk yet. <strong>{shortName(model.baseModel)}</strong> is a good first one
        for this machine.
      </p>
      {reason && <p className="mt-1 text-xs text-[color:var(--muted)]">{reason}</p>}
      <p className="mt-1 text-xs text-[color:var(--muted)]">
        Download into your own folder. We’ll ask before installing llama.cpp and choose starting
        settings for this machine.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={downloadAndRun}
          disabled={busy || started}
          className={primary}
          data-testid="home-primary"
        >
          {started
            ? "Getting it…"
            : busy
              ? "Starting…"
              : `Download and run · ${downloadSize(model.sizeBytes)}`}
        </button>
        <Link href="/discover" className={tertiary}>
          Choose a different model
        </Link>
        <Link href="/library/folders?sel=library" className={tertiary}>
          I already have models
        </Link>
        <Link href="/backends/add" className={tertiary}>
          Add an existing app or subscription
        </Link>
      </div>
      <DownloadList downloads={downloads} />
    </section>
  );
}

/** The tray's download rows, rendered inside whichever card applies. */
function DownloadList({ downloads }: { downloads: Task[] }) {
  if (downloads.length === 0) return null;
  return (
    <ul data-testid="home-downloads" className="mt-3 flex flex-col gap-2">
      {downloads.map((task) => (
        <li key={task.id} className="text-xs">
          <Link href={task.href} className="block truncate hover:underline">
            {task.title}
          </Link>
          {task.detail && (
            <span className="block text-[0.6875rem] text-[color:var(--muted)] tabular-nums">
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
