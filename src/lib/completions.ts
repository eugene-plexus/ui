/**
 * The playground's send path: the gateway's OpenAI-compatible surface.
 *
 * Replaces the afferent-event injection of the continuous-loop era.
 * There is no house chat endpoint any more — the playground talks to the
 * gateway exactly the way a third-party OpenAI SDK would, which is the
 * point: if the playground needs a private path to work, the compatible
 * endpoint isn't compatible.
 *
 * **Two transports, one request.** Through the agent's same-origin proxy
 * (the default, the path every other page takes), or **direct**: the
 * browser itself dials the gateway's base URL with a bearer, no proxy,
 * no session handling — the path OpenCode or the OpenAI SDK takes. The
 * request body is built once by `buildChatRequest` and the transport is
 * the *only* thing that differs, so "works direct, fails via proxy" is
 * a statement about the path and not about what was sent. See
 * `specs/docs/design/playground-diagnostic.md` §2.
 *
 * snake_case field names throughout, deliberately. See the note in
 * `lib/types.ts`.
 */

import { ApiError, api, postStream, problemMessage } from "./api";
import { normalizeBaseUrl } from "./diagnostic";
import { joinBase64 } from "./mediaAttachments";
import { requestMessages } from "./playgroundTranscript";
import type {
  ChatCompletionChunk,
  ChatCompletionMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  CompletionRoutingInfo,
  CompletionUsage,
  ModelList,
  ResponseFormat,
  StreamProgress,
  Tool,
  ToolCall,
  ToolCallDelta,
  ToolChoice,
} from "./types";

// --- transports -------------------------------------------------------

export type Transport =
  | { kind: "proxy" }
  | {
      kind: "direct";
      /** Scheme, host and port; `/v1` tolerated and stripped. */
      baseUrl: string;
      /** The bearer, sent verbatim. Today this is the operator's session
       * token; the panel says so and says its lifetime. */
      key: string;
    };

export const PROXY: Transport = { kind: "proxy" };

const PROXY_PATH_PREFIX = "/api/proxy/gateway";

/** The URL a transport dials for a gateway path. Exposed so the report
 * can say what was dialled without re-deriving it differently. */
export function urlFor(transport: Transport, path: string): string {
  if (transport.kind === "proxy") return `${PROXY_PATH_PREFIX}${path}`;
  return `${normalizeBaseUrl(transport.baseUrl)}${path}`;
}

/** A network-level failure in direct mode. The browser's own message is
 * kept — it is all the evidence there is — and the URL is attached so
 * the report can name what was dialled. */
export class DirectFetchError extends Error {
  constructor(
    public readonly url: string,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "DirectFetchError";
  }
}

async function directFetch(
  transport: Extract<Transport, { kind: "direct" }>,
  path: string,
  init: { method: "GET" | "POST"; body?: string; accept: string; signal?: AbortSignal },
): Promise<Response> {
  const url = urlFor(transport, path);
  const headers: Record<string, string> = {
    authorization: `Bearer ${transport.key}`,
    accept: init.accept,
  };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  let response: Response;
  try {
    // Plain `fetch`, on purpose: no `lib/api.ts`, no session, no 401
    // redirect. This is the harness's path and must have nothing of ours
    // on it.
    response = await fetch(url, {
      method: init.method,
      headers,
      body: init.body,
      signal: init.signal,
    });
  } catch (e) {
    throw new DirectFetchError(url, e);
  }
  if (!response.ok) {
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // keep the raw text
    }
    throw new ApiError(response.status, response.statusText, parsed);
  }
  return response;
}

/** What the gateway will route to right now, derived from topology. */
export async function listModels(transport: Transport = PROXY): Promise<ModelList> {
  if (transport.kind === "proxy") return api.get<ModelList>("gateway", "/v1/models");
  const response = await directFetch(transport, "/v1/models", {
    method: "GET",
    accept: "application/json",
  });
  return (await response.json()) as ModelList;
}

// --- the request ------------------------------------------------------

