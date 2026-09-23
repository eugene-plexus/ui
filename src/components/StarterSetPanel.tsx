"use client";

import { useEffect, useState } from "react";

import { FitBadge, formatBytes } from "@/components/FitBadge";
import { ApiError, api, describeError } from "@/lib/api";
import { fitQuery, type NodeBudget } from "@/lib/nodeBudget";
import {
  downloadSize,
  isStale,
  orderedModels,
  recommendedModel,
  reviewedOn,
  shortName,
} from "@/lib/starter";
import type { StarterModel, StarterSet } from "@/lib/types";

/**
 * A handful of models, and the one this machine should take.
 *
 * Hobbyist UX §6.3. Discovery answers "which version of this model" once
 * you have a model; with nothing typed, the screen used to answer
 * "whatever the hub sorted to the top today", which for a person with no
 * candidate is four hundred thousand rows deep. This is the empty-query
 * view instead.
 *
 * **It renders when the hub is down**, because the endpoint behind it
 * makes no upstream call — every number was measured once by the review
 * that produced the list. Choosing a first model works offline; only
 * fetching it does not, and Download says so when it fails.
 *
 * **The date is on the card.** A recommendation in a field that moves
 * monthly fails by going quietly out of date rather than by erroring, so
 * "Reviewed 16 Sep 2026" is shown and a list past the release window
 * says so outright (P4).
 */
export function StarterSetPanel({
  budget,
  contextLength,
  busy,
  inFlight = new Set<string>(),
  error: downloadError = null,
  onDownload,
  onOpenRepo,
}: {
  budget: NodeBudget | null;
  contextLength: number;
  /** The repo currently downloading, if any, so its button says so. */
  busy: string | null;
  /** Files a transfer is writing now. A suggestion whose file is among
   * them is not offered again: the card used to forget, the moment the
   * request returned, that it had started one. */
  inFlight?: Set<string>;
  /** Why the last Download from this panel was refused. */
  error?: string | null;
  onDownload: (model: StarterModel) => void;
  onOpenRepo: (repo: string) => void;
}) {
  const [set, setSet] = useState<StarterSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Asked once with no budget and again when the node's arrives; the
    // first answer, scored against the library's own host, must not land
    // over the second.
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams({
          contextLength: String(contextLength),
          ...fitQuery(budget),
        });
        const answer = await api.get<StarterSet>("library", `/v1/catalogue/starter?${params}`);
        if (cancelled) return;
        setSet(answer);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) return;
        // Not a page-level error: the search box beside this still
        // works, and it is the thing to fall back to.
        setError(describeError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [budget, contextLength, attempt]);

  if (error) {
    return (
      <p className="text-sm text-[color:var(--muted)]">
        The suggested models could not be loaded ({error}). Search above for one by name.
        <button
          type="button"
          onClick={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
          className="font-ui ml-2 rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-0.5 text-[0.6875rem] hover:bg-[color:var(--panel-hover)]"
        >
          Try again
        </button>
      </p>
    );
  }
  if (!set) return <p className="text-sm text-[color:var(--muted)]">loading suggestions…</p>;

  const models = orderedModels(set);
  if (models.length === 0) {
    return (
      <p className="text-sm text-[color:var(--muted)]">
        There are no suggested models on this install. Search above for one by name — a family name
        or a publisher works better than a description.
      </p>
    );
  }

  const pick = recommendedModel(set);
  const reviewed = reviewedOn(set);

  return (
    <div data-testid="starter-set" className="max-w-4xl space-y-4">
      {pick ? (
        <section
          data-testid="starter-recommended"
          className="status-success rounded-[var(--radius)] border px-4 py-3"
        >
          <p className="font-ui text-sm font-semibold">
            Suggested for this machine: {shortName(pick.baseModel)}
          </p>
          <p className="mt-1 text-sm">{set.recommended?.reason}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onDownload(pick)}
              disabled={busy !== null || !!pick.alreadyOwned || inFlight.has(pick.file)}
              className={primary}
              data-testid="starter-download"
            >
              {pick.alreadyOwned
                ? "Already on disk"
                : busy === pick.repo
                  ? "starting…"
                  : inFlight.has(pick.file)
                    ? "Downloading…"
                    : `Download ${downloadSize(pick.sizeBytes)}`}
            </button>
            <button type="button" onClick={() => onOpenRepo(pick.repo)} className={secondary}>
              Choose another version
            </button>
          </div>
          {downloadError && (
            <p
              role="alert"
              data-testid="starter-error"
              className="status-error mt-2 rounded-[var(--radius)] border px-3 py-2 text-sm"
            >
              {downloadError}
            </p>
          )}
        </section>
      ) : (
        <section className="status-warn rounded-[var(--radius)] border px-4 py-3 text-sm">
          <p className="font-ui font-semibold">Nothing here fits this machine</p>
          <p className="mt-1">{set.recommended?.reason}</p>
        </section>
      )}

      <div>
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-ui text-sm font-semibold">All suggestions</h3>
          <p className="text-[0.6875rem] text-[color:var(--muted)]">
            {reviewed && <>Reviewed {reviewed}. </>}
            Ranked by how many people downloaded them in the last 30 days — the community&rsquo;s
            judgement, not ours.
          </p>
        </div>
        <ul className="space-y-2">
          {models.map((model) => (
            <li
              key={model.sizeClass}
              data-testid="starter-row"
              data-size-class={model.sizeClass}
              className="rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-ui truncate text-sm font-semibold">
                    {shortName(model.baseModel)}
                    <span className="ml-2 font-normal text-[color:var(--muted)]">
                      {model.label} · {formatBytes(model.sizeBytes)}
                    </span>
                  </p>
                  <p className="truncate text-[0.6875rem] text-[color:var(--muted)]">
                    {model.repo}
                    {model.license && <> · {model.license}</>}
                    {model.maxContextLength != null && (
                      <> · fits up to {model.maxContextLength.toLocaleString()} tokens here</>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {model.fit && <FitBadge fit={model.fit} compact withContext />}
                  <button
                    type="button"
                    onClick={() => onOpenRepo(model.repo)}
                    className={smallButton}
                  >
                    versions
                  </button>
                  <button
                    type="button"
                    onClick={() => onDownload(model)}
                    disabled={busy !== null || !!model.alreadyOwned || inFlight.has(model.file)}
                    className={smallButton}
                  >
                    {model.alreadyOwned
                      ? "on disk"
                      : inFlight.has(model.file)
                        ? "downloading"
                        : "download"}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {isStale(set) && (
        <p className="status-warn rounded-[var(--radius)] border px-3 py-2 text-sm">
          This list was last reviewed {set.reviewedDaysAgo} days ago. New models come out every
          month, so search above for anything newer.
        </p>
      )}
      {(set.notes ?? []).map((note) => (
        <p key={note} className="text-[0.6875rem] text-[color:var(--muted)]">
          {note}
        </p>
      ))}
    </div>
  );
}

const primary =
  "font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1.5 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40";
const secondary =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]";
const smallButton =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-0.5 text-[0.6875rem] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";
