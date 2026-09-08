/**
 * The playground's send path: the gateway's OpenAI-compatible surface.
 *
 * Replaces the afferent-event injection of the continuous-loop era.
 * There is no house chat endpoint any more — the playground talks to the
 * gateway exactly the way a third-party OpenAI SDK would, which is the
 * point: if the playground needs a private path to work, the compatible
 * endpoint isn't compatible.
 *
 * snake_case field names throughout, deliberately. See the note in
 * `lib/types.ts`.
 */

import { api } from "./api";
import type {
  ChatCompletionMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelList,
} from "./types";

/** What the gateway will route to right now, derived from topology. */
export async function listModels(): Promise<ModelList> {
  return api.get<ModelList>("gateway", "/v1/models");
}

export interface CompletionOptions {
  model: string;
  messages: ChatCompletionMessage[];
  /** Omitted rather than defaulted here: the gateway owns every
   * output-affecting parameter and fills unset ones from the install
   * defaults. A local default in the UI would silently override that. */
  temperature?: number;
  maxTokens?: number;
  /** The playground's own ceiling, not the model's. A wedged backend
   * should surface as an error, not a spinner that never resolves. */
  timeoutMs?: number;
}

export async function createChatCompletion(
  opts: CompletionOptions,
): Promise<ChatCompletionResponse> {
  const body: ChatCompletionRequest = {
    model: opts.model,
    messages: opts.messages,
    // M0 ships correct OpenAI framing with a single content chunk rather
    // than token-by-token pass-through, so there is nothing for the
    // playground to gain by streaming: it would render the same text at
    // the same moment. Real pass-through needs the driver's SSE plumbed
    // through the failover cascade; when that lands, flip this and read
    // ChatCompletionChunk frames.
    stream: false,
  };
  if (opts.temperature != null) body.temperature = opts.temperature;
  if (opts.maxTokens != null) body.max_tokens = opts.maxTokens;

  return api.post<ChatCompletionResponse>("gateway", "/v1/chat/completions", body, {
    timeoutMs: opts.timeoutMs,
  });
}

/**
 * Pull a human-readable message out of whatever the gateway returned.
 *
 * Two envelopes are possible and the difference matters when debugging:
 * `/v1/chat/completions` answers with OpenAI's `{error: {message}}` so
 * SDKs can build their exception types, while every other endpoint —
 * including the proxy itself when it can't resolve a target — answers
 * with RFC 7807 `{detail}` or `{error}`.
 */
export function errorMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const rec = body as Record<string, unknown>;
  const openai = rec.error;
  if (typeof openai === "object" && openai !== null) {
    const message = (openai as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  if (typeof openai === "string") return openai;
  if (typeof rec.detail === "string") return rec.detail;
  if (typeof rec.title === "string") return rec.title;
  return null;
}
