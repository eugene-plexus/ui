/**
 * The completions door (`POST /v1/completions`, P6b): the request a form
 * builds, and the answer read back, streamed or not.
 *
 * Diagnostic depth (`playground-doors.md` §2): one prompt, one answer,
 * what served it. The suffix box is always offered; a model whose
 * listing says it does not fill in the middle gets a warning before Send
 * and the request goes as typed, because the gateway's refusal is the
 * diagnostic and a quietly dropped suffix would be a different request.
 */

import type { DoorReport } from "./doorRequest";
import { sseEvents } from "./sse";

export interface CompletionDraft {
  prompt: string;
  suffix: string;
  /** Raw text; empty means not sent. */
  maxTokens: string;
  temperature: string;
  stream: boolean;
}

export const EMPTY_COMPLETION_DRAFT: CompletionDraft = {
  prompt: "def add(a, b):\n    return",
  suffix: "",
  maxTokens: "32",
  temperature: "",
  stream: true,
};

export type CompletionBody = {
  model: string;
  prompt: string;
  suffix?: string;
  max_tokens?: number;
  temperature?: number;
  stream: boolean;
  stream_options?: { include_usage: boolean };
};

/** The request body, or a sentence naming the field that cannot be sent. */
export function buildCompletionBody(
  model: string,
  draft: CompletionDraft,
): { body: CompletionBody } | { error: string } {
  if (!draft.prompt) return { error: "Type a prompt to continue." };
  const body: CompletionBody = { model, prompt: draft.prompt, stream: draft.stream };
  if (draft.suffix) body.suffix = draft.suffix;
  if (draft.maxTokens.trim()) {
    const n = Number(draft.maxTokens);
    if (!Number.isInteger(n) || n < 1)
      return { error: "Max tokens must be a whole number above 0." };
    body.max_tokens = n;
  }
  if (draft.temperature.trim()) {
    const t = Number(draft.temperature);
    if (!Number.isFinite(t) || t < 0 || t > 2)
      return { error: "Temperature must be between 0 and 2." };
    body.temperature = t;
  }
  if (draft.stream) body.stream_options = { include_usage: true };
  return { body };
}

export interface CompletionAnswer {
  text: string;
  finishReason: string | null;
  model: string | null;
  usage: { prompt_tokens?: number; completion_tokens?: number } | null;
  routing: Record<string, unknown> | null;
  /** Set when a stream ended early: the gateway's error frame, or a
   * stream that closed without `[DONE]`. What arrived is kept. */
  truncatedBy: string | null;
}

interface CompletionObject {
  model?: string;
  choices?: Array<{ text?: string; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  x_eugene_plexus?: Record<string, unknown>;
  error?: { message?: string };
}

/** A finished, non-streamed answer. */
export function answerFromBody(body: CompletionObject): CompletionAnswer {
  const choice = body.choices?.[0];
  return {
    text: choice?.text ?? "",
    finishReason: choice?.finish_reason ?? null,
    model: body.model ?? null,
    usage: body.usage ?? null,
    routing: body.x_eugene_plexus ?? null,
    truncatedBy: null,
  };
}

/**
 * Read a streamed answer, calling `onText` with each piece. The first
 * byte of output is stamped on the report. A stream that stops without
 * `[DONE]` is cut short, never a short answer presented as whole.
 */
export async function readCompletionStream(
  response: Response,
  report: DoorReport,
  started: number,
  onText: (piece: string) => void,
): Promise<CompletionAnswer> {
  const answer: CompletionAnswer = {
    text: "",
    finishReason: null,
    model: null,
    usage: null,
    routing: null,
    truncatedBy: null,
  };
  let finished = false;
  for await (const { data } of sseEvents(response)) {
    if (data === "[DONE]") {
      finished = true;
      break;
    }
    let frame: CompletionObject;
    try {
      frame = JSON.parse(data) as CompletionObject;
    } catch {
      continue;
    }
    if (frame.error) {
      answer.truncatedBy = frame.error.message ?? "the stream failed";
      continue;
    }
    if (report.firstByteMs === null) report.firstByteMs = Math.round(performance.now() - started);
    if (frame.model) answer.model = frame.model;
    if (frame.usage) answer.usage = frame.usage;
    if (frame.x_eugene_plexus) answer.routing = frame.x_eugene_plexus;
    const choice = frame.choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) answer.finishReason = choice.finish_reason;
    if (choice.text) {
      answer.text += choice.text;
      onText(choice.text);
    }
  }
  if (!finished && answer.truncatedBy === null) {
    answer.truncatedBy = "the stream closed before it finished";
  }
  return answer;
}

/** The warning shown before Send, or null. Only an explicit `false`
 * warns: an absent flag is a gateway with no opinion. */
export function suffixWarning(suffix: string, fillsInMiddle: boolean | undefined): string | null {
  if (!suffix || fillsInMiddle !== false) return null;
  return (
    "This model cannot fill in the middle. The gateway will refuse the suffix rather than " +
    "drop it. Clear the suffix to continue the prompt only."
  );
}
