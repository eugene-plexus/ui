"use client";

import { useEffect, useState } from "react";

import { Markdown } from "@/components/Markdown";
import { api, describeError } from "@/lib/api";
import type { CatalogueCard } from "@/lib/types";

/**
 * The model card — the "with summaries" half of the original complaint.
 *
 * *"Let me just go to the dumpster fire UI that is HuggingFace… no search
 * page with summaries, just an autocomplete list."* This is the part
 * that answers it: what the model actually is, in its author's own
 * words, on the same screen as the decision.
 *
 * Fetched only when opened, because it is a separate upstream request
 * and a collapsed panel should not pay for one.
 *
 * **Untrusted content.** It is written by whoever uploaded the model, so
 * it is rendered as Markdown with no raw HTML — `react-markdown` does
 * not allow HTML unless `rehype-raw` is added, and it is deliberately
 * not — and links open in a new tab with `noreferrer`.
 */

export function ModelCard({ repo, source }: { repo: string; source?: string | null }) {
  const [open, setOpen] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by Try again. The only retry used to be closing and reopening
  // the panel -- and when that worked, the red error stayed above the card.
  const [attempt, setAttempt] = useState(0);

  // Reset when the repo changes, or an opened card would keep showing
  // the previous model's prose under a new heading.
  useEffect(() => {
    setMarkdown(null);
    setError(null);
  }, [repo, source]);

  useEffect(() => {
    if (!open || markdown !== null) return;
    void (async () => {
      setError(null);
      try {
        // The hub it is on (LS4); none named is the Library's default hub.
        const params = new URLSearchParams({ repo, ...(source ? { source } : {}) });
        const card = await api.get<CatalogueCard>(
          "library",
          `/v1/catalogue/model/card?${params.toString()}`,
        );
        setMarkdown(card.markdown ?? "");
      } catch (err) {
        // The library's own sentence, not "HTTP 502 Bad Gateway".
        setError(describeError(err));
      }
    })();
  }, [open, markdown, repo, source, attempt]);

  return (
    <div className="rounded-[var(--radius)] border border-[color:var(--border)] text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="font-ui flex w-full items-center justify-between px-3 py-2"
        aria-expanded={open}
      >
        <span className="font-semibold">About this model</span>
        <span className="text-[color:var(--muted)]">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="border-t border-[color:var(--border)] px-3 py-3">
          {error && (
            <p role="alert" className="text-status-error">
              {error}
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className={RETRY}>
                Try again
              </button>
            </p>
          )}
          {markdown === null && !error && (
            <p className="text-[color:var(--muted)]">loading the model card…</p>
          )}
          {markdown === "" && (
            <p className="text-[color:var(--muted)]">
              This model has no description. That is the publisher&rsquo;s choice, not a failure
              here.
            </p>
          )}
          {markdown && (
            <>
              <div className="max-h-[50vh] overflow-y-auto pr-1">
                <Markdown>{markdown}</Markdown>
              </div>
              <p className="mt-2 border-t border-[color:var(--border)] pt-2 text-[0.6875rem] text-[color:var(--muted)]">
                Written by whoever published the model, shown unedited.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const RETRY =
  "font-ui ml-2 rounded-[var(--radius)] border border-current px-2 py-0.5 text-[0.6875rem] hover:bg-[color:var(--panel-hover)]";
