"use client";

import {
  MODE_CHOICES,
  SORTER_HINT,
  runsAs,
  runsAsLine,
  startsWithLine,
  type ModeChoice,
} from "@/lib/searchModels";
import type { ModelCapabilities } from "@/lib/types";

/**
 * What starting this file will make of it, and the person's say over that.
 *
 * "Runs as: search model (found in the file)": the Library read the file's own
 * header, and the agent reads the same keys when it starts the model, so the line
 * is a prediction of what will happen and not a setting. Choosing something
 * other than Auto is the override: **Chat** for a file whose header says search
 * and is wrong, **Search** or **Sort results** for one whose header says
 * nothing, or says the wrong one of the two.
 *
 * With no `onChange` it only says it (the line under Run); with one it is also
 * the control (the profile form).
 */
export function RunsAs({
  capabilities,
  mode,
  onChange,
  disabled = false,
}: {
  capabilities: ModelCapabilities | null | undefined;
  mode: ModeChoice | null | undefined;
  onChange?: (mode: ModeChoice) => void;
  disabled?: boolean;
}) {
  const answer = runsAs(capabilities, mode);
  const starts = startsWithLine(answer.kind);
  return (
    <div data-testid="runs-as" data-kind={answer.kind} data-source={answer.source}>
      <p data-testid="runs-as-line" className="text-sm">
        {runsAsLine(capabilities, mode)}
      </p>
      {onChange && (
        <label className="mt-1 flex items-center gap-2 text-sm">
          <span className="text-[color:var(--muted)]">Change it</span>
          <select
            aria-label="Runs as"
            value={mode ?? "auto"}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value as ModeChoice)}
            className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 text-sm transition-colors outline-none hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)]"
          >
            {MODE_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {starts && (
        <p data-testid="runs-as-starts" className="mt-1 text-[0.8125rem] text-[color:var(--muted)]">
          {starts}
        </p>
      )}
      {answer.kind === "search" && answer.source === "file" && (
        <p
          data-testid="runs-as-sorter-hint"
          className="mt-1 text-[0.8125rem] text-[color:var(--muted)]"
        >
          {SORTER_HINT}
        </p>
      )}
    </div>
  );
}
