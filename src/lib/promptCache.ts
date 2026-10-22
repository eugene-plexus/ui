/**
 * The engine's prompt cache (row 9, PC7; `docs/design/prompt-cache.md`).
 *
 * llama.cpp keeps recent conversations in system memory, and vLLM can move its KV cache
 * there. The agent owns the profile settings (`cacheRam`, `cacheReuse`, `ctxCheckpoints` for
 * llama.cpp, `kvOffloadGb` for vLLM) and says on each running model the size it was started
 * with, read from the command line, never from the profile. This file words that as a line.
 */

import type { Runtime } from "./types";

type RuntimePromptCache = NonNullable<Runtime["promptCache"]>;

/**
 * The profile fields Eugene passes on every start, so an unset one still has a value in
 * effect: the default the field shows. The editor says that with the field's own words,
 * where for every other flag unset means nothing is passed.
 */
export const PROMPT_CACHE_KEYS = new Set<string>(["cacheRam", "cacheReuse", "ctxCheckpoints"]);

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

/** `8 GiB`, `1.5 GiB`, `512 MiB`: binary, as memory is quoted. */
function size(bytes: number): string {
  if (bytes >= GIB) {
    const gib = bytes / GIB;
    return `${Number.isInteger(gib) ? gib : Number(gib.toFixed(1))} GiB`;
  }
  return `${Math.round(bytes / MIB)} MiB`;
}

const WHERE: Record<RuntimePromptCache["source"], string> = {
  profile: "set on the profile",
  engine_default: "the default",
  extra_args: "set in the extra arguments",
  off: "",
  unsupported: "",
};

/** What a running model keeps in system memory for recent conversations, as a fact. */
export function promptCacheLine(
  cache: RuntimePromptCache | null | undefined,
): { text: string; note: string | null } | null {
  if (!cache) return null;
  const note = cache.note ?? null;
  if (cache.source === "unsupported") return { text: "Prompt cache: not set", note };
  if (cache.source === "off" || cache.bytes === 0) return { text: "Prompt cache: off.", note };
  if (cache.bytes == null) {
    return { text: `Prompt cache: no limit, ${WHERE[cache.source]}.`, note };
  }
  return {
    text: `Prompt cache: ${size(cache.bytes)} of system memory, ${WHERE[cache.source]}.`,
    note,
  };
}
