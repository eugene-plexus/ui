import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { contextLookup, contextText, withContext } from "./modelContext";
import type { ModelList } from "./types";

const LIST = {
  object: "list",
  data: [
    { id: "qwen3-14b", object: "model", x_eugene_plexus: { context_length: 32768 } },
    { id: "odd", object: "model", x_eugene_plexus: { context_length: 75520 } },
    { id: "cloud", object: "model", x_eugene_plexus: {} },
    { id: "bare", object: "model" },
  ],
} as unknown as ModelList;

describe("the one wording for a served model's window", () => {
  it("says a power of two short and any other number in full", () => {
    expect(contextText(32768)).toBe("32k context");
    expect(contextText(262144)).toBe("256k context");
    expect(contextText(75520)).toBe("75,520 context");
  });

  it("says unknown for no number, and for a number that cannot be a window", () => {
    expect(contextText(null)).toBe("context unknown");
    expect(contextText(undefined)).toBe("context unknown");
    expect(contextText(0)).toBe("context unknown");
  });

  it("puts the window after the name, and leaves an unserved name bare", () => {
    expect(withContext("qwen3-14b", 32768)).toBe("qwen3-14b · 32k context");
    expect(withContext("cloud", null)).toBe("cloud · context unknown");
    expect(withContext("gone", undefined)).toBe("gone");
  });
});

describe("a lookup over the gateway's list", () => {
  it("keeps served-with-a-window, served-without-one and not-served apart", () => {
    const lookup = contextLookup(LIST);
    expect(lookup("qwen3-14b")).toBe(32768);
    expect(lookup("odd")).toBe(75520);
    expect(lookup("cloud")).toBeNull();
    expect(lookup("bare")).toBeNull();
    expect(lookup("not-served")).toBeUndefined();
    expect(lookup(null)).toBeUndefined();
  });

  it("takes a plain array, and no list at all is nothing served", () => {
    expect(contextLookup(LIST.data)("qwen3-14b")).toBe(32768);
    expect(contextLookup(null)("qwen3-14b")).toBeUndefined();
  });
});

/**
 * The gate that keeps it one wording: read every screen as TEXT and fail on
 * a window spelled anywhere but `modelContext.ts`. Before this module the
 * playground said `32,768 ctx` and nothing else said anything; a second
 * spelling is how that starts again.
 */
describe("no screen spells a model's window its own way", () => {
  const SRC = join(__dirname, "..");
  const OWN = [
    // `${tokenCount(n)} ctx`, the playground's old spelling.
    { rule: "a number followed by ctx", pattern: /\} ctx\b/ },
    { rule: "its own 'context unknown'", pattern: /context unknown/ },
    { rule: "its own 'Nk context'", pattern: /k context\b/ },
    { rule: "a window put through tokenCount", pattern: /tokenCount\([^)]*context_length/ },
  ];

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === "generated" ? [] : sources(path);
      if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
      return name === "modelContext.ts" ? [] : [path];
    });
  }

  it("finds none outside lib/modelContext.ts", () => {
    const found: string[] = [];
    for (const file of sources(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const { rule, pattern } of OWN) {
        if (pattern.test(text)) found.push(`${relative(SRC, file)}: ${rule}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("would catch the old spelling, so the scan is not reading nothing", () => {
    const old = "parts.push(`${tokenCount(info.context_length)} ctx`);";
    expect(OWN.filter(({ pattern }) => pattern.test(old)).map((o) => o.rule)).toEqual([
      "a number followed by ctx",
      "a window put through tokenCount",
    ]);
    expect(sources(SRC).length).toBeGreaterThan(50);
  });
});
