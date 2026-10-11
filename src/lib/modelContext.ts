/**
 * A served model's context window, said the same way wherever its name is.
 *
 * Once a model was serving, its window was hard to find: the playground's
 * picker said `32,768 ctx` in small print and no other screen said anything
 * (Troy, 2026-09-28, after a tester could not tell). The gateway already
 * reports it on `GET /v1/models` as `x_eugene_plexus.context_length`, the
 * smallest window among the backends serving that id, since a request may
 * land on any of them.
 *
 * One wording, `qwen3-14b · 32k context`, from this module only, so no
 * screen can drift into its own. Three states, kept apart on purpose:
 *
 * - a number: the gateway serves the id and knows its window;
 * - `null`: the gateway serves it and cannot say (an engine that has not
 *   answered yet, a provider that lists no window) -- "context unknown";
 * - `undefined`: the gateway does not serve that id at all (a model a
 *   metrics row remembers, a fallback typed before it runs), so nothing is
 *   said rather than a claim about a model that is not there.
 */

import { contextLabel } from "./starter";
import type { Model, ModelList } from "./types";

/** What the page knows about one id's window; see the module comment. */
export type ServedContext = number | null | undefined;

/** Finds the window for a model id, as `GET /v1/models` spells the id. */
export type ContextLookup = (model: string | null | undefined) => ServedContext;

/** `32k context`, or `context unknown`. */
export function contextText(tokens: number | null | undefined): string {
  return tokens != null && tokens > 0 ? `${contextLabel(tokens)} context` : "context unknown";
}

/** `qwen3-14b · 32k context`; the bare name when the id is not served. */
export function withContext(name: string, context: ServedContext): string {
  return context === undefined ? name : `${name} · ${contextText(context)}`;
}

/** One listed model's window: its number, or `null` when it gives none. */
export function contextOf(model: Model): number | null {
  const tokens = model.x_eugene_plexus?.context_length;
  return typeof tokens === "number" && tokens > 0 ? tokens : null;
}

/** A lookup over a model list. No list yet is "nothing is served". */
export function contextLookup(list: ModelList | readonly Model[] | null): ContextLookup {
  const models = list === null ? [] : Array.isArray(list) ? list : (list as ModelList).data;
  const byId = new Map<string, number | null>();
  for (const m of models ?? []) byId.set(m.id, contextOf(m));
  return (model) => (model != null && byId.has(model) ? byId.get(model) : undefined);
}
