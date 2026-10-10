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
import type { EngineDescriptor, EngineModelList } from "./types";

export type EligibilityEngine = LibraryComponents["schemas"]["EligibilityEngine"];
export type EngineVerdict = LibraryComponents["schemas"]["EngineVerdict"];
export type EligibilityLevel = LibraryComponents["schemas"]["EligibilityLevel"];
export type ModelEligibility = LibraryComponents["schemas"]["ModelEligibility"];
export type EligibilityList = LibraryComponents["schemas"]["EligibilityList"];
export type EngineFit = LibraryComponents["schemas"]["EngineFit"];
export type EngineFitModel = LibraryComponents["schemas"]["EngineFitModel"];
export type FitQuestion = LibraryComponents["schemas"]["FitQuestion"];
type FitVerdict = LibraryComponents["schemas"]["FitVerdict"];

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
    // How it uses memory (LS6); absent from an agent older than that.
    ...(e.fit ? { fit: e.fit } : {}),
  }));
}

/** What a request to the judge carries. */
export interface JudgeRequest {
  models?: string[];
  candidates?: EligibilityCandidate[];
  engines: EligibilityEngine[];
  /** Ask for each engine's fit too (LS6). */
  fit?: FitQuestion | null;
}

/**
 * Asks the judge. With a fit question every engine answers its own fit
 * (LS6); a Library older than that refuses the fields (422), and is asked
 * again without them, so its dots stay what they were rather than vanish.
 */
export async function judge(
  post: (body: unknown) => Promise<EligibilityList>,
  request: JudgeRequest,
  isRefusal: (err: unknown) => boolean,
): Promise<EligibilityList> {
  const { fit, ...rest } = request;
  if (!fit) return post(rest);
  try {
    return await post({ ...rest, fit });
  } catch (err) {
    if (!isRefusal(err)) throw err;
    return post({
      ...rest,
      engines: rest.engines.map((engine) => {
        const older = { ...engine };
        delete older.fit;
        return older;
      }),
    });
  }
}

/** A node's fit model for an engine (LS6): as it declared, or llama.cpp's
 * `spill` from an agent older than that, which is what it always was. */
export function fitModelOf(engine: EngineDescriptor | undefined): EngineFitModel | null {
  if (!engine) return null;
  if (engine.fit) return engine.fit;
  return engine.engine === "llama_cpp" ? { kind: "spill" } : null;
}

/** An engine whose own fit is a measured `no`: it counts as one that cannot
 * run the model (LS6). Not estimated, or unknown, never counts. */
export function fitsNot(v: EngineVerdict): boolean {
  return Boolean(v.fit?.estimated && v.fit.verdict === "no");
}

/**
 * The engine a model's dot is about, as the Library chose its level: the
 * first that runs it here and fits, else the first that would with another
 * step (an install, or a preparation) and fits.
 */
export function levelEngine(engines: EngineVerdict[]): EngineVerdict | undefined {
  const here = engines.find(
    (v) => v.available && (v.verdict === "runs" || v.verdict === "may_run") && !fitsNot(v),
  );
  if (here) return here;
  return engines.find(
    (v) =>
      !fitsNot(v) &&
      ((v.available && v.verdict === "after_preparation") ||
        (!v.available && v.installable && v.verdict !== "no")),
  );
}

/** One engine's own fit in a word (LS6). `split` covers llama.cpp's offload
 * and Strata's low-RAM mode alike: it runs, more slowly. */
export const ENGINE_FIT_WORD: Record<FitVerdict, string> = {
  fits: "fits",
  tight: "tight",
  split: "fits, slower",
  no: "does not fit",
  unknown: "can't tell",
};

export const ENGINE_FIT_CLASS: Record<FitVerdict, string> = {
  fits: "status-success",
  tight: "status-warn",
  split: "status-warn",
  no: "status-error",
  unknown: "status-warn",
};

/** One engine's own fit as a sentence, naming the engine; null when it was
 * not asked. Never another engine's number in its place. */
export function fitLine(v: EngineVerdict, name: (e: string) => string): string | null {
  const fit = v.fit;
  if (!fit) return null;
  if (!fit.estimated || !fit.verdict) return `${name(v.engine)}: fit not estimated (${fit.reason})`;
  const approximate = fit.approximate ? " (approximate)" : "";
  return `${name(v.engine)}: ${ENGINE_FIT_WORD[fit.verdict]}${approximate}: ${fit.reason}`;
}

/** The lists of models the node's engines publish as supported (LS4), as
 * the Library's search takes them: sent like `accepts`, so it calls no agent. */
export function engineLists(engines: EngineDescriptor[]): EngineModelList[] {
  return engines
    .filter((e) => (e.supportedModels ?? []).length > 0)
    .map((e) => ({ engine: e.engine, models: e.supportedModels ?? [] }));
}

/**
 * Whether an engine installed on the node runs something from a hub as it is
 * (Troy, 2026-10-09: then Discover opens on *Works here now*). A `prepared`
 * requirement does not count, nor one needing preparation: no hub model is
 * either, so with Strata alone the filter would open on nothing.
 */
export function runsHubModelsAsTheyAre(engines: EngineDescriptor[] | null): boolean {
  return (engines ?? []).some(
    (e) =>
      e.available &&
      eligibilityEngines([e])[0]!.accepts.some(
        (need) => need.format !== "prepared" && need.preparation == null,
      ),
  );
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
      // No hub model is prepared: an engine makes those on this machine
      // (LS3). Counting Strata's sent the hub `format=prepared`, which it
      // ignores, and the filter then hid every row it returned.
      if (need.format === "prepared") continue;
      const prepared = need.preparation != null;
      const here = e.available && !prepared;
      const other = (!e.available && e.installable) || (e.available && prepared);
      if (level === "works_here" ? here : other) formats.add(need.format);
    }
  }
  return formats.size === 1 ? [...formats][0]! : null;
}
