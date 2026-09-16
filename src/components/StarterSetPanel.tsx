"use client";

import { useEffect, useState } from "react";

import { FitBadge, formatBytes } from "@/components/FitBadge";
import { ApiError, api } from "@/lib/api";
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
  onDownload,
  onOpenRepo,
}: {
  budget: NodeBudget | null;
  contextLength: number;
  /** The repo currently downloading, if any, so its button says so. */
  busy: string | null;
  onDownload: (model: StarterModel) => void;
  onOpenRepo: (repo: string) => void;
}) {
  const [set, setSet] = useState<StarterSet | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const params = new URLSearchParams({
          contextLength: String(contextLength),
          ...fitQuery(budget),
        });
        setSet(await api.get<StarterSet>("library", `/v1/catalogue/starter?${params}`));
        setError(null);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return;
        // Not a page-level error: the search box beside this still
        // works, and it is the thing to fall back to.
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [budget, contextLength]);

  if (error) {
    return (
      <p className="text-xs text-[color:var(--muted)]">
        The suggested models could not be loaded ({error}). Search above for one by name.
      </p>
    );
  }
  if (!set) return <p className="text-xs text-[color:var(--muted)]">loading suggestions…</p>;

  const models = orderedModels(set);
  if (models.length === 0) {
    return (
      <p className="text-xs text-[color:var(--muted)]">
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
          <p className="mt-1 text-xs">{set.recommended?.reason}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onDownload(pick)}
              disabled={busy !== null || !!pick.alreadyOwned}
              className={primary}
              data-testid="starter-download"
            >
              {pick.alreadyOwned
                ? "Already on disk"
                : busy === pick.repo
                  ? "starting…"
                  : `Download ${downloadSize(pick.sizeBytes)}`}
            </button>
            <button type="button" onClick={() => onOpenRepo(pick.repo)} className={secondary}>
              Choose another version
            </button>
          </div>
        </section>
      ) : (
        <section className="status-warn rounded-[var(--radius)] border px-4 py-3 text-xs">
          <p className="font-ui font-semibold">Nothing here fits this machine</p>
          <p className="mt-1">{set.recommended?.reason}</p>
        </section>
      )}

      <div>
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-ui text-xs font-semibold">All suggestions</h3>
          <p className="text-[11px] text-[color:var(--muted)]">
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
                  <p className="font-ui truncate text-xs font-semibold">
                    {shortName(model.baseModel)}
                    <span className="ml-2 font-normal text-[color:var(--muted)]">
                      {model.label} · {formatBytes(model.sizeBytes)}
                    </span>
                  </p>
                  <p className="truncate text-[11px] text-[color:var(--muted)]">
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
                    disabled={busy !== null || !!model.alreadyOwned}
                    className={smallButton}
                  >
                    {model.alreadyOwned ? "on disk" : "download"}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {isStale(set) && (
        <p className="status-warn rounded-[var(--radius)] border px-3 py-2 text-xs">
          This list was last reviewed {set.reviewedDaysAgo} days ago. New models come out every
          month, so search above for anything newer.
        </p>
      )}
      {(set.notes ?? []).map((note) => (
        <p key={note} className="text-[11px] text-[color:var(--muted)]">
          {note}
        </p>
      ))}
    </div>
  );
}

const primary =
  "font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1.5 text-xs font-medium text-[color:var(--on-accent-left)] transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40";
const secondary =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]";
const smallButton =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-0.5 text-[11px] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";