export interface CompletionOptions {
  model: string;
  messages: ChatCompletionMessage[];
  /** Omitted rather than defaulted here: the gateway owns every
   * output-affecting parameter and fills unset ones from the install
   * defaults. A local default in the UI would silently override that. */
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  /** `0` is a real seed, so presence is `!= null` -- a truthiness check
   * here would drop exactly the value most people type first. */
  seed?: number;
  /** Up to four sequences; the contract forwards them as an array. */
  stop?: string[];
  /** Tool definitions, passed through exactly as a harness would send
   * them. The gateway never executes tools and neither does this client. */
  tools?: Tool[];
  toolChoice?: ToolChoice;
  responseFormat?: ResponseFormat;
  /** The playground's own ceiling, not the model's. A wedged backend
   * should surface as an error, not a spinner that never resolves. */
  timeoutMs?: number;
  /** Cancels both waiting for headers and reading the answer. */
  signal?: AbortSignal;
  /** Which path to the gateway. Default: the agent's proxy. */
  transport?: Transport;
  /** Where a harness would find the gateway, for the report's `curl`
   * line when the transport was the proxy (whose URL is not a gateway
   * URL). Null when unknown. */
  reproduceBaseUrl?: string | null;
  /** Called exactly once per request, success or failure, with what
   * happened on the wire. */
  onReport?: (report: RequestReport) => void;
  /** Called as tool-call fragments accumulate, with the calls so far. */
  onToolCalls?: (calls: ToolCall[]) => void;
  /** Called with each fragment of the model's reasoning, which a reasoning
   * model sends before its answer (`delta.reasoning_content`). Before
   * 2026-09-27 it was read past, so a model that thought for a minute
   * showed nothing for that minute. */
  onReasoning?: (delta: string) => void;
  /** Called with what the backend says it is doing while it sends no
   * output. Given, the request asks for it
   * (`stream_options.include_progress`); a stream never carries it
   * unasked. */
  onProgress?: (progress: StreamProgress) => void;
  /** Ask for a spoken reply (P2b): `modalities: ["text", "audio"]` with
   * this voice. A streamed request can only take `pcm16`, so that is the
   * format asked; `wav` is for a request that is not streamed. */
  audio?: { voice: string };
  /** Ask for a web search before the answer (P8): `web_search_options`.
   * This install runs it on its search account when the model does not
   * search itself, and the sources come back as `annotations`. */
  webSearch?: boolean;
}

/**
 * The request body, built once for both transports and both modes.
 *
 * Tools ride only when given; `tool_choice` and `response_format` only
 * with them or when set explicitly, so a request with none of these is
 * byte-for-byte what the playground sent before any of this existed.
 */
export function buildChatRequest(opts: CompletionOptions, stream: boolean): ChatCompletionRequest {
  const body: ChatCompletionRequest = {
    model: opts.model,
    messages: requestMessages(opts.messages),
    stream,
  };
  if (opts.temperature != null) body.temperature = opts.temperature;
  if (opts.maxTokens != null) body.max_tokens = opts.maxTokens;
  if (opts.topP != null) body.top_p = opts.topP;
  if (opts.seed != null) body.seed = opts.seed;
  if (opts.stop != null && opts.stop.length > 0) body.stop = opts.stop;
  if (opts.tools && opts.tools.length > 0) body.tools = opts.tools;
  if (opts.toolChoice != null) body.tool_choice = opts.toolChoice;
  if (opts.responseFormat != null) body.response_format = opts.responseFormat;
  // Only when something will read it: a progress chunk has no choices,
  // and the body the report shows should be what this caller needs.
  if (stream && opts.onProgress) body.stream_options = { include_progress: true };
  if (opts.audio) {
    body.modalities = ["text", "audio"];
    body.audio = { voice: opts.audio.voice, format: stream ? "pcm16" : "wav" };
  }
  if (opts.webSearch) body.web_search_options = {};
  return body;
}

// --- the report -------------------------------------------------------

/**
 * What one request did on the wire, from the browser's side.
 *
 * The other half of the bisection: the routing envelope says what the
 * control plane did with a request, and this says what the client saw —
 * which URL, which status, how long to the first frame, how many frames.
 * Both halves together are what a bug report needs.
 */
