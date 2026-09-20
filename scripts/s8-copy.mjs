/** Export the same source copy the S8 gate reads for an external readability pass. Node 24+. */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { COPY_SCREENS } from "../src/lib/copyScreens.ts";
import { jsxCopy } from "../src/lib/copyExtractor.ts";
import { extractCopy, looksLikeProse } from "../src/lib/vocabulary.ts";

const root = fileURLToPath(new URL("../src/", import.meta.url));
function files(path) {
  if (statSync(path).isDirectory())
    return readdirSync(path).flatMap((name) => files(join(path, name)));
  return /\.tsx?$/.test(path) && !path.includes(".test.") ? [path] : [];
}
const copy = new Set();
for (const path of new Set(
  Object.values(COPY_SCREENS)
    .flat()
    .flatMap((path) => files(join(root, path))),
)) {
  const source = readFileSync(path, "utf8");
  for (const text of [...jsxCopy(source), ...extractCopy(source).visible]) {
    if (looksLikeProse(text)) copy.add(text.replace(/&rsquo;/g, "'").replace(/&[a-z]+;/g, " "));
  }
}
const text = [...copy].join("\n\n");
if (!process.argv[2]) throw new Error("Supply an output text-file path.");
writeFileSync(process.argv[2], text);
console.log(`Exported ${copy.size} unique copy fragments, ${text.split(/\s+/).length} words.`);
