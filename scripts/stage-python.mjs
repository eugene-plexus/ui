#!/usr/bin/env node
// Copy the static export into the Python package, so `python -m build`
// has something to put in the wheel.
//
// Separate from `next build` on purpose: the export in `out/` is the
// artifact, and staging it is a packaging step that a developer running
// `npm run dev` should never pay for. Run by `npm run build:python` and
// by the ui repo's CI.

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(REPO_ROOT, "out");
const STATIC = join(REPO_ROOT, "python", "eugene_plexus_ui", "static");

if (!existsSync(join(OUT, "index.html"))) {
  console.error(
    `error: ${OUT} has no index.html.\n` +
      `Run 'npm run build' first — and note that a dev build does not ` +
      `produce an export: 'output: export' is set only when NODE_ENV is production.`,
  );
  process.exit(1);
}

rmSync(STATIC, { recursive: true, force: true });
mkdirSync(STATIC, { recursive: true });
cpSync(OUT, STATIC, { recursive: true });
console.log(`staged ${OUT} -> ${STATIC}`);
