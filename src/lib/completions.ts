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

import { api, postStream } from "./api";
import type {
  ChatCompletionChunk,
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
    // Non-streaming on purpose: this is the one-shot call, kept for
    // callers that want the finished object and nothing else. The
    // playground uses `streamChatCompletion` below. From M0 to M9 there
    // was no difference between them -- the gateway framed SSE around a
    // single content chunk, because the driver's stream endpoint was a
    // 501 stub -- which is why this comment used to say streaming had
    // nothing to offer. It does now.
    stream: false,
  };
  if (opts.temperature != null) body.temperature = opts.temperature;
  if (opts.maxTokens != null) body.max_tokens = opts.maxTokens;

  return api.post<ChatCompletionResponse>("gateway", "/v1/chat/completions", body, {
    timeoutMs: opts.timeoutMs,
  });
}

/**
 * The same completion, delivered as it is generated.
 *
 * `createChatCompletion` above sets `stream: false` and returns one
 * object. This sets `stream: true`, calls `onToken` for each content
 * delta, and resolves with the assembled response so callers that want
 * the usage numbers and the routing extension still get them.
 *
 * The frames are OpenAI's `ChatCompletionChunk`s: `data:` lines
 * terminated by a literal `data: [DONE]`. Three things this has to get
 * right that a first draft usually does not:
 *
 *   * **A frame can be split across reads.** The network decides where
 *     a chunk ends, not the sender, so partial lines are buffered until
 *     a blank line completes the frame.
 *   * **An error can arrive after a 200.** Past the first token the
 *     gateway cannot fail over (see `gateway.yaml`), so a truncated
 *     answer is reported as an `{error: ...}` frame mid-stream. The
 *     tokens already delivered are kept -- discarding what the user has
 *     already read would be worse than truncating.
 *   * **`x_eugene_plexus` rides the final frame**, beside `usage`,
 *     which is the earliest point either is known.
 */
export async function streamChatCompletion(
  opts: CompletionOptions,
  onToken: (delta: string) => void,
): Promise<ChatCompletionResponse> {
  const body: ChatCompletionRequest = {
    model: opts.model,
    messages: opts.messages,
    stream: true,
  };
  if (opts.temperature != null) body.temperature = opts.temperature;
  if (opts.maxTokens != null) body.max_tokens = opts.maxTokens;

  const response = await postStream("gateway", "/v1/chat/completions", body);
  if (!response.body) {
    throw new Error("the gateway returned no stream body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let content = "";
  let finishReason: string | null = null;
  let model = opts.model;
  let usage: ChatCompletionResponse["usage"];
  let routing: ChatCompletionResponse["x_eugene_plexus"];
  let streamError: string | null = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });

      // Frames are separated by a blank line. Keep the trailing
      // fragment: it is the half of a frame the next read completes.
      const frames = buffered.split("\n\n");
      buffered = frames.pop() ?? "";

      for (const frame of frames) {
        const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(payload) as Record<string, unknown>;
        } catch {
          continue;
        }

        if (parsed.error) {
          const err = parsed.error as { message?: string };
          streamError = err.message ?? "the stream failed";
          continue;
        }

        const chunk = parsed as unknown as ChatCompletionChunk;
        if (chunk.model) model = chunk.model;
        if (chunk.usage) usage = chunk.usage;
        if (chunk.x_eugene_plexus) routing = chunk.x_eugene_plexus;

        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = choice.delta?.content;
        if (delta) {
          content += delta;
          onToken(delta);
        }
      }
    }
  } finally {
    // Releases the lock whether we finished, threw, or the caller
    // abandoned us -- without it a component unmounting mid-answer
    // leaves the response open.
    reader.releaseLock();
  }

  if (streamError && !content) {
    // Nothing was delivered, so this is an ordinary failure and should
    // read like one rather than as an empty assistant message.
    throw new Error(streamError);
  }

  return {
    id: "streamed",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: finishReason ?? "stop",
      },
    ],
    usage,
    x_eugene_plexus: routing,
    // Surfaced rather than swallowed: the answer above is real but
    // incomplete, and a caller that shows it without saying so is
    // presenting a truncated answer as a finished one.
    truncatedBy: streamError ?? undefined,
  } as ChatCompletionResponse & { truncatedBy?: string };
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
