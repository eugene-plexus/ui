"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ChatInput } from "@/components/ChatInput";
import { ChatLog, type ToolResult } from "@/components/ChatLog";
import { ConfirmButton } from "@/components/ConfirmButton";
import { CopyButton } from "@/components/CopyButton";
import { DecisionPanel } from "@/components/DecisionPanel";
import { DiagnosticPanel, type GatewayMode } from "@/components/DiagnosticPanel";
import { RequestReport } from "@/components/RequestReport";
import { SamplingPanel } from "@/components/SamplingPanel";
import { SetupGateScreen } from "@/components/SetupGateScreen";
import { EXAMPLE_TOOLS_TEXT, type ResponseFormatChoice, ToolsPanel } from "@/components/ToolsPanel";
import { ApiError, api } from "@/lib/api";
import {
  PROXY,
  type RequestReport as Report,
  type Transport,
  errorMessage,
  listModels,
  streamChatCompletion,
} from "@/lib/completions";
import {
  type PageLocation,
  displayBaseUrl,
  guessGatewayBaseUrl,
  normalizeBaseUrl,
  parseToolDefinitions,
} from "@/lib/diagnostic";
import {
  type PlaygroundMessage,
  readPlaygroundTranscript,
  requestMessages,
  writePlaygroundTranscript,
} from "@/lib/playgroundTranscript";
import {
  EMPTY_SAMPLING,
  type SamplingDraft,
  activeSamplingCount,
  normalizeSamplingDraft,
  parseSampling,
  withSystemPrompt,
} from "@/lib/sampling";
import { getSessionToken } from "@/lib/session";
import { seconds, tokenCount } from "@/lib/turnFormat";
import { usePolling } from "@/lib/usePolling";
import type {
  ChatCompletionMessage,
  ComponentList,
  CompletionRoutingInfo,
  MessageContentPart,
  Model,
  ToolChoice,
} from "@/lib/types";
import { useSetupGate } from "@/lib/useSetupGate";

/**
 * The playground: a reference client and a diagnostic.
 *
 * At `/playground` since S1 of the hobbyist UX plan; `/` is Home, whose
 * "Try it" card is this composer's first line, wired to the same
 * `streamChatCompletion` and the same stored transcript. The diagnostic
 * panel, the tools panel and the request report stay here — a person who
 * opens this page is asking *why*, and Home's card is for *whether*.
 */

const DIAGNOSTIC_KEY = "eugene-playground-diagnostic";
const TOOLS_KEY = "eugene-playground-tools";
const SAMPLING_KEY = "eugene-playground-sampling";

// Generation on a large local quant is slow but not unbounded. Past
// this, something is wedged and the operator wants an error rather than
// a spinner.
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

/** New's look, shared by the asking button and the disabled one, so the
 * control does not change shape when a conversation starts. */
const NEW_BUTTON_CLASS =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";

/** What survives a reload of the diagnostic panel. Never the key: it
 * defaults to the session token on every load, and a typed one lives
 * for the tab. */
interface PersistedDiagnostic {
  mode?: GatewayMode;
  baseUrl?: string;
  open?: boolean;
}

interface PersistedTools {
  enabled?: boolean;
  definitions?: string;
}

/** What actually served the last turn, straight off the response's
 * `x_eugene_plexus` extension. The failure mode of a routing layer is
 * opacity — `attempts > 1` is the visible evidence failover fired. */
interface TurnInfo extends CompletionRoutingInfo {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  /** `length` and `content_filter` change what the text above means,
   * so the bar badges them; `stop` and `tool_calls` are the quiet
   * normal cases. */
  finishReason?: string | null;
  /** From the client's own clock: send to first parsed frame. */
  firstFrameMs?: number | null;
  /** From the client's own clock: send to the end of the answer --
   * the report's `total`, so the two can never disagree. */
  elapsedMs?: number | null;
  /** Completion tokens over the time after the first frame — an
   * approximate decode rate measured where the person sits, not the
   * backend's own number. Null when the window is too small to mean
   * anything. */
  tokPerSec?: number | null;
}

/** The decode rate as this browser saw it. Below two tokens or a
 * quarter second of decode the division is noise, so it is withheld
 * rather than rendered as a confident wrong number. */
