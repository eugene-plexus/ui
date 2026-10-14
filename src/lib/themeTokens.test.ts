/**
 * Every colour token and status class the source names exists.
 *
 * A `var(--name, #fallback)` whose name nothing defines is not an error
 * anywhere: the browser quietly uses the fallback in every theme. That is
 * how the Inference screen came to colour its states in GitHub-dark hexes
 * that measure 2.4:1 on the light themes, how Nodes' "reachable" was never
 * green, and how "Folders saved" rendered as a plain box -- `status-ok` was
 * never a class; the success banner is `status-success`. The legibility
 * pass could not reach any of them because none of them used the tokens.
 *
 * Read as TEXT, like `themeDefault.test.ts`: a class name inside a string
 * is not a value any module exports.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { stripComments } from "./vocabulary";

const SRC = join(__dirname, "..");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (entry === "generated" || entry === "node_modules") continue;
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

const css = readFileSync(join(SRC, "app", "globals.css"), "utf-8");
const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const classes = new Set([...css.matchAll(/\.([a-z][a-z0-9-]*)\s*[,{:]/g)].map((m) => m[1]));
// Comments are not styles: a docblock may name a colour in prose.
const files = sources(SRC).map((path) => ({
  path,
  text: stripComments(readFileSync(path, "utf-8")),
}));

describe("the tokens the source names", () => {
  it("found some, so an empty scan cannot pass as agreement", () => {
    expect(defined.size).toBeGreaterThan(20);
    expect(classes.has("status-success")).toBe(true);
    expect(files.length).toBeGreaterThan(50);
  });

  it("are all defined in globals.css", () => {
    const missing: string[] = [];
    for (const { path, text } of files) {
      for (const m of text.matchAll(/var\((--[a-z0-9-]+)/g)) {
        if (!defined.has(m[1])) missing.push(`${path.slice(SRC.length + 1)}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("name only status classes that exist", () => {
    const missing: string[] = [];
    for (const { path, text } of files) {
      for (const m of text.matchAll(/(?<![\w-])((?:text-)?status-[a-z]+)(?![\w-])/g)) {
        if (!classes.has(m[1])) missing.push(`${path.slice(SRC.length + 1)}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
