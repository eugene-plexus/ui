/**
 * Speculative decoding (SD1, `docs/design/speculative-decoding.md`): the
 * profile's two settings as this model can use them, the settings
 * builder's choice, and what a running model shows.
 *
 * The agent's llama.cpp adapter owns the fields (`reuseRepeatedText`,
 * `draftWith`, `draftModelPath`, `draftTokens`); this file only narrows
 * them to what the Library found in the model's file and folder, so a
 * profile never offers a way of drafting the model cannot use.
 */

import type { components as AgentComponents } from "@/generated/agent";
import { PROMPT_CACHE_KEYS } from "./promptCache";
import type { ConfigField, LibraryModel, ProfileBuild, Runtime } from "./types";

type DraftTrial = AgentComponents["schemas"]["DraftTrial"];
type RuntimeSpeculation = NonNullable<Runtime["speculation"]>;

export const REUSE_TEXT_KEY = "reuseRepeatedText";
export const DRAFT_WITH_KEY = "draftWith";
export const DRAFT_MODEL_KEY = "draftModelPath";
export const DRAFT_TOKENS_KEY = "draftTokens";

/**
 * Fields the adapter acts on when a profile leaves them unset: "Reuse
 * repeated text" is on for every llama.cpp runtime (S3), and the three prompt
 * cache settings are passed on every start (row 9). The editor shows the
 * adapter's own default and words for these, where for every other flag
 * unset means nothing is passed.
 */
export const ACTS_WHEN_UNSET = new Set<string>([REUSE_TEXT_KEY, ...PROMPT_CACHE_KEYS]);

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * The flag fields as this model can use them. "Draft with" offers the
 * model's own head only when its file carries one and a companion file
 * only when its folder holds one; a value a profile already has is kept
 * in the list, so it is shown as itself. The companion is picked from the
 * folder's files, and it and "Tokens drafted per step" appear only when
 * something drafts.
 */
export function speculationFields(
  fields: ConfigField[],
  model: LibraryModel,
  flags: Record<string, unknown>,
): ConfigField[] {
  const found = model.gguf?.speculation ?? null;
  const files = found?.draftFiles ?? [];
  const current = typeof flags[DRAFT_WITH_KEY] === "string" ? flags[DRAFT_WITH_KEY] : null;
  const offered = new Set<string>(["off"]);
  if (found?.mtpHead) offered.add("mtpHead");
  if (files.length > 0) offered.add("companion");
  if (current) offered.add(current);
  const drafting = current === "mtpHead" || current === "companion";
  const out: ConfigField[] = [];
  for (const field of fields) {
    if (field.key === DRAFT_WITH_KEY) {
      if (offered.size === 1) continue;
      const values = field.enumValues ?? [];
      const labels = field.enumLabels ?? values;
      const kept = values
        .map((v, i) => [v, labels[i] ?? v] as const)
        .filter(([v]) => offered.has(v));
      out.push({ ...field, enumValues: kept.map(([v]) => v), enumLabels: kept.map(([, l]) => l) });
    } else if (field.key === DRAFT_MODEL_KEY) {
      if (current !== "companion") continue;
      const chosen =
        typeof flags[DRAFT_MODEL_KEY] === "string" ? String(flags[DRAFT_MODEL_KEY]) : null;
      const paths = files.map((f) => f.path);
      const labels = files.map(
        (f) => `${basename(f.path)} (${f.kind === "mtp" ? "MTP head" : "draft model"})`,
      );
      if (chosen && !paths.includes(chosen)) {
        paths.push(chosen);
        labels.push(`${basename(chosen)} (not in this model's folder now)`);
      }
      out.push({ ...field, valueType: "enum", enumValues: paths, enumLabels: labels });
    } else if (field.key === DRAFT_TOKENS_KEY) {
      if (drafting) out.push(field);
    } else {
      out.push(field);
    }
  }
  return out;
}

// --- the settings builder ----------------------------------------------------

/** The trial the build chose (S1), or null when it timed nothing. */
export function chosenTrial(build: ProfileBuild): DraftTrial | null {
  const trials = build.draftTrials ?? [];
  const index = build.recommendedDraft;
  return index != null ? (trials[index] ?? null) : null;
}

/** The flags a build's drafting choice sets: Off explicitly, so the profile says it was timed. */
export function builtDraftFlags(build: ProfileBuild): Record<string, unknown> {
  const trial = chosenTrial(build);
  if (!trial) return {};
  const flags: Record<string, unknown> = { [DRAFT_WITH_KEY]: trial.draftWith };
  if (trial.draftWith === "companion" && trial.draftModelPath) {
    flags[DRAFT_MODEL_KEY] = trial.draftModelPath;
  }
  return flags;
}

const TRIAL_WORDS: Record<DraftTrial["draftWith"], string> = {
  off: "nothing drafting",
  mtpHead: "the model's own prediction head",
  companion: "a companion file",
};

function speed(trial: DraftTrial): string {
  return trial.decodeTokensPerSecond != null
    ? `${trial.decodeTokensPerSecond.toFixed(1)} tok/s`
    : "did not serve";
}

/** One line per trial, the chosen one first said, for the build's result. */
export function draftLines(build: ProfileBuild): string[] {
  const trials = build.draftTrials ?? [];
  if (trials.length === 0) return [];
  const chosen = chosenTrial(build);
  const lines = trials.map((t) => {
    const what =
      t.draftWith === "companion" && t.draftModelPath
        ? basename(t.draftModelPath)
        : TRIAL_WORDS[t.draftWith];
    const kept = t.draftedTokens ? ` · ${acceptance(t.acceptedTokens ?? 0, t.draftedTokens)}` : "";
    return `${what}: ${speed(t)}${kept}`;
  });
  const head = chosen
    ? chosen.draftWith === "off"
      ? "Drafting: off. No way of drafting was faster here."
      : `Drafting: ${TRIAL_WORDS[chosen.draftWith]}, the fastest here.`
    : "Drafting: not timed.";
  return [head, ...lines];
}

// --- a running model ---------------------------------------------------------

function acceptance(accepted: number, drafted: number): string {
  const rate = drafted > 0 ? Math.round((accepted / drafted) * 100) : 0;
  return `${rate}% of drafted tokens kept (${accepted.toLocaleString()} of ${drafted.toLocaleString()})`;
}

const TYPE_WORDS: Record<string, string> = {
  "ngram-mod": "repeated text",
  "draft-simple": "draft model",
};

/** What a running model drafts with, and how much it keeps, as a fact (S3). */
export function speculationLine(
  speculation: RuntimeSpeculation | null | undefined,
): { text: string; note: string | null } | null {
  if (!speculation) return null;
  const names = speculation.types.map((t) =>
    t === "draft-mtp"
      ? speculation.draftModelPath
        ? `MTP head (${basename(speculation.draftModelPath)})`
        : "MTP head"
      : (TYPE_WORDS[t] ?? t),
  );
  if (names.length === 0) {
    return speculation.note ? { text: "Speculative decoding: off", note: speculation.note } : null;
  }
  const drafted = speculation.draftedTokens;
  const counted =
    drafted != null && drafted > 0
      ? ` · ${acceptance(speculation.acceptedTokens ?? 0, drafted)}`
      : drafted === 0
        ? " · nothing drafted yet"
        : "";
  return { text: `Drafting with ${names.join(" and ")}${counted}`, note: speculation.note ?? null };
}