function clientTokPerSec(
  completionTokens: number | undefined,
  elapsedMs: number | null,
  firstFrameMs: number | null,
): number | null {
  if (completionTokens == null || elapsedMs == null || firstFrameMs == null) return null;
  const windowMs = elapsedMs - firstFrameMs;
  if (completionTokens < 2 || windowMs < 250) return null;
  return completionTokens / (windowMs / 1000);
}

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / quota; the panel just does not remember.
  }
}

function pageLocation(): PageLocation {
  if (typeof window === "undefined") return { protocol: "http:", hostname: "127.0.0.1" };
  return { protocol: window.location.protocol, hostname: window.location.hostname };
}

export default function PlaygroundPage() {
  const [messages, setMessages] = useState<PlaygroundMessage[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [decisionModels, setDecisionModels] = useState<string[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [turnInfo, setTurnInfo] = useState<TurnInfo | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A deliberate stop is not a failure and must not read like one.
  const [notice, setNotice] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // First-run and sign-in, shared with Home so the two pages of the
  // install root cannot bounce differently.
  const { state: setupGate, retry: retrySetupGate } = useSetupGate();
  const [seed, setSeed] = useState<{ text: string; nonce: number } | undefined>(undefined);

  // The diagnostic: which path to the gateway, and what a harness would
  // be given. Restored from localStorage after mount, so the first render
  // matches the server's.
  const [panelsOpen, setPanelsOpen] = useState(false);
  const [mode, setMode] = useState<GatewayMode>("proxy");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [guess, setGuess] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  // Tools: what a harness sends that a chat box does not.
  const [toolsOn, setToolsOn] = useState(false);
  const [toolDefs, setToolDefs] = useState(EXAMPLE_TOOLS_TEXT);
  const [toolChoice, setToolChoice] = useState<ToolChoice>("auto");
  const [responseFormat, setResponseFormat] = useState<ResponseFormatChoice>("text");

  // The request's own knobs. Raw strings in state — empty means "not
  // sent", parsed once per send by the same helper the panel's error
  // line uses.
  const [sampling, setSampling] = useState<SamplingDraft>(EMPTY_SAMPLING);

  const page = useMemo(pageLocation, []);
  const parsedTools = useMemo(() => parseToolDefinitions(toolDefs), [toolDefs]);
  const toolNames = "tools" in parsedTools ? parsedTools.tools.map((t) => t.function.name) : [];
  const toolsError = "error" in parsedTools ? parsedTools.error : null;
  const parsedSampling = useMemo(() => parseSampling(sampling), [sampling]);
  const samplingError = "error" in parsedSampling ? parsedSampling.error : null;
  const samplingCount = useMemo(() => activeSamplingCount(sampling), [sampling]);

  const transport: Transport = useMemo(
    () =>
      mode === "direct"
        ? { kind: "direct", baseUrl: normalizeBaseUrl(baseUrl), key: apiKey }
        : PROXY,
    [mode, baseUrl, apiKey],
  );
  // Read inside the send path, which we don't want to re-create on every
  // keystroke-driven re-render.
  const modelRef = useRef<string | null>(null);
  modelRef.current = model;
  const transportRef = useRef<Transport>(PROXY);
  transportRef.current = transport;
  // The in-flight turn's controller, so Stop can end it. Cleared when
  // the turn settles; aborted-and-cleared is how a stop is told apart
  // from a failure in the catch below.
  const abortRef = useRef<AbortController | null>(null);

  // The diagnostic's defaults, once the gate is open: the session token
  // as the key, and the gateway's probable address from the topology.
  useEffect(() => {
    if (setupGate !== "ready") return;
    const token = getSessionToken();
    setSessionToken(token);
    setApiKey((current) => current || token || "");
    const saved = readJson<PersistedDiagnostic>(DIAGNOSTIC_KEY);
    if (saved?.mode === "direct" || saved?.mode === "proxy") setMode(saved.mode);
    if (typeof saved?.baseUrl === "string") setBaseUrl(saved.baseUrl);
    if (saved?.open) setPanelsOpen(true);
    const tools = readJson<PersistedTools>(TOOLS_KEY);
    if (tools?.enabled) setToolsOn(true);
    if (typeof tools?.definitions === "string" && tools.definitions.trim()) {
      setToolDefs(tools.definitions);
    }
    const storedSampling = readJson<unknown>(SAMPLING_KEY);
    if (storedSampling !== null) setSampling(normalizeSamplingDraft(storedSampling));
    let cancelled = false;
    void (async () => {
      try {
        const list = await api.get<ComponentList>("agent", "/v1/components");
        if (cancelled) return;
        const guessed = guessGatewayBaseUrl(list.components ?? [], page);
        setGuess(guessed);
        // Prefill only an empty field: an address the operator typed is
        // theirs, and a guess overwriting it would be the panel deciding
        // it knows better than the person who can see the network.
        if (guessed) setBaseUrl((current) => current || displayBaseUrl(guessed));
      } catch {
        // No topology, no guess; the field stays for the operator to fill.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setupGate, page]);

  useEffect(() => {
    if (setupGate !== "ready") return;
    writeJson(DIAGNOSTIC_KEY, { mode, baseUrl, open: panelsOpen } satisfies PersistedDiagnostic);
  }, [setupGate, mode, baseUrl, panelsOpen]);

  useEffect(() => {
    if (setupGate !== "ready") return;
    writeJson(TOOLS_KEY, { enabled: toolsOn, definitions: toolDefs } satisfies PersistedTools);
  }, [setupGate, toolsOn, toolDefs]);

  useEffect(() => {
    if (setupGate !== "ready") return;
    writeJson(SAMPLING_KEY, sampling);
  }, [setupGate, sampling]);

  // The model list is the gateway's routing table, so it changes as
  // runtimes come and go. Refresh on a slow interval rather than once at
  // mount — a model that became routable while the tab was open should
  // show up without a reload. Listed through the active transport: in
  // direct mode `/v1/models` is part of the surface under test, and its
  // failure is a result, not an inconvenience to route around.
  const loadModels = useCallback(async () => {
    try {
      const list = await listModels(transport);
      // Chat models only. The library will discover, download and launch
      // a dedicated embedding model, and the gateway now refuses one on
      // this surface with a 400 -- so offering it in the picker would be
      // offering a choice that cannot work. `surfaces` is absent when
      // talking to a gateway older than call #2, and an absent list must
      // read as "no opinion" rather than "no chat", or this screen goes
      // empty against an install that has not been upgraded yet.
      const data = (list.data ?? []).filter((m) => {
        const surfaces = m.x_eugene_plexus?.surfaces;
        return !surfaces || surfaces.includes("chat");
      });
      setModels(data);
      // The decision surface gets its own panel below the transcript;
      // decision-only models never appear in the chat picker.
      setDecisionModels(
        (list.data ?? [])
          .filter((m) => m.x_eugene_plexus?.surfaces?.includes("decisions"))
          .map((m) => m.id),
      );
      setModelsError(null);
      // The chosen model can drop out of the list -- stopped, idled out,
      // or gone from a gateway's routes -- and the picker falls to the
      // first one left. It used to do that silently, so the next
      // message in a conversation went to a different model with
      // nothing on screen saying so.
      const current = modelRef.current;
      const next = current && data.some((m) => m.id === current) ? current : (data[0]?.id ?? null);
      if (current && next !== current) {
        setNotice(
          next
            ? `${current} is no longer offered, so your next message goes to ${next}.`
            : `${current} is no longer offered, and no other model is.`,
        );
      }
      setModel(next);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && transport.kind === "proxy") return;
      setModelsError(e instanceof ApiError ? (errorMessage(e.body) ?? e.message) : String(e));
    }
  }, [transport]);

  // Paused in a hidden tab, like every other poll here; a changed
  // transport is a new `loadModels`, so it is asked at once.
  usePolling(
    loadModels,
    15000,
    setupGate === "ready" &&
      !(transport.kind === "direct" && (!transport.baseUrl || !transport.key)),
  );

  // Chat history stays browser-side for the first pass — the design's
  // explicit call. Durable multi-device history needs a component that
  // doesn't exist yet. Read and written through one helper, because
  // Home's "Try it" card is a second writer of the same conversation.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = readPlaygroundTranscript();
    if (stored.messages.length > 0) setMessages(stored.messages);
    if (stored.model !== null) setModel(stored.model);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writePlaygroundTranscript({ model, messages });
  }, [hydrated, model, messages]);

  /** Send a history and append whatever comes back.
   *
   * Factored out of `handleSend` so Regenerate and tool results are the
   * same code path with a different history rather than parallel ones
   * that can drift. The gateway and the drivers below it are stateless by
   * contract, so "resend this turn" really is just "send these messages
   * again". */
  async function runTurn(outgoing: ChatCompletionMessage[]) {
    const chosen = modelRef.current;
    if (!chosen) {
      setError("No model selected — the gateway is not routing to anything yet.");
      return;
    }
    if (toolsOn && toolsError) {
      setError(toolsError);
      return;
    }
    if ("error" in parsedSampling) {
      setError(parsedSampling.error);
      return;
    }
    const values = parsedSampling.values;
    setError(null);
    setNotice(null);
    setTurnInfo(null);
    setMessages(outgoing);
    setPending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    // Outside the try, so a Stop can tell "kept what arrived" from "nothing
    // arrived at all" -- two different things to say, and only the second
    // leaves a turn to try again.
    let appended = false;

    try {
      // The assistant message is appended empty and then grown in place.
      // Doing it this way -- rather than accumulating and appending at
      // the end -- is the whole visible difference M10 makes: the reply
      // appears as it is generated instead of arriving all at once after
      // a long silence.
      let streamed = "";
      let generatedAt: string | undefined;
      const upsert = (message: ChatCompletionMessage) => {
        generatedAt ??= new Date().toISOString();
        const recorded = { ...message, generatedAt };
        setMessages((prev) => {
          if (!appended) {
            appended = true;
            return [...prev, recorded];
          }
          const next = [...prev];
          next[next.length - 1] = recorded;
          return next;
        });
      };
      const response = await streamChatCompletion(
        {
          model: chosen,
          // Full history every turn: the gateway and the drivers below it
          // are stateless by contract, so the transcript is the caller's
          // to carry. The system prompt rides only here — prepending it
          // into the stored transcript would send two on the next turn.
          messages: withSystemPrompt(outgoing, values.system, (content) => ({
            role: "system",
            content,
          })),
          timeoutMs: REQUEST_TIMEOUT_MS,
          temperature: values.temperature,
          maxTokens: values.maxTokens,
          topP: values.topP,
          seed: values.seed,
          stop: values.stop,
          tools: toolsOn && "tools" in parsedTools ? parsedTools.tools : undefined,
          toolChoice: toolsOn ? toolChoice : undefined,
          responseFormat: responseFormat === "json_object" ? { type: "json_object" } : undefined,
          transport: transportRef.current,
          reproduceBaseUrl: normalizeBaseUrl(baseUrl) || guess,
          signal: controller.signal,
          onReport: setReport,
          // Cards fill in as fragments land, the way the text does.
          onToolCalls: (calls) =>
            upsert({ role: "assistant", content: streamed || null, tool_calls: calls }),
        },
        (delta) => {
          streamed += delta;
          upsert({ role: "assistant", content: streamed });
        },
      );
      const choice = response.choices?.[0];
      if (choice) {
        // The assembled message, tool calls and all -- what a harness
        // would replay verbatim on the next turn. A backend that answered
        // without emitting a single delta (a batching backend, whose
        // stream is one event) lands here too.
        upsert(choice.message);
      }
      if (response.truncatedBy) {
        // The text above is real but incomplete. Showing it without
        // saying so would present a truncated answer as a finished one,
        // which is exactly what the gateway's commit-point rule trades
        // away for early delivery.
        setError(`The answer was cut short: ${response.truncatedBy}`);
      }
      setTurnInfo({
        ...(response.x_eugene_plexus ?? {}),
        model: response.model,
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        finishReason: response.choices?.[0]?.finish_reason ?? null,
        firstFrameMs: response.report.firstFrameMs,
        elapsedMs: response.report.elapsedMs,
        tokPerSec: clientTokPerSec(
          response.usage?.completion_tokens,
          response.report.elapsedMs,
          response.report.firstFrameMs,
        ),
      });
    } catch (e) {
      if (controller.signal.aborted) {
        // The operator pressed Stop. Whatever streamed is already in
        // the transcript; the only thing to say is that the end of the
        // answer is missing on purpose -- or, when Stop came before the
        // first token, that there is no answer, and the question is still
        // there to send again (below).
        setNotice(
          appended
            ? "Stopped. Whatever had already arrived is kept above."
            : "Stopped before any reply arrived.",
        );
        return;
      }
      const detail =
        e instanceof ApiError
          ? (errorMessage(e.body) ?? `${e.status} ${e.statusText}`)
          : e instanceof Error
            ? e.message
            : String(e);
      setError(detail);
    } finally {
      abortRef.current = null;
      setPending(false);
    }
  }

  /** End the in-flight turn. The stream's fetch is aborted at whichever
   * boundary it is on — waiting for headers or mid-body. */
  function stopTurn() {
    abortRef.current?.abort();
  }

  function handleSend(content: string | MessageContentPart[]) {
    void runTurn([...messages, { role: "user", content }]);
  }

  /** The operator answered the model's tool calls: one `tool` message per
   * call, then the next turn -- the sequence a harness performs. */
  function handleToolResults(results: ToolResult[]) {
    void runTurn([
      ...messages,
      ...results.map(
        (r): ChatCompletionMessage => ({
          role: "tool",
          content: r.content,
          tool_call_id: r.tool_call_id,
        }),
      ),
    ]);
  }

  /** Ask again for the last turn: drop the reply, resend what preceded it. */
  function handleRegenerate() {
    const lastUser = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUser < 0) return;
    void runTurn(messages.slice(0, lastUser + 1));
  }

  // After a failure the history already ends with what was sent — the
  // reply never arrived — so a retry is the same history again. Offered
  // right in the error strip, because "try it again" is the first thing
  // anyone does about a transient failure and re-typing is the worst way.
  const lastRole = messages[messages.length - 1]?.role;
  const canRetry = !pending && (lastRole === "user" || lastRole === "tool");
  function handleRetry() {
    void runTurn(messages);
  }

  /** Put an earlier message back in the composer and drop everything from it
   * onward. Destructive by design and by expectation - an edited message with
   * the old replies still under it would be a transcript that never happened. */
  function handleEditUserMessage(index: number, content: string) {
    setMessages(messages.slice(0, index));
    setTurnInfo(null);
    setError(null);
    setNotice(null);
    setSeed({ text: content, nonce: Date.now() });
  }

  function newConversation() {
    setMessages([]);
    setTurnInfo(null);
    setReport(null);
    setError(null);
    setNotice(null);
  }

  if (setupGate !== "ready") {
    return <SetupGateScreen state={setupGate} onRetry={retrySetupGate} />;
  }

  const selected = models.find((m) => m.id === model);
  return (
    <AppShell
      controls={
        <>
          <ModelPicker
            models={models}
            value={model}
            onChange={setModel}
            disabled={pending}
            error={modelsError}
            mode={mode}
          />
          <button
            type="button"
            data-testid="toggle-diagnostic"
            onClick={() => setPanelsOpen((o) => !o)}
            aria-pressed={panelsOpen}
            className={`font-ui rounded-[var(--radius)] border px-3 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] ${
              panelsOpen || mode === "direct" || toolsOn || samplingCount > 0
                ? "border-[color:var(--accent-left)]"
                : "border-[color:var(--border)]"
            }`}
            title="Which path to the gateway, tool definitions, request settings, and the request report"
          >
            Diagnostic{mode === "direct" ? " · direct" : ""}
            {toolsOn ? " · tools" : ""}
            {/* Hidden state is never silent: a closed panel with a seed
                set would otherwise change every answer with nothing on
                screen saying why. */}
            {samplingCount > 0 ? " · settings" : ""}
          </button>
          {/* The transcript is the one thing this page keeps across a
              reload, and New sat beside the model picker wiping it on one
              click. So it asks, but only when there is a conversation to
              lose: with none, there is nothing to ask about and the button
              stays the plain, disabled one it always was. */}
          {messages.length > 0 ? (
            <ConfirmButton
              label="New"
              confirmLabel="Clear it"
              prompt="This clears the conversation."
              onConfirm={newConversation}
              testId="new-conversation"
              className={NEW_BUTTON_CLASS}
            />
          ) : (
            <button
              type="button"
              data-testid="new-conversation"
              disabled
              className={NEW_BUTTON_CLASS}
            >
              New
            </button>
          )}
          {messages.length > 0 && (
            <CopyButton
              // What rode the wire, not what the page keeps: without the
              // browser-only `generatedAt` on every reply, and with the
              // system prompt the request carried in front. A house field
              // in a "compatible" payload is how compatible stops being true.
              text={JSON.stringify(
                withSystemPrompt(
                  requestMessages(messages),
                  "values" in parsedSampling ? parsedSampling.values.system : undefined,
                  (content) => ({ role: "system" as const, content }),
                ),
                null,
                2,
              )}
              label="Copy JSON"
              title="The messages array exactly as a harness would replay it, tool calls and results included"
              className="border border-[color:var(--border)] px-3 py-1 text-sm"
            />
          )}
        </>
      }
    >
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {panelsOpen && (
          <div className="grid max-h-[35dvh] shrink-0 grid-cols-1 gap-3 overflow-y-auto border-b border-[color:var(--border)] bg-[color:var(--panel-soft)] p-3 sm:grid-cols-2">
            <DiagnosticPanel
              mode={mode}
              onMode={setMode}
              baseUrl={baseUrl}
              onBaseUrl={setBaseUrl}
              guess={guess}
              apiKey={apiKey}
              onApiKey={setApiKey}
              sessionToken={sessionToken}
              page={page}
            />
            <ToolsPanel
              enabled={toolsOn}
              onEnabled={setToolsOn}
              definitions={toolDefs}
              onDefinitions={setToolDefs}
              error={toolsError}
              toolNames={toolNames}
              toolChoice={toolChoice}
              onToolChoice={setToolChoice}
              responseFormat={responseFormat}
              onResponseFormat={setResponseFormat}
              modelToolCalling={selected?.x_eugene_plexus?.tool_calling}
            />
            <div className="flex sm:col-span-2">
              <SamplingPanel draft={sampling} onDraft={setSampling} error={samplingError} />
            </div>
            {decisionModels.length > 0 && (
              <div className="sm:col-span-2">
                <DecisionPanel models={decisionModels} />
              </div>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          <ChatLog
            messages={messages}
            pending={pending}
            onRegenerate={handleRegenerate}
            onEditUserMessage={handleEditUserMessage}
            onToolResults={handleToolResults}
          />
        </div>

        {turnInfo && <RoutingBar info={turnInfo} />}
        {report && <RequestReport report={report} page={page} apiKey={apiKey || null} />}
        {error && (
          <div
            role="alert"
            className="status-error flex items-center gap-3 border-t px-4 py-2 text-sm"
          >
            <span className="min-w-0 flex-1">{error}</span>
            {canRetry && (
              <button
                type="button"
                data-testid="retry-turn"
                onClick={handleRetry}
                title="Send the same history again; nothing needs re-typing"
                className="font-ui shrink-0 rounded-[var(--radius)] border border-current px-2 py-0.5 text-[0.6875rem] hover:bg-[color:var(--panel-hover)]"
              >
                Try again
              </button>
            )}
          </div>
        )}
        {notice && (
          <div
            data-testid="turn-notice"
            role="status"
            className="font-ui flex items-center gap-3 border-t border-[color:var(--border)] px-4 py-2 text-sm text-[color:var(--muted)]"
          >
            <span className="min-w-0 flex-1">{notice}</span>
            {/* A Stop before the first token leaves the question as the
                last message, with the composer cleared: the next Send
                would put two questions in a row. */}
            {canRetry && (
              <button
                type="button"
                data-testid="retry-turn"
                onClick={handleRetry}
                title="Send the same history again; nothing needs re-typing"
                className="font-ui shrink-0 rounded-[var(--radius)] border border-current px-2 py-0.5 text-[0.6875rem] hover:bg-[color:var(--panel-hover)]"
              >
                Try again
              </button>
            )}
          </div>
        )}

        <ChatInput
          onSend={handleSend}
          disabled={pending || model == null}
          seed={seed}
          pending={pending}
          onStop={stopTurn}
          // Warn before Send, never strip -- the tools rule. Only an
          // explicit false warns: an absent flag is a gateway with no
          // opinion, not a model with no eyes.
          imageNote={
            selected?.x_eugene_plexus?.image_input === false
              ? "The selected model does not take images: no backend serving it confirmed image " +
                "input, so the gateway will refuse this request rather than drop the pictures."
              : null
          }
        />
      </main>
    </AppShell>
  );
}

function ModelPicker({
  models,
  value,
  onChange,
  disabled,
  error,
  mode,
}: {
  models: Model[];
  value: string | null;
  onChange: (id: string) => void;
  disabled: boolean;
  error: string | null;
  mode: GatewayMode;
}) {
  if (error) {
    return (
      <p className="font-ui truncate text-sm text-[color:var(--muted)]" title={error}>
        Gateway unreachable{mode === "direct" ? " (direct)" : ""} — {error}
      </p>
    );
  }
  if (models.length === 0) {
    return (
      <p className="font-ui text-sm text-[color:var(--muted)]">
        No routable models.{" "}
        <Link href="/inference" className="underline">
          See what is serving
        </Link>
        .
      </p>
    );
  }
  const selected = models.find((m) => m.id === value);
  const replicas = selected?.x_eugene_plexus?.drivers?.length ?? 0;
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label="Model"
        className="font-ui max-w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 text-sm outline-none hover:border-[color:var(--border-hover)] disabled:opacity-50 sm:max-w-[420px]"
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.id}
          </option>
        ))}
      </select>
      <p className="font-ui truncate text-[0.6875rem] text-[color:var(--muted)]">
        {selected?.owned_by ?? "unknown provider"}
        {selected?.x_eugene_plexus?.context_length != null &&
          ` · ${tokenCount(selected.x_eugene_plexus.context_length)} ctx`}
        {selected?.x_eugene_plexus?.tool_calling === true && " · tools"}
        {selected?.x_eugene_plexus?.image_input === true && " · images"}
        {replicas > 1 && ` · ${replicas} replicas`}
      </p>
    </div>
  );
}

/** Where the last turn actually went. Cheap to render, and the first
 * thing worth knowing when a reply looks wrong. */
function RoutingBar({ info }: { info: TurnInfo }) {
  const parts: string[] = [];
  if (info.model) parts.push(info.model);
  if (info.driver) parts.push(`driver ${info.driver}`);
  if (info.runtime) parts.push(`runtime ${info.runtime}`);
  if (info.backend) parts.push(info.backend);
  // The browser's total, as the report below spells it; the gateway's
  // own figure is in the report, labelled as the gateway's.
  if (info.elapsedMs != null) parts.push(`${seconds(info.elapsedMs)} total`);
  if (info.promptTokens != null && info.completionTokens != null) {
    parts.push(`${info.promptTokens}→${info.completionTokens} tok`);
  }
  // Both from this browser's clock: what the person sitting here
  // experienced, not the backend's own accounting. The rate is decode
  // only (after the first frame), and approximate — hence the tilde.
  if (info.firstFrameMs != null) parts.push(`first token ${seconds(info.firstFrameMs)}`);
  if (info.tokPerSec != null) parts.push(`~${info.tokPerSec.toFixed(1)} tok/s`);
  // The window that applied to *this* turn, which is not the smallest
  // across every replica -- that one is on the model picker above.
  if (info.context_length != null) {
    parts.push(`${tokenCount(info.context_length)} ctx`);
  }
  return (
    <div className="flex items-center gap-2 border-t border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-1 font-mono text-[0.6875rem] text-[color:var(--muted)]">
      <span className="truncate">{parts.join(" · ")}</span>
      {info.attempts != null && info.attempts > 1 && (
        <span className="status-error px-1" title="An earlier backend failed and the cascade fired">
          {info.attempts} attempts
        </span>
      )}
      {/* The answer above is about whatever survived, and nothing else
          says so -- the backend returned 200 and no flag of its own.
          This is the one screen where a human reads a completion's
          envelope, so it is the one place the warning can land. Only
          `true` renders: `null` means we could not check, which is not
          the same claim and must not look like reassurance. */}
      {info.prompt_truncated === true && (
        <span
          className="status-error px-1"
          title={
            "The backend discarded most of the prompt to make it fit and answered anyway. " +
            "The reply is about what survived, not what you sent. Raise the backend's " +
            "context window, or send less."
          }
        >
          input truncated
        </span>
      )}
      {/* The two finish reasons that change what the text above means.
          `stop` and `tool_calls` are the quiet normal cases and stay
          out of the bar — a badge that is always there is one people
          learn to skip. */}
      {info.finishReason === "length" && (
        <span
          className="status-warn px-1"
          title={
            "The reply stopped at the token limit, not at a natural end. Raise max_tokens " +
            "in Request settings, or clear it to use the model's own setting."
          }
        >
          hit the token limit
        </span>
      )}
      {info.finishReason === "content_filter" && (
        <span
          className="status-warn px-1"
          title="The backend's own safety layer ended the reply. The text above is what it allowed."
        >
          filtered by the backend
        </span>
      )}
    </div>
  );
}
