"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { api } from "@/lib/api";
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

export function ModelCard({ repo }: { repo: string }) {
  const [open, setOpen] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset when the repo changes, or an opened card would keep showing
  // the previous model's prose under a new heading.
  useEffect(() => {
    setMarkdown(null);
    setError(null);
  }, [repo]);

  useEffect(() => {
    if (!open || markdown !== null) return;
    void (async () => {
      try {
        const params = new URLSearchParams({ repo });
        const card = await api.get<CatalogueCard>(
          "library",
          `/v1/catalogue/model/card?${params.toString()}`,
        );
        setMarkdown(card.markdown ?? "");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [open, markdown, repo]);

  return (
    <div className="rounded-[var(--radius)] border border-[color:var(--border)] text-xs">
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
          {error && <p className="text-status-error">{error}</p>}
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
                <Card>{markdown}</Card>
              </div>
              <p className="mt-2 border-t border-[color:var(--border)] pt-2 text-[11px] text-[color:var(--muted)]">
                Written by whoever published the model, shown unedited.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Card({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="mb-2 ml-5 list-disc last:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 ml-5 list-decimal last:mb-0">{children}</ol>,
        li: ({ children }) => <li className="mb-0.5">{children}</li>,
        h1: ({ children }) => (
          <h1 className="font-ui mt-3 mb-1.5 text-sm font-semibold first:mt-0">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="font-ui mt-3 mb-1.5 text-sm font-semibold first:mt-0">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="font-ui mt-2 mb-1 text-xs font-semibold first:mt-0">{children}</h3>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-[color:var(--muted)]"
          >
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="font-mono-ui rounded-[var(--radius)] bg-[color:var(--panel-soft)] px-1 py-0.5">
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre className="font-mono-ui mb-2 overflow-x-auto rounded-[var(--radius)] bg-[color:var(--panel-soft)] p-2">
            {children}
          </pre>
        ),
        table: ({ children }) => (
          <div className="mb-2 overflow-x-auto">
            <table className="w-full">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="font-ui border-b border-[color:var(--border)] px-2 py-1 text-left font-medium">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border-b border-[color:var(--border)] px-2 py-1">{children}</td>
        ),
        img: () => null,
        blockquote: ({ children }) => (
          <blockquote className="mb-2 border-l-2 border-[color:var(--border)] pl-2 text-[color:var(--muted)]">
            {children}
          </blockquote>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
