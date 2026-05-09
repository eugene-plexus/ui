#!/usr/bin/env node
// Regenerate TypeScript types from the pinned specs commit.
//
// Reads `SPECS_REF` (a single line: the git SHA of `eugene-plexus/specs`),
// downloads the OpenAPI tree at that SHA, and runs `openapi-typescript`
// to produce TS types under `src/generated/`. Generated files are
// committed for reproducibility; CI re-runs and fails on diff.
//
// Usage: npm run codegen
// To bump: overwrite SPECS_REF, re-run.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SPECS_REF_FILE = join(REPO_ROOT, "SPECS_REF");
const GENERATED_DIR = join(REPO_ROOT, "src", "generated");
const WORKING_DIR = join(REPO_ROOT, ".codegen-cache");

const SPECS = [
  { input: "openapi/orchestrator.yaml", output: "orchestrator.ts" },
  { input: "openapi/hemisphere-driver.yaml", output: "hemisphere-driver.ts" },
];

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: false, ...opts });
  if (result.status !== 0) {
    fail(`${cmd} ${args.join(" ")} exited with status ${result.status}`);
  }
}

async function downloadSpecs(ref) {
  const url = `https://github.com/eugene-plexus/specs/archive/${ref}.tar.gz`;
  console.log(`fetching ${url}`);

  rmSync(WORKING_DIR, { recursive: true, force: true });
  mkdirSync(WORKING_DIR, { recursive: true });

  const response = await fetch(url);
  if (!response.ok) {
    fail(`fetching ${url} returned HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());

  const archiveName = "specs.tar.gz";
  const archivePath = join(WORKING_DIR, archiveName);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(archivePath, buffer);

  // Run tar with relative paths from inside WORKING_DIR — Windows tar
  // mis-interprets `D:\...` as a remote ssh target ("Cannot connect to
  // D"). Relative paths sidestep that.
  run("tar", ["-xzf", archiveName], { cwd: WORKING_DIR });

  // The extracted directory is named specs-<ref>; locate it.
  const { readdirSync, statSync } = await import("node:fs");
  const entries = readdirSync(WORKING_DIR);
  const specsDir = entries.find(
    (e) => e.startsWith("specs-") && statSync(join(WORKING_DIR, e)).isDirectory(),
  );
  if (!specsDir) {
    fail(`could not locate specs-* directory in extracted tarball`);
  }
  return join(WORKING_DIR, specsDir);
}

async function runCodegen(specsRoot, ref) {
  rmSync(GENERATED_DIR, { recursive: true, force: true });
  mkdirSync(GENERATED_DIR, { recursive: true });

  const { writeFileSync } = await import("node:fs");
  const indexBanner = `// Generated TypeScript types — DO NOT EDIT BY HAND.
//
// Regenerate with:
//   npm run codegen
//
// Source: https://github.com/eugene-plexus/specs at commit ${ref}

export const SPECS_REF = "${ref}";
`;
  writeFileSync(join(GENERATED_DIR, "index.ts"), indexBanner);

  for (const { input, output } of SPECS) {
    const inputPath = join(specsRoot, input);
    const outputPath = join(GENERATED_DIR, output);
    console.log(`generating ${output} from ${input}`);
    // Resolve the locally-installed binary explicitly. `npx` auto-resolves
    // too, but its argument-parsing quirks across npm/Node versions make
    // direct resolution more reliable in CI.
    const binCmd = process.platform === "win32" ? "openapi-typescript.cmd" : "openapi-typescript";
    const binPath = join(REPO_ROOT, "node_modules", ".bin", binCmd);
    run(binPath, [inputPath, "-o", outputPath], { shell: process.platform === "win32" });
  }
}

async function main() {
  const ref = readFileSync(SPECS_REF_FILE, "utf8").trim();
  if (!ref) {
    fail(`${SPECS_REF_FILE} is empty`);
  }
  console.log(`specs ref: ${ref}`);

  const specsRoot = await downloadSpecs(ref);
  try {
    await runCodegen(specsRoot, ref);
  } finally {
    rmSync(WORKING_DIR, { recursive: true, force: true });
  }

  console.log(`wrote ${GENERATED_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
