"use client";

import Link from "next/link";

import {
  SUGGESTED_SEARCH_MODELS,
  discoverHref,
  kindWords,
  searchModelsIn,
  type SuggestedSearchModel,
} from "@/lib/searchModels";
import type { LibraryModel } from "@/lib/types";

/**
 * "Search models": the three files the console suggests, and where to get them.
 *
 * An app that searches a person's own documents (Open WebUI today, Workbench
 * next) needs a model that turns text into numbers, and sometimes a second one
 * that puts the best matches first. Eugene starts either one correctly by
 * itself (the agent reads the file's header), but a person has to have one, and
 * a hub search for "embedding" is a list of four hundred models, most of which
 * are the wrong size or the wrong copy.
 *
 * On the Library it links to Discover with the repo open (`?repo=`). On Discover
 * it opens the repo in place, as the starter set does: the page reads `?repo=`
 * only when it loads, so a link to itself would do nothing.
 */
export function SearchModelsShelf({
  models = null,
  onOpenRepo,
}: {
  /** What the Library holds, so the shelf can say a search model is already here. */
  models?: readonly LibraryModel[] | null;
  /** Discover opens the repo in place; the Library leaves this out and links. */
  onOpenRepo?: (repo: string) => void;
}) {
  const held = searchModelsIn(models);
  return (
    <section data-testid="search-models-shelf" className="max-w-4xl space-y-2">
      <div>
        <h3 className="font-ui text-sm font-semibold">Search models</h3>
        <p className="text-sm text-[color:var(--muted)]">
          Apps that search your documents or memory need a search model. Eugene starts one for you
          and leaves it running.
        </p>
      </div>
      {held.length > 0 && (
        <p
          data-testid="search-models-held"
          className="status-success rounded-[var(--radius)] border px-3 py-1.5 text-sm"
        >
          Already here: {held.map((m) => `${m.name} (${kindWords(m.kind)})`).join(", ")}.
        </p>
      )}
      <ul className="space-y-2">
        {SUGGESTED_SEARCH_MODELS.map((row) => (
          <Row key={row.id} row={row} onOpenRepo={onOpenRepo} />
        ))}
      </ul>
    </section>
  );
}

function Row({
  row,
  onOpenRepo,
}: {
  row: SuggestedSearchModel;
  onOpenRepo?: (repo: string) => void;
}) {
  return (
    <li
      data-testid={`search-model-${row.id}`}
      className="rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-ui truncate text-sm font-semibold">
            {row.name}
            <span className="badge ml-2 rounded bg-[color:var(--border)] px-1 text-[0.5625rem] font-normal tracking-wider uppercase">
              {row.tag}
            </span>
          </p>
          <p className="text-[0.6875rem] text-[color:var(--muted)]">
            {kindWords(row.kind)} · {row.size}
          </p>
        </div>
        {onOpenRepo ? (
          <button
            type="button"
            onClick={() => onOpenRepo(row.repo)}
            className={buttonClass}
            data-testid={`search-model-open-${row.id}`}
          >
            See its files
          </button>
        ) : (
          <Link
            href={discoverHref(row)}
            className={buttonClass}
            data-testid={`search-model-open-${row.id}`}
          >
            Find it in Discover
          </Link>
        )}
      </div>
      <p className="mt-1 text-sm">{row.about}</p>
      <p className="mt-0.5 font-mono text-[0.625rem] break-all text-[color:var(--muted)]">
        {row.repo} · {row.file}
      </p>
    </li>
  );
}

const buttonClass =
  "action-button action-button--compact font-ui shrink-0 rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-0.5 text-[0.6875rem] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]";
