/**
 * The playground's sampling settings -- the pure half.
 *
 * The gateway owns every output-affecting parameter: an unset field is
 * OMITTED from the request, and the model's profile then the gateway
 * default decide (R8's precedence). So the panel keeps raw strings and
 * this module turns them into request values only where something was
 * typed -- a default written here would silently override the install's,
 * which is the one thing the standing rule forbids.
 *
 * Two falsy values are load-bearing and tested: `seed: 0` is a real
 * seed and `temperature: 0` is a real temperature, so every presence
 * check is "was anything typed", never truthiness of the parsed number.
 *
 * Validation is deliberately thin. The gateway is the authority on
 * ranges and names the field in its 400; predicting its verdict here
 * would be an eager refusal that can be wrong where the real failure
 * cannot. What IS checked is what cannot be serialized meaningfully:
 * text that is not a number, a fractional token count or seed, and more
 * than the four stop sequences the contract caps at.
 */

export interface SamplingDraft {
  /** Sent as a `system` message ahead of the conversation. */
  system: string;
  temperature: string;
  maxTokens: string;
  topP: string;
  seed: string;
  /** One sequence per line; the contract carries up to four. */
  stop: string;
}

export const EMPTY_SAMPLING: SamplingDraft = {
  system: "",
  temperature: "",
  maxTokens: "",
  topP: "",
  seed: "",
  stop: "",
};

/** The request-ready values. Absent key = not typed = omitted. */
export interface SamplingValues {
  system?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  seed?: number;
  stop?: string[];
}

/** A stored draft, tolerated from older builds: unknown keys dropped,
 * missing ones empty, anything not a string emptied. */
export function normalizeSamplingDraft(raw: unknown): SamplingDraft {
  const source = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const field = (key: keyof SamplingDraft): string =>
    typeof source[key] === "string" ? (source[key] as string) : "";
  return {
    system: field("system"),
    temperature: field("temperature"),
    maxTokens: field("maxTokens"),
    topP: field("topP"),
    seed: field("seed"),
    stop: field("stop"),
  };
}

function parseNumber(raw: string, label: string, integer: boolean): number | string {
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) return `${label} must be a number; "${raw.trim()}" is not.`;
  if (integer && !Number.isInteger(value)) {
    return `${label} must be a whole number; "${raw.trim()}" is not.`;
  }
  return value;
}

/**
 * Parse a draft into request values, or say why one field cannot be.
 *
 * The first problem wins: the panel shows one sentence and the operator
 * fixes one field, the way the tools panel already behaves.
 */
export function parseSampling(
  draft: SamplingDraft,
): { values: SamplingValues } | { error: string } {
  const values: SamplingValues = {};
  if (draft.system.trim() !== "") values.system = draft.system;
  if (draft.temperature.trim() !== "") {
    const v = parseNumber(draft.temperature, "Temperature", false);
    if (typeof v === "string") return { error: v };
    values.temperature = v;
  }
  if (draft.maxTokens.trim() !== "") {
    const v = parseNumber(draft.maxTokens, "Max tokens", true);
    if (typeof v === "string") return { error: v };
    values.maxTokens = v;
  }
  if (draft.topP.trim() !== "") {
    const v = parseNumber(draft.topP, "Top-p", false);
    if (typeof v === "string") return { error: v };
    values.topP = v;
  }
  if (draft.seed.trim() !== "") {
    const v = parseNumber(draft.seed, "Seed", true);
    if (typeof v === "string") return { error: v };
    values.seed = v;
  }
  const stop = draft.stop
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (stop.length > 4) {
    return { error: `Stop sequences: ${stop.length} given, and at most 4 are carried.` };
  }
  if (stop.length > 0) values.stop = stop;
  return { values };
}

/** How many fields would ride on the next request. Zero means the
 * request is byte-for-byte what it was before the panel existed. */
export function activeSamplingCount(draft: SamplingDraft): number {
  const parsed = parseSampling(draft);
  if ("error" in parsed) {
    // A field with a typo is still a field in play; the panel is not
    // silent about it, and neither is the chip.
    return 1;
  }
  return Object.keys(parsed.values).length;
}

/**
 * The conversation as it goes on the wire: the system prompt ahead of
 * the history, replacing any earlier one. The transcript the page
 * stores never contains it -- prepending into stored state would send
 * two system messages on the second turn.
 */
export function withSystemPrompt<T extends { role: string }>(
  messages: readonly T[],
  system: string | undefined,
  make: (content: string) => T,
): T[] {
  const rest = messages.filter((m) => m.role !== "system");
  if (system === undefined) return rest;
  return [make(system), ...rest];
}
