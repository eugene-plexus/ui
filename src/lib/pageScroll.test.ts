/**
 * Every page inside the app shell brings its own scroll container.
 *
 * The shell is `h-dvh` with `overflow-hidden` (`components/AppShell.tsx`),
 * so the window never scrolls, and a page with nothing of its own that
 * scrolls leaves everything below the fold unreachable. That shipped
 * three times: /routing and /metrics (2026-09-21), then /nodes, whose
 * join command's Copy buttons could not be reached (2026-09-26). Each
 * fix had its own page test, and none of them could see the next page.
 *
 * So this reads every page as TEXT. jsdom applies no CSS, so a class is
 * the only assertion available, and reading the source is the only way
 * to cover pages no test renders. A page that delegates its body to one
 * component names that component below, and the component must carry
 * the class instead.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
const APP = join(SRC, "app");

/** Pages whose whole body is one component, which scrolls for them. */
const DELEGATES: Record<string, string> = {
  "library/folders/page.tsx": "components/LibraryFolders.tsx",
  "logs/page.tsx": "components/LogsView.tsx",
};

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...pages(path));
    else if (name === "page.tsx") out.push(path);
  }
  return out;
}

function scrolls(source: string): boolean {
  return /\boverflow-y-auto\b/.test(source);
}

describe("pages inside the app shell", () => {
  const shellPages = pages(APP)
    .map((path) => ({
      name: relative(APP, path).split(sep).join("/"),
      source: readFileSync(path, "utf8"),
    }))
    .filter((page) => page.source.includes("<AppShell"));

  it("were found, so an empty list cannot pass", () => {
    expect(shellPages.length).toBeGreaterThan(10);
    expect(shellPages.map((p) => p.name)).toContain("nodes/page.tsx");
  });

  it("each bring their own scroll container", () => {
    const missing = shellPages
      .filter((page) => {
        if (scrolls(page.source)) return false;
        const delegate = DELEGATES[page.name];
        return !delegate || !scrolls(readFileSync(join(SRC, delegate), "utf8"));
      })
      .map((page) => page.name);
    expect(missing, "pages whose content below the fold cannot be reached").toEqual([]);
  });
});
