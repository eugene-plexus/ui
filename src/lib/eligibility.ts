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
