"use client";

import { useState } from "react";

import { RunStatus } from "@/components/RunButton";
import { engineName } from "@/lib/issues";
import { formatBytes } from "@/components/FitBadge";
import type { TargetNode } from "@/lib/nodeBudget";
import { isTerminal, runById, useRuns, type RunPreparation } from "@/lib/oneClickRun";
import type { SupportedModel } from "@/lib/types";

/**
 * Prepare a model for an engine that runs it only after preparing it (LS5,
 * library-sources-and-engines.md §6.6). Asked for, never implied (B54): Run
 * picks an engine that runs a model as it is, and this is the separate
 * action beside it — on the Library's model page for a GGUF on the engine's
 * own list, and on Discover's entry of that list as *Download and prepare*.
 *
 * Before anything starts it says what the engine's own rule says it needs
 * (`preparation.diskBytes`, from the picked node) and lets the person pick a
 * context from the engine's own choices, its recommendation first (B50).
 * The run it starts is an ordinary run operation: its line is in the tray
 * and under the button.
 */
export function PrepareControl({
  engine,
  entry,
  node,
  where,
  download = null,
  disabledReason = null,
  onStart,
}: {
  engine: string;
  /** The node's list entry for this model: what the engine says it makes and needs. */
  entry: SupportedModel | null;
  node: TargetNode | null;
  where: string;
  /** For *Download and prepare*: what is downloaded first. */
  download?: number | null;
  disabledReason?: string | null;
  /** Starts the run; its id. */
  onStart: (preparation: RunPreparation) => string;
}) {
  const runs = useRuns();
  void runs; // a store change re-renders this control; `runById` reads the same store
  const [context, setContext] = useState<number | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  // Why pressing it started nothing, in the browser's own words.
  const [startError, setStartError] = useState<string | null>(null);
  const task = runById(runId);
  const busy = task !== null && !isTerminal(task.step);
  const name = engineName(engine);
  const preparation = entry?.preparation ?? null;
  const contexts = preparation?.contexts ?? [];
  const start = () => {
    if (!node) return;
    setStartError(null);
    try {
      const id = onStart({ engine, contextSize: context });
      if (!id) {
        setStartError("Nothing was started: this page has not found the model's files yet.");
        return;
      }
      setRunId(id);
    } catch (err) {
      setStartError(`Nothing was started: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  // The node judges its own install (LS7, B30): said before a preparation
  // would fail halfway, with the fix.
  const tooOld = preparation?.engineTooOld
    ? `This needs ${name} ${preparation.minEngineVersion ?? "a newer version"} or newer, and ${where} has ${preparation.engineTooOld}: update ${name} on ${where} from Backends first.`
    : null;
  // A button that cannot be pressed says why (it once sat greyed out, silent,
  // while the page had no machine to run on).
  const blocked =
    disabledReason ??
    tooOld ??
    (node ? null : "Working out which machine this runs on: choose one in the picker above.");
  const disabled = !node || busy || blocked !== null;

  return (
    <section
      data-testid="prepare-model"
      className="rounded-[var(--radius)] border border-[color:var(--border)] px-4 py-3 text-sm"
    >
      <p className="font-ui font-semibold">
        {download != null ? `Download and prepare for ${name}` : `Prepare for ${name}`}
      </p>
      <p className="mt-1 leading-relaxed">
        {name} runs it after making {preparation?.note ?? "its own files"} from it, with its own
        setup, on {where}.{download != null && <> First it downloads {formatBytes(download)}.</>}
        {preparation?.diskBytes != null && (
          <>
            {" "}
            By {name}&rsquo;s own rule that needs about{" "}
            <span data-testid="prepare-disk">{formatBytes(preparation.diskBytes)}</span> more free
            on the drive holding the Library folder.
          </>
        )}{" "}
        The model file itself is not changed. Then it starts, like Run.
      </p>
      {contexts.length > 0 && (
        <label className="mt-2 flex flex-wrap items-center gap-2">
          <span>Context</span>
          <select
            data-testid="prepare-context"
            value={context ?? ""}
            onChange={(event) => setContext(event.target.value ? Number(event.target.value) : null)}
            className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-2 py-1"
          >
            <option value="">{`${name}'s recommendation for ${where}`}</option>
            {contexts.map((size) => (
              <option key={size} value={size}>
                {`${Math.round(size / 1024)}K tokens`}
              </option>
            ))}
          </select>
          <span className="text-[0.6875rem] text-[color:var(--muted)]">
            Fixed when it is prepared. Preparing it again with another context takes seconds; the
            rest is kept.
          </span>
        </label>
      )}
      <div className="mt-3">
        <button
          type="button"
          onClick={start}
          disabled={disabled}
          title={blocked ?? undefined}
          data-testid="prepare-start"
          className="action-button action-button--primary font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1.5 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy
            ? "Preparing…"
            : download != null
              ? `Download and prepare for ${name}`
              : `Prepare for ${name}`}
        </button>
        {disabledReason && (
          <p className="mt-1 text-[0.6875rem] text-[color:var(--muted)]">{disabledReason}</p>
        )}
        {!node && !disabledReason && !tooOld && (
          <p
            data-testid="prepare-no-node"
            className="mt-1 text-[0.6875rem] text-[color:var(--muted)]"
          >
            {blocked}
          </p>
        )}
        {startError && (
          <p
            data-testid="prepare-start-error"
            role="alert"
            className="status-error mt-1 px-1 text-xs"
          >
            {startError}
          </p>
        )}
        {tooOld && (
          <p data-testid="prepare-engine-too-old" className="status-warn mt-1 px-1 text-xs">
            {tooOld}
          </p>
        )}
      </div>
      {task && <RunStatus task={task} onRetry={start} />}
      {task && (task.preparation?.warnings ?? []).length > 0 && (
        <ul data-testid="prepare-warnings" className="mt-2 text-xs text-[color:var(--muted)]">
          {(task.preparation?.warnings ?? []).map((warning) => (
            <li key={warning}>
              {name}&rsquo;s setup warned: {warning}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The node's list entry for a file: its first shard's name, case ignored,
 * as the engine's own setup and the Library's judge compare it (B32). */
export function entryForFile(
  models: SupportedModel[] | null | undefined,
  path: string,
): SupportedModel | null {
  const wanted = path.split(/[\\/]/).pop()?.toLowerCase();
  if (!wanted) return null;
  return (
    (models ?? []).find((m) => (m.source.file ?? "").split("/").pop()?.toLowerCase() === wanted) ??
    null
  );
}
