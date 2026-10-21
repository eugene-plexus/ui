"use client";

import { useEffect, useState } from "react";

import { ConfirmButton } from "@/components/ConfirmButton";
import { api, describeError } from "@/lib/api";
import type {
  LibraryModel,
  ModelRelocated,
  RelocateCandidate,
  RelocateCandidateList,
} from "@/lib/types";

/**
 * What a missing model says about where its file went (row 22), and the click
 * that moves its profiles there.
 *
 * The Library recognises a moved file by its contents (a fingerprint), not its
 * name or size. Nothing moves until a click: an unplugged drive makes its
 * models missing, and profiles that moved to a copy by themselves would leave
 * the original coming back without them.
 *
 * - A file with the same contents: "Move 2 profiles there".
 * - A model that went missing before fingerprints existed, with a file that
 *   matches only in size and details: "Move anyway", asked first, because
 *   Eugene cannot prove it is the same file.
 * - Several files with the same contents: all are listed, and the person picks.
 */

const buttonClass =
  "action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-sm text-[color:var(--foreground)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";

/** "1 profile", "2 profiles". */
export function profilesPhrase(count: number): string {
  return `${count} profile${count === 1 ? "" : "s"}`;
}

/** The sentence that leads, from what the Library found. */
export function movedLead(oldPath: string, candidates: RelocateCandidate[]): string {
  if (candidates.length === 0) {
    return "Missing. No file with the same contents is in your Library folders.";
  }
  const likely = candidates.every((c) => c.match === "likely");
  if (candidates.length === 1) {
    const found = candidates[0]!.model.path;
    return likely
      ? `Missing. A file with the same size and details is at ${found}. Eugene cannot prove it is the same file.`
      : `Missing from ${oldPath}. Found at ${found}.`;
  }
  return likely
    ? "Missing. Files with the same size and details are in these places. Eugene cannot prove any of them is the same file."
    : `Missing from ${oldPath}. The same file is in ${candidates.length} places. Choose where it went.`;
}

export function MovedModel({
  model,
  onMoved,
}: {
  model: LibraryModel;
  onMoved: (done: ModelRelocated) => void;
}) {
  const [candidates, setCandidates] = useState<RelocateCandidate[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCandidates(null);
    setReadError(null);
    void (async () => {
      try {
        const answer = await api.get<RelocateCandidateList>(
          "library",
          `/v1/models/${encodeURIComponent(model.id)}/relocate-candidates`,
        );
        if (!cancelled) setCandidates(answer.candidates ?? []);
      } catch (err) {
        if (!cancelled) setReadError(describeError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [model.id, model.movedTo]);

  async function move(candidate: RelocateCandidate) {
    setBusy(true);
    setMoveError(null);
    try {
      const done = await api.post<ModelRelocated>(
        "library",
        `/v1/models/${encodeURIComponent(model.id)}/relocate`,
        {
          to: candidate.model.id,
          ...(candidate.match === "likely" ? { confirmLikely: true } : {}),
        },
      );
      onMoved(done);
    } catch (err) {
      // The Library's own sentence: what differs, or that the file is gone.
      setMoveError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  const count = model.profileCount ?? 0;

  if (readError) {
    return (
      <p data-testid="moved-lead" role="alert">
        Missing. Eugene could not check where it went: {readError}
      </p>
    );
  }
  if (candidates === null) {
    return (
      <p data-testid="moved-reading" role="status">
        Missing. Looking for the file…
      </p>
    );
  }

  const single = candidates.length === 1;
  return (
    <div data-testid="moved-model" className="flex flex-col gap-2">
      <p data-testid="moved-lead">{movedLead(model.path, candidates)}</p>
      <ul className="flex flex-col gap-2">
        {candidates.map((c) => (
          <li key={c.model.id} className="flex flex-col gap-1" data-testid="moved-candidate">
            {!single && <span className="font-mono text-xs break-all">{c.model.path}</span>}
            {c.match === "same" ? (
              <div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void move(c)}
                  aria-label={`Move ${profilesPhrase(count)} to ${c.model.path}`}
                  className={buttonClass}
                >
                  Move {profilesPhrase(count)} there
                </button>
              </div>
            ) : (
              <div>
                <ConfirmButton
                  label="Move anyway"
                  ariaLabel={`Move anyway to ${c.model.path}`}
                  cancelLabel="Cancel"
                  prompt={
                    <span className="[overflow-wrap:anywhere]">
                      Move {profilesPhrase(count)} to {c.model.path}? Their settings will apply to
                      that file.
                    </span>
                  }
                  onConfirm={() => move(c)}
                  disabled={busy}
                  className={buttonClass}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
      {moveError && (
        <p className="status-error rounded-[var(--radius)] border px-3 py-2 text-sm" role="alert">
          {moveError}
        </p>
      )}
    </div>
  );
}

/** What a move did, on the model that has the profiles now. */
export function MovedNotice({ done }: { done: ModelRelocated }) {
  return (
    <div
      data-testid="moved-notice"
      role="status"
      className="status-success flex flex-col gap-1 rounded-[var(--radius)] border px-3 py-2 text-sm"
    >
      <p>Profiles moved to {done.model.path}.</p>
      {done.renamed.length > 0 && (
        <p>
          {done.renamed.length === 1 ? "One profile has" : `${done.renamed.length} profiles have`} a
          new name, because this model already used it:{" "}
          {done.renamed.map((r) => `${r.name} is now ${r.renamedTo}`).join("; ")}.
        </p>
      )}
      {done.warnings.map((w) => (
        <p key={w} data-testid="moved-warning">
          {w}
        </p>
      ))}
    </div>
  );
}
