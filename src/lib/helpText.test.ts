/**
 * What a setting's help shows by default, and what waits behind "More".
 *
 * **The rule has to hold for two kinds of text.** The descriptions written
 * before it existed are one paragraph of several sentences; the ones
 * written for it are one short sentence, a blank line, then the details.
 * The real ones are in `settings-wire.json`, captured from each component,
 * and the invariants below run over every one of them.
 */

import { describe, expect, it } from "vitest";

import wire from "./__fixtures__/settings-wire.json";
import { SHORT_PARAGRAPH_WORDS, firstSentence, splitHelp, wordCount } from "./helpText";

describe("a short description", () => {
  it("is all summary, with nothing behind More", () => {
    expect(splitHelp("Where updates come from.")).toEqual({
      summary: "Where updates come from.",
      more: null,
    });
  });

  it("keeps a first paragraph of about two lines whole, even with two sentences", () => {
    const text = "Cap on one response. Blank sets no cap, so an answer runs until the model ends.";
    expect(wordCount(text)).toBeLessThanOrEqual(SHORT_PARAGRAPH_WORDS);
    expect(splitHelp(text)).toEqual({ summary: text, more: null });
  });

  it("is nothing at all when there is nothing", () => {
    expect(splitHelp("")).toEqual({ summary: "", more: null });
    expect(splitHelp("  \n\n  \n")).toEqual({ summary: "", more: null });
  });
});

describe("a description written for it: one sentence, a blank line, then details", () => {
  it("shows the sentence and keeps the details, paragraphs and all", () => {
    const parts = splitHelp(
      "How the control root keeps its key.\n\nThe keyring is host-bound.\n\nA file is not.",
    );
    expect(parts.summary).toBe("How the control root keeps its key.");
    expect(parts.more).toBe("The keyring is host-bound.\n\nA file is not.");
  });

  it("reads Windows line endings the same way", () => {
    expect(splitHelp("One sentence.\r\n\r\nThe details.")).toEqual({
      summary: "One sentence.",
      more: "The details.",
    });
  });
});

describe("a description written before it: one long paragraph", () => {
  const OLD =
    "Where updates come from. Releases is the newest published release. Edge is the newest " +
    "version that has passed every check, the same one the edge container image is built from. " +
    "Only a newer version is ever offered: a machine that already runs something newer is told so.";

  it("shows the first sentence and keeps the rest of the paragraph", () => {
    expect(wordCount(OLD)).toBeGreaterThan(SHORT_PARAGRAPH_WORDS);
    const parts = splitHelp(OLD);
    expect(parts.summary).toBe("Where updates come from.");
    expect(parts.more?.startsWith("Releases is the newest published release.")).toBe(true);
    expect(parts.more?.endsWith("is told so.")).toBe(true);
  });

  it("puts the later paragraphs after the rest of the first", () => {
    const parts = splitHelp(`${OLD}\n\nA second paragraph.`);
    expect(parts.summary).toBe("Where updates come from.");
    expect(parts.more?.endsWith("is told so.\n\nA second paragraph.")).toBe(true);
  });

  it("shows a long first paragraph that is one sentence, rather than cut it", () => {
    const one = `${"word ".repeat(40)}and then it stops.`;
    expect(splitHelp(one)).toEqual({ summary: one, more: null });
  });
});

describe("where a sentence does not end", () => {
  it("not inside a code span", () => {
    const first =
      "Records every request in `metrics.sqlite3. Really` and then goes on for a good while " +
      "so that the paragraph is long enough to be cut somewhere sensible.";
    const text = `${first} Never sent anywhere, and never part of the replicated install log.`;
    expect(wordCount(text)).toBeGreaterThan(SHORT_PARAGRAPH_WORDS);
    expect(splitHelp(text).summary).toBe(first);
  });

  it("not after an abbreviation", () => {
    const text =
      "Pick a model from a provider, e.g. Ollama or LM Studio, that you already run on this " +
      "machine or another one. The address is saved with it and checked when you press Test.";
    expect(splitHelp(text).summary).toBe(
      "Pick a model from a provider, e.g. Ollama or LM Studio, that you already run on this " +
        "machine or another one.",
    );
  });

  it("not in a number or a file name", () => {
    const first =
      "A GPU holds the model at 0.92 of its memory in config.yaml unless the card is shared " +
      "with other work that needs room.";
    const text = `${first} Lower it then, and restart the model so that the new share applies.`;
    expect(wordCount(text)).toBeGreaterThan(SHORT_PARAGRAPH_WORDS);
    expect(splitHelp(text).summary).toBe(first);
  });

  it("not where a bold or italic span would be left open", () => {
    const text =
      "**This executes code. Enable it only for a model you trust**, because it runs with the " +
      "engine's own privileges and can read what the engine can read, which is a good deal. " +
      "Off by default.";
    expect(wordCount(text)).toBeGreaterThan(SHORT_PARAGRAPH_WORDS);
    const parts = splitHelp(text);
    expect(parts.summary).toBe(
      "**This executes code. Enable it only for a model you trust**, because it runs with the " +
        "engine's own privileges and can read what the engine can read, which is a good deal.",
    );
    expect(parts.summary.match(/\*\*/g)).toHaveLength(2);
    expect(parts.more).toBe("Off by default.");
  });

  it("not in a list, which is not a run of sentences", () => {
    const text =
      `Choose one of these two options. ${"word ".repeat(30)}\n` +
      "- first choice. Then more text.\n- second choice.";
    expect(wordCount(text)).toBeGreaterThan(SHORT_PARAGRAPH_WORDS);
    expect(splitHelp(text)).toEqual({ summary: text, more: null });
  });
});

