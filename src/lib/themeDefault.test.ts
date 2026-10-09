/**
 * The default theme is spelled in six places, and they must agree.
 *
 * **Two of the six fail silently**, which is why this file exists. The
 * `:root` blocks in `globals.css` carry a whole palette; leave one on
 * the theme that used to be the default and nothing errors, nothing
 * logs, and no test fails -- you get one frame of the wrong theme
 * before the pre-hydration script runs, which is the precise flash that
 * script was written to prevent. A comment has warned about this since
 * 2026-09-12 and **the comment itself drifted**: it said "four places"
 * while there were six, because nobody had counted since a second
 * `:root` block and a second `useTheme` constant appeared.
 *
 * So the warning is a gate now. It reads the three files as text rather
 * than importing them, because four of the six spots are not values a
 * module exports -- they are a CSS selector, a string inside a template
 * literal, and a JSX attribute.
 *
 * It also asserts the ORDER rule, which is the other half of promoting
 * a theme: `:root` and `[data-theme="x"]` have equal specificity, so a
 * `:root` block placed after the explicit themes is overridden by all
 * of them. Adding `:root` to a theme's block without MOVING it is the
 * plausible wrong way to do this, and it is silent too.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
const layout = readFileSync(join(SRC, "app/layout.tsx"), "utf8");
const useThemeSource = readFileSync(join(SRC, "lib/useTheme.ts"), "utf8");

/** Every `:root,\n[data-theme="x"]` pairing, in source order. */
function rootThemes(): string[] {
  return [...css.matchAll(/:root,\s*\n\[data-theme="([a-z]+)"\]/g)].map((m) => m[1]!);
}

/**
 * Every theme block's selector in one stretch of the file, in source
 * order, `:root` pairings included.
 */
function blockOrder(section: string): { theme: string; isRoot: boolean }[] {
  return [...section.matchAll(/^(:root,\s*\n)?\[data-theme="([a-z]+)"\] \{/gm)].map((m) => ({
    theme: m[2]!,
    isRoot: Boolean(m[1]),
  }));
}

/**
 * The file holds two independent runs of theme blocks -- the palette and
 * the status banners -- and the order rule applies within each. The
 * banner section announces itself in a comment; splitting on it is what
 * lets each run be checked on its own rather than as one sequence in
 * which a second `:root` looks like a late one.
 */
function sections(): [string, string] {
  const marker = css.indexOf("status banners");
  expect(marker, "the status-banner section's comment moved").toBeGreaterThan(0);
  return [css.slice(0, marker), css.slice(marker)];
}

describe("the default theme, in all six places", () => {
  it("is plexus", () => {
    expect(rootThemes()[0]).toBe("plexus");
  });

  it("agrees across both :root blocks, the bootstrap, <html> and useTheme", () => {
    const roots = rootThemes();
    // Two `:root` blocks: the palette and the status banners. If a third
    // ever appears this still covers it, and if one is deleted the count
    // assertion says so rather than the agreement silently holding over
    // a smaller set.
    expect(roots).toHaveLength(2);

    const bootstrapFallback = layout.match(/!== 'system'\) t = '([a-z]+)';/)?.[1];
    const bootstrapCatch = layout.match(
      /catch \(_\) \{\s*\n\s*root\.dataset\.theme = '([a-z]+)';/,
    )?.[1];
    const htmlAttribute = layout.match(/^ {6}data-theme="([a-z]+)"$/m)?.[1];
    const resolvedConst = useThemeSource.match(
      /const DEFAULT_RESOLVED_THEME: ResolvedTheme = "([a-z]+)";/,
    )?.[1];

    // Every capture must have matched: an undefined here means the
    // shape moved and this gate stopped reading its own subject, which
    // is this repo's most-repeated defect and would otherwise pass as
    // "they all agree, on nothing".
    const spots = {
      cssPalette: roots[0],
      cssStatus: roots[1],
      bootstrapFallback,
      bootstrapCatch,
      htmlAttribute,
      resolvedConst,
    };
    for (const [name, value] of Object.entries(spots)) {
      expect(value, `${name} was not found -- the gate is reading the wrong shape`).toBeDefined();
    }
    expect(new Set(Object.values(spots)).size, `six spots disagree: ${JSON.stringify(spots)}`).toBe(
      1,
    );
  });

  it("opens each section with its :root block, so nothing below overrides it", () => {
    // `:root` and `[data-theme="x"]` have equal specificity, so a later
    // explicit block wins on every variable it declares. Each section
    // must therefore OPEN with its `:root` pairing -- adding `:root` to
    // a theme's block without moving the block is the plausible wrong
    // way to promote a theme, and it is silent.
    for (const [name, section] of Object.entries({
      palette: sections()[0],
      statusBanners: sections()[1],
    })) {
      const blocks = blockOrder(section);
      expect(blocks.length, `${name} has no theme blocks -- the gate lost its subject`).toBe(3);
      expect(
        blocks.filter((b) => b.isRoot),
        `${name}`,
      ).toHaveLength(1);
      expect(
        blocks[0]?.isRoot,
        `${name}'s first block is [data-theme="${blocks[0]?.theme}"], ` +
          `which overrides the :root block below it`,
      ).toBe(true);
    }
  });
});
