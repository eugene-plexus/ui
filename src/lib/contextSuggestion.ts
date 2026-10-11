/**
 * The context a new profile starts at, asked of the machine that will run it.
 *
 * Run (`oneClickRun.ts`) and the profile form (`ProfileEditor.tsx`) both
 * start a new profile here. The first number is admission's
 * `maxContextLength`: the longest context at which the whole file fits on
 * the card. That rule is unchanged, and it answers every model that fits
 * on the card at some context.
 *
 * **A3c: a mixture-of-experts model on a card smaller than its file has no
 * such number** -- admission hands back 0, "the weights alone do not fit"
 * -- and the profile used to start empty. Then llama.cpp's own fit drops
 * the context to its 4,096 floor before it moves a single expert
 * (profile-builder §0 M2). So Home recommended a 30B-A3B saying *that way
 * it fits up to 61,440 tokens*, and the run it started held 4,096. The
 * second number is the library's `maxContextExpertsInRam`, scored against
 * the same machine: every layer on the card, the experts in system memory.
 *
 * It is taken only when the library says the model runs that way
 * (`offload: experts`) and only for llama.cpp, the one engine whose fit
 * moves experts. A dense model too big for the card still starts empty,
 * as before: its layer spill is llama.cpp's to arrange, and no number here
 * describes it.
 *
 * Soft throughout. A failed read means the engine's default, which the
 * launch's own admission explains if it does not fit -- the same answer
 * as before this existed.
 */

import { api } from "./api";
import { contextPrefill } from "./launchSpec";
import { budgetFromNode, fitQuery } from "./nodeBudget";
import type { Admission, LibraryModel, ModelFit, NodeIdentity } from "./types";

/** The engine whose fit keeps every layer on the card and moves experts. */
const EXPERTS_MOVE_ON = "llama_cpp";

/**
 * A starting context, and which way of running it was worked out for --
 * so a form that shows it can say which, rather than calling an
 * experts-in-RAM number "the largest context that fits entirely on the
 * card" (settings never lie).
 */
export interface ContextSuggestion {
  tokens: number;
  /** `whole`: the file and its cache on the card. `experts`: every layer
   * on the card, the experts in system memory. */
  way: "whole" | "experts";
}

export async function suggestContext(
  model: Pick<LibraryModel, "id" | "path" | "contextLength">,
  target: string,
  engine: string,
): Promise<ContextSuggestion | null> {
  let answer: Admission;
  try {
    answer = await api.post<Admission>(target, "/v1/runtimes/admission", {
      name: "context-probe",
      engine,
      modelPath: model.path,
      autoStart: false,
    });
  } catch {
    return null;
  }
  const whole = contextPrefill(answer.maxContextLength, model.contextLength);
  if (whole !== null) return { tokens: whole, way: "whole" };
  // The whole file fits at the model's own context, or admission could
  // not measure it: either way there is nothing to cap.
  if (answer.fit === "fits" || answer.fit === "unknown") return null;
  if (engine !== EXPERTS_MOVE_ON) return null;
  return expertsInRamContext(model, target);
}

async function expertsInRamContext(
  model: Pick<LibraryModel, "id" | "contextLength">,
  target: string,
): Promise<ContextSuggestion | null> {
  try {
    const identity = await api.get<NodeIdentity>(target, "/v1/node");
    // No devices is detection failing, not a machine with no memory, and
    // a fit with no budget is scored against the library's own host --
    // which on a two-machine install is the wrong one.
    const budget = budgetFromNode(identity);
    if (!budget) return null;
    const params = new URLSearchParams(fitQuery(budget)).toString();
    const fit = await api.get<ModelFit>(
      "library",
      `/v1/models/${encodeURIComponent(model.id)}/fit?${params}`,
    );
    if (fit.fit?.offload !== "experts") return null;
    const longest = fit.maxContextExpertsInRam;
    if (typeof longest !== "number" || longest <= 0) return null;
    // **Always a number here, even the model's own.** `contextPrefill`
    // answers null when the model's own context fits, because a whole
    // file on the card lets llama.cpp's fit take the largest context. On
    // this path the file is not whole on the card, and an unset context
    // is the one fit shrinks to 4,096 before it moves an expert; set, fit
    // keeps it and moves experts instead (profile-builder §0 M2).
    const tokens = model.contextLength != null ? Math.min(longest, model.contextLength) : longest;
    return { tokens, way: "experts" };
  } catch {
    return null;
  }
}
