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
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = root;
const cases = [
  [
    "collapsed engine management",
    "app/inference/page.tsx",
    "const [expanded, setExpanded] = useState(false);",
    "const [expanded, setExpanded] = useState(true);",
  ],
  [
    "manual setup disclosure",
    "app/inference/page.tsx",
    "{(reason || manual) && (\n                <details",
    "{(reason || manual) && (\n                <details open",
  ],
  [
    "visible installation failure",
    "app/inference/page.tsx",
    "if (needsAttention) setExpanded(true);",
    "if (false) setExpanded(true);",
  ],
  [
    "duplicate model identity",
    "app/inference/page.tsx",
    '!repeatsModel(row.runtime, row.model ?? "")',
    "true",
  ],
];
const only = process.argv.slice(2);
const selected = cases.filter((c) => !only.length || only.includes(c[0]));
if (!selected.length) throw new Error("No sabotage cases selected");
const originals = new Map(selected.map(([, file]) => [file, readFileSync(join(web, "src", file))]));
const temporary = mkdtempSync(join(tmpdir(), "engines-ui-sabotage-"));
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
        "src/app/inference/page.test.tsx",
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
      if (
        result.status !== 1 ||
        !/AssertionError|Error: expect\(element\)/.test(result.stdout + result.stderr)
      )
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
