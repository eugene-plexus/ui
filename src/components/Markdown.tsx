"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown from somewhere else, drawn safely.
 *
 * A model card is written by whoever uploaded the model, and a setting's
 * description by whichever component serves it, so neither is trusted as
 * HTML. `react-markdown` builds React elements from the Markdown and never
 * sets inner HTML; an HTML tag in the source is drawn as the text it is.
 * `rehype-raw` is deliberately not added. Links open in a new tab with
 * `noreferrer`, and images are not fetched.
 *
 * `gfm` adds tables, strikethrough and bare-address links. A model card
 * wants them. A setting's help does not: `~/models` would strike through
 * the text between two tildes, and an example address like
 * `http://192.168.1.5:8083` is not a link anyone should click.
 */
export const Markdown = memo(function Markdown({
  children,
  gfm = true,
}: {
  children: string;
  gfm?: boolean;
}) {
  return (
    <ReactMarkdown remarkPlugins={gfm ? GFM : NONE} components={COMPONENTS}>
      {children}
    </ReactMarkdown>
  );
});

/** Declared once: a new array each render would defeat the memo above. */
const GFM = [remarkGfm];
const NONE: (typeof GFM)[number][] = [];

/** Declared once, so every render hands `react-markdown` the same mapping. */
const COMPONENTS: Components = {
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
    <h3 className="font-ui mt-2 mb-1 text-sm font-semibold first:mt-0">{children}</h3>
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
};
