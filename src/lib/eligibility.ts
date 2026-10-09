/**
 * Which engines can run a model: the Library judges, this asks
 * (library-sources-and-engines.md, LS1; Troy's L2).
 *
 * The console sends the picked node's engines as that node reported
 * them, each with what it `accepts`, and the Library answers a verdict
 * per engine and one level per model: Troy's three-level dot (L5).
 */

import { offeredOnThisNode } from "./engineCompat";
import type { components as LibraryComponents } from "@/generated/library";
import type { EngineDescriptor } from "./types";

export type EligibilityEngine = LibraryComponents["schemas"]["EligibilityEngine"];
export type EngineVerdict = LibraryComponents["schemas"]["EngineVerdict"];
export type EligibilityLevel = LibraryComponents["schemas"]["EligibilityLevel"];
export type ModelEligibility = LibraryComponents["schemas"]["ModelEligibility"];
export type EligibilityList = LibraryComponents["schemas"]["EligibilityList"];

/** Troy's words for the three levels, 2026-10-09. */
export const LEVEL_WORDS: Record<EligibilityLevel, string> = {
  works_here: "Will work on this machine now",
  other_engine: "Will work with a different engine",
  not_here: "Can not work on this machine",
};

/** The same, short enough for a list row. */
export const LEVEL_SHORT: Record<EligibilityLevel, string> = {
  works_here: "works here",
  other_engine: "other engine",
  not_here: "not here",
};

export const LEVEL_CLASS: Record<EligibilityLevel, string> = {
  works_here: "status-success",
  other_engine: "status-warn",
  not_here: "status-error",
};

/** A node's engines as `POST /v1/eligibility` takes them. An agent older
 * than `accepts` reported only formats, which are whole rules of their own. */
export function eligibilityEngines(engines: EngineDescriptor[]): EligibilityEngine[] {
  return engines.map((e) => ({
    engine: e.engine,
    available: e.available,
    installable: !e.available && offeredOnThisNode(e),
    experimental: Boolean(e.experimental),
    accepts: e.accepts ?? (e.modelFormats ?? []).map((format) => ({ format, preference: 100 })),
  }));
}

/** Engines that run the model as it is, or may: what a profile can name. */
export function runnable(verdicts: EngineVerdict[]): EngineVerdict[] {
  return verdicts.filter((v) => v.verdict === "runs" || v.verdict === "may_run");
}

// --- models not downloaded yet (LS2) ----------------------------------------

export type EligibilityCandidate = LibraryComponents["schemas"]["EligibilityCandidate"];

/** Green, amber, red: the order Discover lists them in. */
export const LEVEL_RANK: Record<EligibilityLevel, number> = {
  works_here: 0,
  other_engine: 1,
  not_here: 2,
};

/** The best of several answers: a search row serving GGUF and safetensors
 * is as good as its better format. */
export function bestAnswer(
  answers: (ModelEligibility | undefined)[],
): ModelEligibility | undefined {
  let best: ModelEligibility | undefined;
  for (const answer of answers) {
    if (answer && (!best || LEVEL_RANK[answer.level] < LEVEL_RANK[best.level])) best = answer;
  }
  return best;
}

/** One engine's verdict as a sentence about one machine. */
export function verdictLine(v: EngineVerdict, where: string, name: (e: string) => string): string {
  const state = v.available
    ? ""
    : v.installable
      ? `; not installed on ${where} yet`
      : `; cannot run on ${where}`;
  return `${name(v.engine)}${v.experimental ? " (experimental)" : ""}: ${v.reason}${state}`;
}

/**
 * Which formats an engine filter can ask the hub for, so a page of thirty
 * results is not mostly rows the filter then hides. `null` when the
 * engines in question load more than one format (or none is known): the
 * hub is asked for everything and the judge sorts it out.
 *
 * Read off what the engines declare, not decided here: `works_here` is
 * what installed engines load as it is; `other_engine` what an engine this
 * machine could install loads, or what an installed one prepares.
 */
export function hubFormatFor(
  level: EligibilityLevel | null,
  engines: EngineDescriptor[] | null,
): string | null {
  if (level === null || level === "not_here" || engines === null) return null;
  const formats = new Set<string>();
  for (const e of eligibilityEngines(engines)) {
    for (const need of e.accepts) {
      const prepared = need.preparation != null;
      const here = e.available && !prepared;
      const other = (!e.available && e.installable) || (e.available && prepared);
      if (level === "works_here" ? here : other) formats.add(need.format);
    }
  }
  return formats.size === 1 ? [...formats][0]! : null;
}