export interface RequestReport {
  mode: "proxy" | "direct";
  /** What was dialled. In proxy mode a same-origin path. */
  url: string;
  /** The gateway URL a harness would dial for the same request, for the
   * `curl` line. Equal to `url` in direct mode; null when unknown. */
  reproduceUrl: string | null;
  method: "POST";
  /** The JSON exactly as sent. */
  body: string;
  status: number | null;
  /** The thrown error's message when the request failed without a
   * usable response, or the stream's error frame when it failed after. */
  error: string | null;
  elapsedMs: number | null;
  /** From send to the first parsed `data:` frame of output — a clock,
   * because a frame count cannot tell a streaming path from a buffering
   * one. Progress frames are not output and do not stop it: a prompt
   * read on the processor would otherwise make every first frame look
   * instant, and the rate the page works out from it wrong. */
  firstFrameMs: number | null;
  frames: number;
  contentDeltas: number;
  reasoningDeltas: number;
  toolCallDeltas: number;
  /** Progress chunks, counted apart from `frames`. */
  progressFrames: number;
  finishReason: string | null;
  model: string | null;
  usage?: CompletionUsage;
  routing?: CompletionRoutingInfo;
  streamed: boolean;
  truncatedBy: string | null;
  at: string;
}

function newReport(
  opts: CompletionOptions,
  transport: Transport,
  body: string,
  streamed: boolean,
): RequestReport {
  const url = urlFor(transport, "/v1/chat/completions");
  const reproduceUrl =
    transport.kind === "direct"
      ? url
      : opts.reproduceBaseUrl
        ? `${normalizeBaseUrl(opts.reproduceBaseUrl)}/v1/chat/completions`
        : null;
  return {
    mode: transport.kind,
    url,
    reproduceUrl,
    method: "POST",
    body,
    status: null,
    error: null,
    elapsedMs: null,
    firstFrameMs: null,
    frames: 0,
    contentDeltas: 0,
    reasoningDeltas: 0,
    toolCallDeltas: 0,
    progressFrames: 0,
    finishReason: null,
    model: null,
    streamed,
    truncatedBy: null,
    at: new Date().toISOString(),
  };
}

function recordFailure(report: RequestReport, e: unknown): void {
  if (e instanceof ApiError) {
    report.status = e.status === 0 ? null : e.status;
    report.error = problemMessage(e.body) ?? `${e.status} ${e.statusText}`;
  } else {
    report.error = e instanceof Error ? e.message : String(e);
  }
}

// --- tool-call accumulation -------------------------------------------

/**
 * Fold streamed tool-call fragments into calls, by `index`.
 *
 * The contract: `id` and `function.name` arrive once, `function.arguments`
 * arrives as a string split across any number of frames, and no single
 * frame is parseable JSON. Step 6 found that local engines emit the
 * whole call in one fragment while OpenAI proper splits `arguments`
 * mid-token, so a client has to handle both — the tests do. Losing the
 * index would merge two calls into a third that was never made.
 */
export function accumulateToolCallDeltas(
  calls: ReadonlyArray<ToolCall>,
  deltas: ReadonlyArray<ToolCallDelta>,
): ToolCall[] {
  const next: ToolCall[] = calls.map((c) => ({ ...c, function: { ...c.function } }));
  for (const d of deltas) {
    const index = d.index ?? 0;
    while (next.length <= index) {
      next.push({ id: "", type: "function", function: { name: "", arguments: "" } });
    }
    const call = next[index];
    if (call === undefined) continue; // unreachable after the fill above
    if (d.id) call.id = d.id;
    if (d.function?.name) call.function.name += d.function.name;
    if (d.function?.arguments) call.function.arguments += d.function.arguments;
  }
  return next;
}

// --- one-shot ---------------------------------------------------------

export async function createChatCompletion(
  opts: CompletionOptions,
): Promise<ChatCompletionResponse> {
  const transport = opts.transport ?? PROXY;
  // Non-streaming on purpose: this is the one-shot call, kept for
  // callers that want the finished object and nothing else. The
  // playground uses `streamChatCompletion` below.
  const body = buildChatRequest(opts, false);
  const serialized = JSON.stringify(body);
  const report = newReport(opts, transport, serialized, false);
  const started = performance.now();
  try {
    let response: ChatCompletionResponse;
    if (transport.kind === "proxy") {
      response = await api.post<ChatCompletionResponse>("gateway", "/v1/chat/completions", body, {
        timeoutMs: opts.timeoutMs,
      });
    } else {
      const raw = await directFetch(transport, "/v1/chat/completions", {
        method: "POST",
        body: serialized,
        accept: "application/json",
      });
      response = (await raw.json()) as ChatCompletionResponse;
    }
    report.status = 200;
    report.model = response.model ?? null;
    report.usage = response.usage;
    report.routing = response.x_eugene_plexus;
    report.finishReason = response.choices?.[0]?.finish_reason ?? null;
    return response;
  } catch (e) {
    recordFailure(report, e);
    throw e;
  } finally {
    report.elapsedMs = Math.round(performance.now() - started);
    opts.onReport?.(report);
  }
}

