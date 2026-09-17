import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BANNED_TERMS, checkCopy, extractCopy, looksLikeProse, stripComments } from "./vocabulary";

/**
 * S8's banned-word test.
 *
 * **The extractor is the subject of half of these cases, not scaffolding.**
 * The failure mode for a test like this is not a false alarm, it is a
 * vacuous pass: an extractor that returns nothing makes every screen
 * clean forever, and the suite goes green while the rule stops being
 * enforced. So the fixtures below assert that the extractor FINDS
 * known-bad copy before the screens are asserted to be free of it.
 */

const SRC = join(__dirname, "..");

/** The screens on the path from install to a first reply. */
const GOLDEN_PATH: Record<string, string[]> = {
  home: ["app/page.tsx", "components/home"],
  wizard: ["app/setup"],
  discover: ["app/discover"],
  library: ["app/library"],
  playground: ["app/playground"],
};

function sourcesUnder(spec: string): string[] {
  const path = join(SRC, spec);
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) return [];
  if (!stat.isDirectory()) return [path];
  const out: string[] = [];
  for (const entry of readdirSync(path)) {
    const child = join(path, entry);
    if (statSync(child).isDirectory()) {
      out.push(...sourcesUnder(join(spec, entry)));
    } else if (/\.tsx?$/.test(entry) && !entry.includes(".test.")) {
      out.push(child);
    }
  }
  return out;
}

describe("the extractor, before anything is asserted with it", () => {
  it("finds a banned term in plain JSX text", () => {
    const { visible } = extractCopy("<p>This reads the routing table now.</p>");
    expect(visible.join(" ")).toContain("routing table");
  });

  it("finds a banned term in a quoted string", () => {
    const { visible } = extractCopy('setMessage("Setting up the trust root…");');
    expect(visible.some((s) => s.includes("trust root"))).toBe(true);
  });

  it("does not see comments, which are not copy", () => {
    // **The fixture must contain copy-SHAPED comments or it proves
    // nothing.** A first version used bare prose comments and passed
    // with comment-stripping removed entirely: the extractor only reads
    // quoted strings and JSX text, so a comment with neither was
    // invisible either way. Docblocks in this codebase quote things
    // constantly, which is the case that actually matters.
    const src = [
      '/** The wizard says "Setting up the trust root…" before it starts. */',
      "// It used to render <p>the routing table lives here</p> on Home.",
      'const ok = "Nothing is on disk yet.";',
    ].join("\n");
    expect(stripComments(src)).not.toContain("trust root");
    expect(checkCopy(src)).toEqual([]);
  });

  it("does not see an identifier that merely contains a term", () => {
    expect(checkCopy("async function mint(event) { return 1; }")).toEqual([]);
  });

  it("treats title text as the expert hint, not as body copy", () => {
    // Decision #12's condition: this is where the jargon is SUPPOSED to
    // live, so flagging it would forbid the prescribed remedy.
    const src = '<span title="The trust root holds the signing key.">Security</span>';
    const { visible, tooltips } = extractCopy(src);
    expect(tooltips.join(" ")).toContain("trust root");
    expect(visible.join(" ")).not.toContain("trust root");
    expect(checkCopy(src)).toEqual([]);
  });

  it("counts a long sentence of real prose", () => {
    const long = `<p>${"word ".repeat(30)}and the model is here to stay.</p>`;
    expect(checkCopy(long).some((o) => o.kind === "long")).toBe(true);
  });

  it("does not count a class list as a sentence", () => {
    const classy =
      '<p className="mt-6 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-xs text-[color:var(--muted)] flex flex-wrap items-center gap-2 min-w-0 flex-1">x</p>';
    expect(checkCopy(classy).filter((o) => o.kind === "long")).toEqual([]);
  });

  it("does not cross a newline, which is what made an earlier version useless", () => {
    // A template-literal pattern that spans lines swallowed whole
    // function bodies and reported 339-word "sentences" of JSX.
    const code = 'const a = `\n  some code\n  more code\n`;\nconst b = "ok";';
    for (const s of extractCopy(code).visible) expect(s).not.toContain("\n");
  });

  it("rejects a prose classifier that accepts everything", () => {
    expect(looksLikeProse("px-3")).toBe(false);
    expect(looksLikeProse("https://example.com/a/b")).toBe(false);
    expect(looksLikeProse("Nothing is on disk yet.")).toBe(true);
  });
});

describe("the golden path does not use implementation nouns", () => {
  it("reads a non-trivial amount of copy, or it is proving nothing", () => {
    // The vacuous-pass guard: if the screens ever stop yielding copy,
    // every assertion below becomes true for the wrong reason.
    let visible = 0;
    for (const specs of Object.values(GOLDEN_PATH)) {
      for (const spec of specs) {
        for (const file of sourcesUnder(spec)) {
          visible += extractCopy(readFileSync(file, "utf8")).visible.length;
        }
      }
    }
    expect(visible).toBeGreaterThan(200);
  });

  for (const [screen, specs] of Object.entries(GOLDEN_PATH)) {
    it(`${screen} uses none of them`, () => {
      const found: string[] = [];
      for (const spec of specs) {
        for (const file of sourcesUnder(spec)) {
          for (const o of checkCopy(readFileSync(file, "utf8"))) {
            if (o.kind === "banned") found.push(`${file}: ${o.term} in ${JSON.stringify(o.text)}`);
          }
        }
      }
      expect(found).toEqual([]);
    });

    it(`${screen} keeps its sentences under ${26} words`, () => {
      const found: string[] = [];
      for (const spec of specs) {
        for (const file of sourcesUnder(spec)) {
          for (const o of checkCopy(readFileSync(file, "utf8"))) {
            if (o.kind === "long") found.push(`${file}: ${o.words}w ${JSON.stringify(o.text)}`);
          }
        }
      }
      expect(found).toEqual([]);
    });
  }

  it("has a term list the acceptance run can share", () => {
    expect(BANNED_TERMS).toContain("trust root");
    expect(BANNED_TERMS.every((t) => t === t.toLowerCase())).toBe(true);
  });
});
