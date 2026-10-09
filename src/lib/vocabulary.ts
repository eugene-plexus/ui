/**
 * The words the golden-path screens do not use (S8, decision #12).
 *
 * **The list is not the hard part; knowing what a person actually reads
 * is.** A grep of these files answers the wrong question -- `async
 * function mint()`, a docblock about the trust root and a test fixture
 * are all source, and none of them is copy. Measured on 2026-09-16: a
 * plain source grep over the five golden-path screens reported **41
 * hits**, of which exactly **one** was text a person could see. A test
 * built on that grep would fail forty times for nothing and teach
 * everyone to silence it.
 *
 * **And a tooltip is not body copy.** Troy took decision #12 ON
 * CONDITION that "the proper jargon stays available in a tooltip or
 * other hint for advanced users", so `title` text is where these terms
 * are *supposed* to end up. A checker that flagged `title` would forbid
 * the remedy the decision prescribes, and a word-count cap on `title`
 * would push the explanation back out of the place the decision put it.
 * So `title` is excluded from both rules, deliberately, and that
 * exclusion is the design rather than a loophole.
 *
 * What this module does NOT see: text assembled at runtime, text from
 * the API, and anything the extractor's heuristics miss. The rendered
 * check in `scripts/hobbyist-acceptance.sh` covers real screens in a
 * real browser and is the other half; neither is sufficient alone.
 */

/** Implementation nouns that must not appear in visible copy. */
export const BANNED_TERMS = [
  "companion driver",
  "declaration",
  "admission",
  "mint",
  "epoch",
  "advertiseurl",
  "trust root",
  "topology",
  "routing table",
  "runtime",
] as const;

/** The plan's cap on a sentence of visible copy. */
export const MAX_WORDS = 25;

/**
 * Comments are not copy. Block comments first, then whole-line `//`,
 * then trailing `//` -- and never a `//` that is inside a string, which
 * is why the trailing form requires whitespace before it and is applied
 * to a line that has already had its block comments removed.
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\s\/\/\s.*$/gm, " ");
}

/**
 * Marks a string as expert hover text rather than body copy.
 *
 * It returns its argument unchanged; its whole job is to say so in a
 * way a checker can see. `title="..."` is self-evident in the source,
 * but a hint that reaches `title` through a variable is not, and the
 * alternative -- teaching the extractor that a property called `hint`
 * is exempt -- would let any variable of that name silence the rule by
 * accident. This has to be written deliberately, greps in one step, and
 * shows up in review as what it is.
 */
export function expertHint(text: string): string {
  return text;
}

export interface ExtractedCopy {
  /** Text a person can see without hovering. */
  visible: string[];
  /** `title` text: the expert hint, exempt from both rules by design. */
  tooltips: string[];
}

/**
 * Pull the copy out of a `.tsx` source.
 *
 * **Single-line only, on purpose.** An earlier attempt at this matched
 * template literals with `[^`]+`, which crosses newlines, so it
 * swallowed whole function bodies and reported 339-word "sentences" of
 * JSX. Copy in this codebase is written on one line; code is not. The
 * cost of the narrower rule is a missed multi-line sentence, which the
 * browser check catches; the cost of the wider one was a test nobody
 * could read.
 */
export function extractCopy(source: string): ExtractedCopy {
  const clean = stripComments(source);

  const tooltips: string[] = [];
  const titleAttr = /title=\{?"([^"\n]{2,})"/g;
  for (const m of clean.matchAll(titleAttr)) if (m[1]) tooltips.push(m[1]);

  // `,?` because the formatter puts a trailing comma on a wrapped call,
  // and a marker that only works on one line would be a marker people
  // silently lose to Prettier.
  const hintCall = /expertHint\(\s*"([^"\n]{2,})"\s*,?\s*\)/g;
  for (const m of clean.matchAll(hintCall)) if (m[1]) tooltips.push(m[1]);

  // Blank the tooltips so the visible pass cannot see them.
  const body = clean.replace(titleAttr, 'title=""').replace(hintCall, 'expertHint("")');

  const visible: string[] = [];
  // A double-quoted string on one line: labels, aria-labels, messages.
  for (const m of body.matchAll(/"([^"\\\n]{4,})"/g)) if (m[1]) visible.push(m[1]);
  // JSX text between tags, with no braces in it (so no expressions).
  for (const m of body.matchAll(/>([^<>{}\n]{6,})</g)) if (m[1]) visible.push(m[1]);
  // **A single-line template literal** (R1.5, review §6.3 #35). This was
  // the hole, and it was not the file list: `app/setup` has always been
  // in the golden path and `start.ts` has always been read, so the
  // wizard's worst sentence -- the one a first-time user meets when the
  // trust root will not start -- was scanned and matched nothing,
  // because it is written in backticks to interpolate the underlying
  // error. Copy that needs a value in it has no other quoting to use.
  //
  // `${...}` is blanked rather than excluded: a sentence built around an
  // interpolation is still a sentence, and dropping the whole literal
  // would put every message with a value in it back out of reach. What
  // is left has to still look like prose, which is what keeps
  // `` `${base}/v1/models` `` out.
  for (const m of body.matchAll(/`([^`\\\n]{4,})`/g)) {
    const text = m[1]?.replace(/\$\{[^}]*\}/g, " ").trim();
    if (text && looksLikeProse(text)) visible.push(text);
  }

  return { visible, tooltips };
}

/** Prose, as opposed to a class list, a URL or an identifier. */
export function looksLikeProse(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) return false;
  if (/^(https?:|\/|#|\.|@)/.test(t)) return false;
  // Tailwind class lists and style strings are the big false positive.
  if (/[:[\]]/.test(t) && !/\s[a-z]+\s/i.test(t.replace(/[:[\]][^\s]*/g, " "))) return false;
  if (
    /^[a-z-]+(\s+[a-z-]+)*$/.test(t) &&
    /-/.test(t) &&
    !/\s(the|a|an|is|to|of|and|on)\s/i.test(t)
  ) {
    return false;
  }
  return /\s/.test(t) && /[a-z]{3}/i.test(t);
}

export interface Offence {
  kind: "banned" | "long";
  term?: string;
  words?: number;
  text: string;
}

/** Every rule this module enforces, over one file's source. */
export function checkCopy(source: string): Offence[] {
  const { visible } = extractCopy(source);
  return checkVisibleCopy(visible);
}

export function checkVisibleCopy(visible: string[]): Offence[] {
  const out: Offence[] = [];
  for (const text of visible) {
    // API paths are source identifiers, never visible prose.
    if (/^(https?:|\/|@)/.test(text)) continue;
    const low = text.toLowerCase();
    for (const term of BANNED_TERMS) {
      const matches =
        term === "runtime"
          ? !/^(https?:|\/|@)/.test(text) && /\bruntimes?\b/i.test(text)
          : low.includes(term);
      if (matches) out.push({ kind: "banned", term, text });
    }
    if (looksLikeProse(text)) {
      for (const sentence of text.split(/[.!?](?:\s+|$)/)) {
        const words = sentence.trim().split(/\s+/).length;
        if (words > MAX_WORDS) out.push({ kind: "long", words, text: sentence.trim() });
      }
    }
  }
  return out;
}
