/**
 * The build must not need the network (ui#28).
 *
 * `next/font/google` downloads the font files from fonts.googleapis.com
 * while `next build` runs. When Google did not answer, the build failed with
 * 24 Turbopack errors and no test failed (three CI runs on 2026-11-15). It
 * also fails for anyone who builds with no network. The fonts are vendored in
 * `src/app/fonts/` and loaded with `next/font/local` instead.
 *
 * Reads sources as text: a font import is a build-time macro, not a value a
 * test can import in jsdom.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
const FONTS = join(__dirname, "fonts");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "generated") continue;
      sources(path, out);
    } else if (/\.(ts|tsx|js|jsx|mjs|css)$/.test(name) && !/fonts\.test\.ts$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

describe("fonts are served from the repository", () => {
  it("no source file loads fonts from Google", () => {
    const offenders = sources(SRC).filter((path) =>
      /from\s+["']next\/font\/google["']|import\(\s*["']next\/font\/google|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(
        readFileSync(path, "utf8"),
      ),
    );
    expect(offenders.map((p) => relative(SRC, p))).toEqual([]);
  });

  it("layout loads every font with next/font/local, and each file exists", () => {
    const layout = readFileSync(join(__dirname, "layout.tsx"), "utf8");
    expect(layout).toContain('from "next/font/local"');
    const files = [...layout.matchAll(/path:\s*"\.\/fonts\/([^"]+)"/g)].map((m) => m[1] as string);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(existsSync(join(FONTS, file)), file).toBe(true);
    }
  });

  it("keeps the CSS variables the themes read", () => {
    const layout = readFileSync(join(__dirname, "layout.tsx"), "utf8");
    const css = readFileSync(join(__dirname, "globals.css"), "utf8");
    for (const variable of [
      "--font-inter",
      "--font-ibm-plex-sans",
      "--font-ibm-plex-mono",
      "--font-jetbrains-mono",
      "--font-dm-sans",
    ]) {
      expect(layout, variable).toContain(`variable: "${variable}"`);
      expect(css, variable).toContain(`var(${variable})`);
    }
  });

  it("ships an OFL license for every family", () => {
    for (const family of ["inter", "ibm-plex-sans", "ibm-plex-mono", "jetbrains-mono", "dm-sans"]) {
      const text = readFileSync(join(FONTS, `OFL-${family}.txt`), "utf8");
      expect(text, family).toContain("SIL OPEN FONT LICENSE Version 1.1");
    }
  });
});
