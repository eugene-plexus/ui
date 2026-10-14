/**
 * Help text, split into what is always shown and what waits for a click.
 *
 * A component describes each setting in its own words, and some of those
 * words run to 250. Troy (2026-10-13): "when a setting description exceeds
 * two lines, you generally want to hide it in an accordion... having it is
 * fantastic but it doesn't need to be on full display 24/7".
 *
 * The rule is about the shape of the text, never about which setting it
 * belongs to, so it holds for the descriptions written before it existed
 * and for the ones written for it:
 *
 * - **A short first paragraph is the summary.** The components now write
 *   one short sentence, a blank line, then the details.
 * - **A long first paragraph gives its first sentence.** An older
 *   description is often one paragraph of several sentences.
 * - **Everything after the summary is "more".**
 *
 * The text is Markdown. It is split before it is drawn, so the summary and
 * the rest are each Markdown of their own: the split never lands inside a
 * code span, and it does not leave a `**` open on one side.
 */

/** A paragraph this short is shown whole: about two lines of help. */
export const SHORT_PARAGRAPH_WORDS = 30;

export interface HelpParts {
  /** Always shown. Empty only when the text is. */
  summary: string;
  /** Behind "More"; null when there is nothing beyond the summary. */
  more: string | null;
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function splitHelp(text: string): HelpParts {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const [first, ...others] = paragraphs;
  if (first === undefined) return { summary: "", more: null };

  let summary = first;
  const rest = [...others];
  // A list or a code block is not a run of sentences, so it is not cut.
  if (wordCount(first) > SHORT_PARAGRAPH_WORDS && !isBlock(first)) {
    const cut = firstSentence(first);
    if (cut) {
      summary = cut.sentence;
      rest.unshift(cut.remainder);
    }
  }
  return { summary, more: rest.length > 0 ? rest.join("\n\n") : null };
}

/** A paragraph that is a list, a quotation, a heading or a fence. */
function isBlock(paragraph: string): boolean {
  return /(^|\n)\s*([-*+>#]\s|\d+[.)]\s|```|~~~)/.test(paragraph);
}

/**
 * Words that end in a full stop without ending the sentence. A sentence
 * that begins with a capital after one of these is still the same one:
 * "for example Foo.Bar", "see e.g. Ollama".
 */
const ABBREVIATIONS = new Set([
  "e.g",
  "eg",
  "i.e",
  "ie",
  "etc",
  "vs",
  "cf",
  "approx",
  "ca",
  "no",
  "nos",
  "fig",
  "inc",
  "ltd",
  "dr",
  "mr",
  "mrs",
  "ms",
  "st",
]);

/** What may close a sentence after its full stop: `(see below.)`, `"done."` */
const CLOSERS = /[)\]"'’”*_]/;

/** What a new sentence may open with: a capital, a digit, a quote, a code span. */
const OPENERS = /[A-Z0-9"'‘“(\[`*_<]/;

/**
 * The first sentence of a paragraph, and the rest.
 *
 * A boundary is `.`, `!` or `?`, any closing brackets or quotes, white
 * space, then something a sentence can start with. It is not one inside a
 * code span (`metrics.sqlite3`), after an abbreviation, or where cutting
 * would leave `**` or `*` open. Where no boundary qualifies the paragraph
 * is returned whole by the caller, which is the safe failure: a summary
 * that is too long, never one that stops in the middle of a thought.
 */
export function firstSentence(paragraph: string): { sentence: string; remainder: string } | null {
  let inCode = false;
  for (let i = 0; i < paragraph.length; i++) {
    const ch = paragraph[i];
    if (ch === "`") {
      inCode = !inCode;
      continue;
    }
    if (inCode || (ch !== "." && ch !== "!" && ch !== "?")) continue;

    let end = i + 1;
    while (end < paragraph.length && CLOSERS.test(paragraph[end]!)) end++;
    if (end >= paragraph.length || !/\s/.test(paragraph[end]!)) continue;
    let next = end;
    while (next < paragraph.length && /\s/.test(paragraph[next]!)) next++;
    if (next >= paragraph.length) return null; // the paragraph ends here
    if (!OPENERS.test(paragraph[next]!)) continue;

    const sentence = paragraph.slice(0, end).trim();
    if (ch === "." && isAbbreviation(sentence)) continue;
    // "1." at the start of a numbered line is a marker, not a sentence.
    if (/^\d+[.)]$/.test(sentence)) continue;
    if (!balanced(sentence)) continue;
    return { sentence, remainder: paragraph.slice(next).trim() };
  }
  return null;
}

/** Whether the text so far ends on a word that takes a full stop. */
function isAbbreviation(sentence: string): boolean {
  const word = /(\S+)$/.exec(sentence.replace(/[)\]"'’”*_]+$/, ""))?.[1] ?? "";
  return ABBREVIATIONS.has(word.replace(/\.$/, "").toLowerCase());
}

/** Whether every `**`, `*` and backtick opened in the text is closed in it. */
function balanced(text: string): boolean {
  if ((text.match(/`/g)?.length ?? 0) % 2 !== 0) return false;
  const outside = text.replace(/`[^`]*`/g, "");
  // `**` opens and closes on its own: counting stars alone read an open
  // `**` as two stars, which is even.
  const bold = outside.match(/\*\*/g)?.length ?? 0;
  if (bold % 2 !== 0) return false;
  const single = outside.replace(/\*\*/g, "").match(/\*/g)?.length ?? 0;
  return single % 2 === 0;
}
