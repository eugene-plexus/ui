"use client";

import { memo, useMemo, useState, type ReactNode } from "react";

import { Markdown } from "@/components/Markdown";
import { splitHelp } from "@/lib/helpText";

/**
 * Help that is short until someone asks.
 *
 * `text` is Markdown. What `splitHelp` calls the summary is always on the
 * page; the rest waits behind "More", closed until it is opened. The
 * disclosure is a native `<details>`, so the keyboard (Enter or Space on
 * "More"), a screen reader's expanded and collapsed state and the
 * browser's find-in-page all work without anything written here.
 *
 * `id` goes on the summary only: that is what an input is `described by`.
 * The rest is one control away for whoever wants it, and reading all of it
 * on every focus would be the wall of text again.
 *
 * Memoised: a settings page holds a hundred of these and re-renders on every
 * keystroke in any one field, and parsing Markdown is not free.
 */
export const Help = memo(function Help({
  text,
  id,
  label,
  className,
  testId,
}: {
  text: string;
  /** For `aria-describedby`; the summary carries it. */
  id?: string;
  /** What the help is about, said to a screen reader after "More". */
  label?: string;
  className?: string;
  testId?: string;
}) {
  const { summary, more } = useMemo(() => splitHelp(text), [text]);
  if (!summary) return null;
  return (
    <div className={className} data-testid={testId}>
      <div id={id}>
        <Markdown gfm={false}>{summary}</Markdown>
      </div>
      {more !== null && (
        <More label={label} className="mt-1">
          <Markdown gfm={false}>{more}</Markdown>
        </More>
      )}
    </div>
  );
});

/**
 * The rest of something already said in a line: closed, one click to open.
 * For help that is written as JSX (links, emphasis) rather than Markdown.
 */
export function More({
  children,
  label,
  summary,
  summaryClassName = "text-sm text-[color:var(--accent-left)]",
  className,
  testId,
}: {
  children: ReactNode;
  /** What it is more of, for a screen reader: "More about Security mode". */
  label?: string;
  /** A word of its own in place of More and Less, for what is not help:
   * "Details". It stays the same open or closed; the marker beside it says
   * which. */
  summary?: string;
  /** The toggle's size and colour, for a place where the usual would not fit:
   * a warning box, whose own colour it should keep. */
  summaryClassName?: string;
  className?: string;
  testId?: string;
}) {
  // The label follows the element, not the other way round: a `<details>`
  // opens by itself, and `toggle` reports it, so this cannot drift from
  // what the page shows (find-in-page opens it too).
  const [open, setOpen] = useState(false);
  return (
    <details
      className={className}
      data-testid={testId}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className={`font-ui w-fit cursor-pointer ${summaryClassName}`}>
        {summary ?? (open ? "Less" : "More")}
        {label ? <span className="sr-only"> about {label}</span> : null}
      </summary>
      <div className="mt-1">{children}</div>
    </details>
  );
}
