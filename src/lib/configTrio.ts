/**
 * One component's config schema and document, fetched once for every
 * reader that asks at the same time.
 *
 * The Settings page (2026-09-29) renders one editor section per topic
 * per owner, so the gateway's schema is wanted by six sections and by
 * the page that decides which section gets which field. Six identical
 * requests in one frame is the per-call client construction of review
 * §6 #2 one layer up, in miniature; and two answers that differ — a save
 * landing between them — would put one section's fields under another's
 * headings. So an in-flight or recently answered read is shared, for a
 * few seconds, and a save or a restart throws it away.
 */

import { api } from "./api";
import type { ConfigDocument, ConfigSchema } from "./types";

export interface ConfigTrio {
  schema: ConfigSchema;
  doc: ConfigDocument;
}

interface Entry {
  promise: Promise<ConfigTrio>;
  /** When the answer may no longer be handed out; 0 while in flight. */
  until: number;
}

/** How long an answered read is reused. Long enough for one page's sections, short enough that navigating back sees a change made elsewhere. */
export const CONFIG_TRIO_TTL_MS = 5_000;

const cache = new Map<string, Entry>();

function keyOf(target: string, base: string): string {
  return `${target}\n${base}`;
}

/**
 * The schema and document at `base` (`/v1/config` for a component) on
 * `target`. A failure is not cached: the next reader asks again.
 */
export function loadConfigTrio(target: string, base = "/v1/config"): Promise<ConfigTrio> {
  const key = keyOf(target, base);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && (hit.until === 0 || hit.until > now)) return hit.promise;
  const promise = Promise.all([
    api.get<ConfigSchema>(target, `${base}/schema`),
    api.get<ConfigDocument>(target, base),
  ]).then(
    ([schema, doc]) => {
      const entry = cache.get(key);
      if (entry?.promise === promise) entry.until = Date.now() + CONFIG_TRIO_TTL_MS;
      return { schema, doc };
    },
    (err: unknown) => {
      const entry = cache.get(key);
      if (entry?.promise === promise) cache.delete(key);
      throw err;
    },
  );
  cache.set(key, { promise, until: 0 });
  return promise;
}

/** Forget what was read from `target`: after a save, a restart, or a test that changed something. */
export function invalidateConfigTrio(target: string, base?: string): void {
  if (base) {
    cache.delete(keyOf(target, base));
    return;
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${target}\n`)) cache.delete(key);
  }
}

/** Every cached read, for tests and for a sign-out. */
export function clearConfigTrios(): void {
  cache.clear();
}