describe("firstSentence", () => {
  it("gives the sentence and the remainder, trimmed", () => {
    expect(firstSentence("One. Two. Three.")).toEqual({
      sentence: "One.",
      remainder: "Two. Three.",
    });
  });

  it("takes the closing quote or bracket with the full stop", () => {
    expect(firstSentence('He said "stop." Then it did.')).toEqual({
      sentence: 'He said "stop."',
      remainder: "Then it did.",
    });
    expect(firstSentence("It is off (the default.) Turn it on.")).toEqual({
      sentence: "It is off (the default.)",
      remainder: "Turn it on.",
    });
  });

  it("is null when the paragraph is one sentence", () => {
    expect(firstSentence("Just the one.")).toBeNull();
  });

  it("a numbered line's marker is not a sentence", () => {
    expect(firstSentence("1. First do this. Then that.")).toEqual({
      sentence: "1. First do this.",
      remainder: "Then that.",
    });
  });
});

type Case = { field: { description?: string } };
const cases = wire as unknown as Record<string, Record<string, Case>>;
const descriptions = Object.entries(cases).flatMap(([component, byName]) =>
  Object.entries(byName).flatMap(([name, found]) =>
    found.field?.description ? [{ id: `${component}/${name}`, text: found.field.description }] : [],
  ),
);

describe("every description a component really serves", () => {
  it("reads a non-trivial number of them, or it proves nothing", () => {
    expect(descriptions.length).toBeGreaterThanOrEqual(15);
  });

  for (const { id, text } of descriptions) {
    it(`${id} loses no word and shows a short summary`, () => {
      const { summary, more } = splitHelp(text);
      expect(summary).not.toBe("");
      // Nothing is dropped: the two halves are the text, in order.
      const joined = [summary, more ?? ""].join(" ").split(/\s+/).filter(Boolean);
      expect(joined).toEqual(text.split(/\s+/).filter(Boolean));
      // About two lines. One captured sentence runs to 50 words and has no
      // honest place to cut it; that is shown whole, and the bound says so.
      expect(wordCount(summary)).toBeLessThanOrEqual(55);
      // Neither half leaves a bold or a code span open.
      for (const half of [summary, more ?? ""]) {
        const bare = half.replace(/`[^`]*`/g, "");
        expect((bare.match(/\*/g)?.length ?? 0) % 2).toBe(0);
        expect((half.match(/`/g)?.length ?? 0) % 2).toBe(0);
      }
    });
  }

  it("most of them are two lines or fewer by default", () => {
    const short = descriptions.filter(({ text }) => wordCount(splitHelp(text).summary) <= 30);
    expect(short.length / descriptions.length).toBeGreaterThanOrEqual(0.8);
  });

  it("the control root's security mode, once 254 words and now 107, leads with one sentence", () => {
    const text = cases.control!.securityMode!.field.description as string;
    expect(wordCount(text)).toBeLessThan(130);
    const { summary, more } = splitHelp(text);
    expect(summary).toBe("How this control root keeps its master encryption key between restarts.");
    expect(wordCount(summary)).toBeLessThanOrEqual(20);
    // The details are the list of the three modes, then a closing paragraph.
    expect(more?.startsWith("- **Prompt on startup**:")).toBe(true);
    expect(more).toContain("\n- **OS keyring**:");
    expect(more).toContain("\n- **Passphrase file**:");
    expect(more).toContain("\n\nEither auto-unlock mode");
  });
});