// --- streaming --------------------------------------------------------

/**
 * The same completion, delivered as it is generated.
 *
 * `createChatCompletion` above sets `stream: false` and returns one
 * object. This sets `stream: true`, calls `onToken` for each content
 * delta, and resolves with the assembled response so callers that want
 * the usage numbers and the routing extension still get them.
 *
 * The frames are OpenAI's `ChatCompletionChunk`s: `data:` lines
 * terminated by a literal `data: [DONE]`. Four things this has to get
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
 *   * **A delta can carry `tool_calls` instead of `content`.** The first
 *     version of this function read `delta.content` and nothing else,
 *     so a streamed tool-call-only turn -- the step 6 headline -- came
 *     out as an empty assistant message that looked exactly like "the
 *     model chose not to call anything". Fragments are accumulated by
 *     index now and returned on the message.
 */
export type StreamedCompletion = ChatCompletionResponse & {
  truncatedBy?: string;
  report: RequestReport;
  /** The model's reasoning for this turn, as it streamed; "" when none. */
  reasoning: string;
  /** A spoken reply's audio, its fragments joined, and what the bytes
   * are. Its words arrived as `transcript` and are the message's
   * `content`, which is what a replay sends back. */
  spoken?: { format: string; data: string };
};

export async function streamChatCompletion(
  opts: CompletionOptions,
  onToken: (delta: string) => void,
): Promise<StreamedCompletion> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  opts.signal?.addEventListener("abort", cancel, { once: true });
  if (opts.signal?.aborted) cancel();
  let timedOut = false;
  const timer =
    opts.timeoutMs && opts.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, opts.timeoutMs)
      : undefined;
  try {
    return await readChatCompletion({ ...opts, signal: controller.signal }, onToken);
  } catch (error) {
    if (timedOut) throw new Error("The answer took too long. Check the model and try again.");
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    opts.signal?.removeEventListener("abort", cancel);
  }
}

