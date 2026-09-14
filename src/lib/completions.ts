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
import type {
  ChatCompletionChunk,
  ChatCompletionMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  CompletionRoutingInfo,
  CompletionUsage,
  ModelList,
  ResponseFormat,
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
  init: { method: "GET" | "POST"; body?: string; accept: string },
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
    response = await fetch(url, { method: init.method, headers, body: init.body });
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
  /** Tool definitions, passed through exactly as a harness would send
   * them. The gateway never executes tools and neither does this client. */
  tools?: Tool[];
  toolChoice?: ToolChoice;
  responseFormat?: ResponseFormat;
  /** The playground's own ceiling, not the model's. A wedged backend
   * should surface as an error, not a spinner that never resolves. */
  timeoutMs?: number;
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
}

/**
 * The request body, built once for both transports and both modes.
 *
 * Tools ride only when given; `tool_choice` and `response_format` only
 * with them or when set explicitly, so a request with none of these is
 * byte-for-byte what the playground sent before any of this existed.
 */
export function buildChatRequest(opts: CompletionOptions, stream: boolean): ChatCompletionRequest {
  const body: ChatCompletionRequest = { model: opts.model, messages: opts.messages, stream };
  if (opts.temperature != null) body.temperature = opts.temperature;
  if (opts.maxTokens != null) body.max_tokens = opts.maxTokens;
  if (opts.tools && opts.tools.length > 0) body.tools = opts.tools;
  if (opts.toolChoice != null) body.tool_choice = opts.toolChoice;
  if (opts.responseFormat != null) body.response_format = opts.responseFormat;
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
  /** From send to the first parsed `data:` frame — a clock, because a
   * frame count cannot tell a streaming path from a buffering one. */
  firstFrameMs: number | null;
  frames: number;
  contentDeltas: number;
  toolCallDeltas: number;
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
    toolCallDeltas: 0,
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
export async function streamChatCompletion(
  opts: CompletionOptions,
  onToken: (delta: string) => void,
): Promise<ChatCompletionResponse & { truncatedBy?: string; report: RequestReport }> {
  const transport = opts.transport ?? PROXY;
  const body = buildChatRequest(opts, true);
  const serialized = JSON.stringify(body);
  const report = newReport(opts, transport, serialized, true);
  const started = performance.now();

  let response: Response;
  try {
    response =
      transport.kind === "proxy"
        ? await postStream("gateway", "/v1/chat/completions", body)
        : await directFetch(transport, "/v1/chat/completions", {
            method: "POST",
            body: serialized,
            accept: "text/event-stream",
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
  let toolCalls: ToolCall[] = [];
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
        if (report.firstFrameMs === null) {
          report.firstFrameMs = Math.round(performance.now() - started);
        }
        report.frames += 1;

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
          report.contentDeltas += 1;
          onToken(delta);
        }
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

  if (streamError && !content && toolCalls.length === 0) {
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
