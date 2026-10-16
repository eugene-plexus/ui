/* global process, console */
// Mutate copies only. A parse/import failure does not prove a guard is observed.
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = root;
const cases = [
  [
    "deduplicate model aliases",
    "lib/gatewayDashboard.ts",
    "backend.node ?? null, backend.driver",
    "backend.node ?? null, backend.driver, slot.model",
  ],
  [
    "keep distinct nodes",
    "lib/gatewayDashboard.ts",
    "backend.node ?? null, backend.driver",
    "backend.driver",
  ],
  ["server outcome filtering", "app/metrics/page.tsx", "outcome=${outcome}", "ignored=${outcome}"],
  [
    "unknown tail latency",
    "components/GatewayOperations.tsx",
    'typeof value === "number" ? msLabel(value) : "unreported"',
    'typeof value === "number" ? msLabel(value) : "0 ms"',
  ],
];
const only = process.argv.slice(2);
const selected = cases.filter((c) => !only.length || only.includes(c[0]));
if (!selected.length) throw new Error("No sabotage cases selected");
const originals = new Map(selected.map(([, file]) => [file, readFileSync(join(web, "src", file))]));
const temporary = mkdtempSync(join(tmpdir(), "metrics-ui-sabotage-"));
try {
  symlinkSync(
    join(web, "node_modules"),
    join(temporary, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  cpSync(join(web, "src"), join(temporary, "src"), { recursive: true });
  for (const file of ["package.json", "tsconfig.json", "vitest.config.mts", "vitest.setup.ts"])
    cpSync(join(web, file), join(temporary, file));
  const run = () =>
    spawnSync(
      process.execPath,
      [
        join(web, "node_modules/vitest/vitest.mjs"),
        "run",
        "src/app/metrics/page.test.tsx",
        "src/components/GatewayOperations.test.tsx",
        "src/lib/gatewayDashboard.test.ts",
        "--reporter=dot",
      ],
      { cwd: temporary, encoding: "utf8", timeout: 60000 },
    );
  const control = run();
  if (control.status !== 0) throw new Error(control.stdout + control.stderr);
  console.log("PASS unmodified UI control");
  for (const [label, file, anchor, replacement] of selected) {
    const path = join(temporary, "src", file),
      original = originals.get(file).toString("utf8");
    if (original.split(anchor).length !== 2) throw new Error(`Ambiguous anchor: ${label}`);
    try {
      writeFileSync(path, original.replace(anchor, replacement));
      const result = run();
      const output = stripVTControlCharacters(result.stdout + result.stderr);
      if (result.status !== 1 || !/AssertionError|Error: expect\(element\)/.test(output))
        throw new Error(`Missed ${label}:\n${result.stdout}\n${result.stderr}`);
      console.log(`PASS caught ${label}`);
    } finally {
      writeFileSync(path, originals.get(file));
    }
  }
} finally {
  if (dirname(resolve(temporary)) !== resolve(tmpdir()))
    throw new Error("Unexpected temporary path");
  if (existsSync(join(temporary, "node_modules"))) unlinkSync(join(temporary, "node_modules"));
  rmSync(temporary, { recursive: true, force: true });
  for (const [file, bytes] of originals)
    if (!readFileSync(join(web, "src", file)).equals(bytes))
      throw new Error("Working source changed");
}