async function readChatCompletion(
  opts: CompletionOptions,
  onToken: (delta: string) => void,
): Promise<StreamedCompletion> {
  const transport = opts.transport ?? PROXY;
  const body = buildChatRequest(opts, true);
  const serialized = JSON.stringify(body);
  const report = newReport(opts, transport, serialized, true);
  const started = performance.now();

  let response: Response;
  try {
    response =
      transport.kind === "proxy"
        ? await postStream("gateway", "/v1/chat/completions", body, { signal: opts.signal })
        : await directFetch(transport, "/v1/chat/completions", {
            method: "POST",
            body: serialized,
            accept: "text/event-stream",
            signal: opts.signal,
          });
  } catch (e) {
    recordFailure(report, e);
    report.elapsedMs = Math.round(performance.now() - started);
    opts.onReport?.(report);
    throw e;
  }
  report.status = response.status;
  if (!response.body) {
    report.error = "the gateway returned no stream body";
    report.elapsedMs = Math.round(performance.now() - started);
    opts.onReport?.(report);
    throw new Error(report.error);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let content = "";
  let reasoning = "";
  let toolCalls: ToolCall[] = [];
  let finishReason: string | null = null;
  let model = opts.model;
  let usage: ChatCompletionResponse["usage"];
  let routing: ChatCompletionResponse["x_eugene_plexus"];
  let streamError: string | null = null;
  const audioFragments: string[] = [];
  let audioFormat: string | null = null;
  // Sources, as the stream delivers them just before the end (P8, P2c).
  const annotations: NonNullable<ChatCompletionMessage["annotations"]> = [];

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

        // What the backend is doing, not output: no choices, and an
        // `x_eugene_plexus` with nothing but `progress` in it -- which
        // must not be mistaken for the routing envelope the final frame
        // carries.
        const progress = (parsed as { x_eugene_plexus?: { progress?: StreamProgress } })
          .x_eugene_plexus?.progress;
        const noChoices =
          Array.isArray((parsed as { choices?: unknown }).choices) &&
          (parsed as { choices: unknown[] }).choices.length === 0;
        if (progress && noChoices) {
          report.progressFrames += 1;
          opts.onProgress?.(progress);
          continue;
        }

        if (report.firstFrameMs === null) {
          report.firstFrameMs = Math.round(performance.now() - started);
        }
        report.frames += 1;

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
        const thought = choice.delta?.reasoning_content;
        if (thought) {
          reasoning += thought;
          report.reasoningDeltas += 1;
          opts.onReasoning?.(thought);
        }
        const delta = choice.delta?.content;
        if (delta) {
          content += delta;
          report.contentDeltas += 1;
          onToken(delta);
        }
        // A spoken reply: base64 audio fragments, and its words as
        // `transcript` rather than `content`. The words stream into the
        // bubble like any answer and become the message's content, which
        // is what the contract says to send back in place of the audio.
        const audio = choice.delta?.audio;
        if (audio) {
          if (audio.format) audioFormat = audio.format;
          if (audio.data) audioFragments.push(audio.data);
          if (audio.transcript) {
            content += audio.transcript;
            report.contentDeltas += 1;
            onToken(audio.transcript);
          }
        }
        const cited = choice.delta?.annotations;
        if (cited && cited.length > 0) annotations.push(...cited);
        const fragments = choice.delta?.tool_calls;
        if (fragments && fragments.length > 0) {
          report.toolCallDeltas += 1;
          toolCalls = accumulateToolCallDeltas(toolCalls, fragments);
          opts.onToolCalls?.(toolCalls);
        }
      }
    }
  } finally {
    // Releases the lock whether we finished, threw, or the caller
    // abandoned us -- without it a component unmounting mid-answer
    // leaves the response open.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    report.elapsedMs = Math.round(performance.now() - started);
    report.finishReason = finishReason;
    report.model = model;
    report.usage = usage;
    report.routing = routing;
    report.truncatedBy = streamError;
    if (streamError && !content && toolCalls.length === 0) report.error = streamError;
    opts.onReport?.(report);
  }

  // A turn that only thought is still a turn: the thinking is on screen
  // and the page says no answer came. Throwing here would take it away.
  if (streamError && !content && toolCalls.length === 0 && !reasoning) {
    // Nothing was delivered, so this is an ordinary failure and should
    // read like one rather than as an empty assistant message.
    throw new Error(streamError);
  }

  // `content` is null on a tool-call-only turn, as the wire has it: a
  // harness replays this message verbatim and the contract says null,
  // not "", is what accompanies `tool_calls`.
  const message: ChatCompletionMessage = {
    role: "assistant",
    content: content || (toolCalls.length > 0 ? null : ""),
  };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  if (annotations.length > 0) message.annotations = annotations;

  return {
    id: "streamed",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: (finishReason ?? "stop") as "stop" | "length" | "tool_calls",
      },
    ],
    usage,
    x_eugene_plexus: routing,
    // Surfaced rather than swallowed: the answer above is real but
    // incomplete, and a caller that shows it without saying so is
    // presenting a truncated answer as a finished one.
    truncatedBy: streamError ?? undefined,
    report,
    reasoning,
    ...(audioFragments.length > 0
      ? { spoken: { format: audioFormat ?? "pcm16", data: joinBase64(audioFragments) } }
      : {}),
  };
}

/**
 * Pull a human-readable message out of whatever the gateway returned.
 *
 * Kept as a name because the playground reads best with it, but the
 * unwrapping lives in `api.ts` now and is shared. This version handled
 * `{detail: <string>}` and NOT `{detail: {detail}}` — which is the
 * shape FastAPI actually produces, and so the shape of every `Problem`
 * the proxy has ever returned. It named that case in its own docstring
 * and then missed it, so a proxy failure reached the playground as
 * `HTTP 503 Service Unavailable` with the reason discarded.
 */
export const errorMessage = problemMessage;
