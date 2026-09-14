"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChatInput } from "@/components/ChatInput";
import { ChatLog, type ToolResult } from "@/components/ChatLog";
import { DiagnosticPanel, type GatewayMode } from "@/components/DiagnosticPanel";
import { RequestReport } from "@/components/RequestReport";
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
import { clearSessionToken, getSessionToken, hasSessionToken } from "@/lib/session";
import type {
  ChatCompletionMessage,
  ComponentList,
  CompletionRoutingInfo,
  Model,
  ToolChoice,
} from "@/lib/types";
import type { AgentConfigDocument } from "@/lib/agent";

const STORAGE_KEY = "eugene-playground";
const DIAGNOSTIC_KEY = "eugene-playground-diagnostic";
const TOOLS_KEY = "eugene-playground-tools";

// Generation on a large local quant is slow but not unbounded. Past
// this, something is wedged and the operator wants an error rather than
// a spinner.
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

interface PersistedConversation {
  model: string | null;
  messages: ChatCompletionMessage[];
}

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
  const router = useRouter();
  const [messages, setMessages] = useState<ChatCompletionMessage[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [turnInfo, setTurnInfo] = useState<TurnInfo | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [setupGate, setSetupGate] = useState<"checking" | "ready">("checking");
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

  const page = useMemo(pageLocation, []);
  const parsedTools = useMemo(() => parseToolDefinitions(toolDefs), [toolDefs]);
  const toolNames = "tools" in parsedTools ? parsedTools.tools.map((t) => t.function.name) : [];
  const toolsError = "error" in parsedTools ? parsedTools.error : null;

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

  // Auth + first-run gate. Runs in order:
  //   1. Probe init state (public endpoint, no auth) — route to /setup
  //      if uninitialized.
  //   2. Check for a session token BEFORE making any authed call, so the
  //      playground never renders for an unauthenticated visitor.
  //   3. Authed GET /v1/config to honor firstRunComplete.
  // Agent unreachable falls through to the playground so a dev run
  // against just the gateway still works.
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const status = await api.get<{ initialized: boolean }>("agent", "/v1/auth/status", {
          skipAuth: true,
        });
        if (cancelled) return;
        if (!status.initialized) {
          router.replace("/setup");
          return;
        }
        if (!hasSessionToken()) {
          const next = encodeURIComponent(window.location.pathname + window.location.search);
          router.replace(`/login?next=${next}`);
          return;
        }
        const doc = await api.get<AgentConfigDocument>("agent", "/v1/config");
        if (cancelled) return;
        if (doc.firstRunComplete === false) {
          router.replace("/setup");
          return;
        }
        setSetupGate("ready");
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) return;
        setSetupGate("ready");
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [router]);

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

  // The model list is the gateway's routing table, so it changes as
  // runtimes come and go. Refresh on a slow interval rather than once at
  // mount — a model that became routable while the tab was open should
  // show up without a reload. Listed through the active transport: in
  // direct mode `/v1/models` is part of the surface under test, and its
  // failure is a result, not an inconvenience to route around.
  const loadModels = useCallback(async () => {
    try {
      const list = await listModels(transportRef.current);
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
      setModelsError(null);
      setModel((current) => {
        if (current && data.some((m) => m.id === current)) return current;
        return data[0]?.id ?? null;
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && transportRef.current.kind === "proxy")
        return;
      setModelsError(e instanceof ApiError ? (errorMessage(e.body) ?? e.message) : String(e));
    }
  }, []);

  useEffect(() => {
    if (setupGate !== "ready") return;
    if (transport.kind === "direct" && (!transport.baseUrl || !transport.key)) return;
    void loadModels();
    const id = setInterval(() => void loadModels(), 15000);
    return () => clearInterval(id);
  }, [setupGate, loadModels, transport]);

  // Chat history stays browser-side for the first pass — the design's
  // explicit call. Durable multi-device history needs a component that
  // doesn't exist yet.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedConversation>;
        if (Array.isArray(parsed.messages)) setMessages(parsed.messages);
        if (typeof parsed.model === "string") setModel(parsed.model);
      }
    } catch {
      // sessionStorage throws in some private modes; start empty.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const payload: PersistedConversation = { model, messages };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
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
    setError(null);
    setTurnInfo(null);
    setMessages(outgoing);
    setPending(true);

    try {
      // The assistant message is appended empty and then grown in place.
      // Doing it this way -- rather than accumulating and appending at
      // the end -- is the whole visible difference M10 makes: the reply
      // appears as it is generated instead of arriving all at once after
      // a long silence.
      let streamed = "";
      let appended = false;
      const upsert = (message: ChatCompletionMessage) => {
        setMessages((prev) => {
          if (!appended) {
            appended = true;
            return [...prev, message];
          }
          const next = [...prev];
          next[next.length - 1] = message;
          return next;
        });
      };
      const response = await streamChatCompletion(
        {
          model: chosen,
          // Full history every turn: the gateway and the drivers below it
          // are stateless by contract, so the transcript is the caller's
          // to carry.
          messages: outgoing,
          timeoutMs: REQUEST_TIMEOUT_MS,
          tools: toolsOn && "tools" in parsedTools ? parsedTools.tools : undefined,
          toolChoice: toolsOn ? toolChoice : undefined,
          responseFormat: responseFormat === "json_object" ? { type: "json_object" } : undefined,
          transport: transportRef.current,
          reproduceBaseUrl: normalizeBaseUrl(baseUrl) || guess,
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
      });
    } catch (e) {
      const detail =
        e instanceof ApiError
          ? (errorMessage(e.body) ?? `${e.status} ${e.statusText}`)
          : e instanceof Error
            ? e.message
            : String(e);
      setError(detail);
    } finally {
      setPending(false);
    }
  }

  function handleSend(text: string) {
    void runTurn([...messages, { role: "user", content: text }]);
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

  /** Put an earlier message back in the composer and drop everything from it
   * onward. Destructive by design and by expectation - an edited message with
   * the old replies still under it would be a transcript that never happened. */
  function handleEditUserMessage(index: number, content: string) {
    setMessages(messages.slice(0, index));
    setTurnInfo(null);
    setError(null);
    setSeed({ text: content, nonce: Date.now() });
  }

  function newConversation() {
    setMessages([]);
    setTurnInfo(null);
    setReport(null);
    setError(null);
  }

  async function handleLogout() {
    try {
      await api.delete("agent", "/v1/auth/sessions/current");
    } catch {
      // ignore
    }
    clearSessionToken();
    router.push("/login");
  }

  if (setupGate === "checking") {
    return (
      <main className="relative z-10 flex h-screen items-center justify-center">
        <p className="font-ui text-xs text-[color:var(--muted)]">Checking setup state…</p>
      </main>
    );
  }

  const selected = models.find((m) => m.id === model);
  const navLink =
    "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs text-[color:var(--foreground)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]";

  return (
    <main className="relative z-10 flex h-screen flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Image
            src="/eugene-icon.svg"
            alt="Eugene Plexus"
            width={40}
            height={40}
            priority
            className="shrink-0"
          />
          <ModelPicker
            models={models}
            value={model}
            onChange={setModel}
            disabled={pending}
            error={modelsError}
            mode={mode}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            data-testid="toggle-diagnostic"
            onClick={() => setPanelsOpen((o) => !o)}
            aria-pressed={panelsOpen}
            className={`font-ui rounded-[var(--radius)] border px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] ${
              panelsOpen || mode === "direct" || toolsOn
                ? "border-[color:var(--accent-left)]"
                : "border-[color:var(--border)]"
            }`}
            title="Which path to the gateway, tool definitions, and the request report"
          >
            Diagnostic{mode === "direct" ? " · direct" : ""}
            {toolsOn ? " · tools" : ""}
          </button>
          <button
            type="button"
            onClick={newConversation}
            disabled={messages.length === 0}
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30"
          >
            New
          </button>
          <Link href="/library" className={navLink}>
            Library
          </Link>
          <Link href="/discover" className={navLink}>
            Discover
          </Link>
          <Link href="/inference" className={navLink}>
            Inference
          </Link>
          <Link href="/metrics" className={navLink}>
            Metrics
          </Link>
          <Link href="/nodes" className={navLink}>
            Nodes
          </Link>
          <Link href="/config" className={navLink}>
            Config
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs text-[color:var(--muted)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] hover:text-[color:var(--foreground)]"
            title="Revoke this session and return to the login screen"
          >
            Sign out
          </button>
        </div>
      </header>

      {panelsOpen && (
        <div className="flex flex-wrap gap-3 border-b border-[color:var(--border)] bg-[color:var(--panel-soft)] p-3">
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
      {error && <div className="status-error border-t px-4 py-2 text-xs">{error}</div>}

      <ChatInput onSend={handleSend} disabled={pending || model == null} seed={seed} />
    </main>
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
      <p className="font-ui truncate text-xs text-[color:var(--muted)]" title={error}>
        Gateway unreachable{mode === "direct" ? " (direct)" : ""} — {error}
      </p>
    );
  }
  if (models.length === 0) {
    return (
      <p className="font-ui text-xs text-[color:var(--muted)]">
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
        className="font-ui max-w-[420px] rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 text-xs outline-none hover:border-[color:var(--border-hover)] disabled:opacity-50"
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.id}
          </option>
        ))}
      </select>
      <p className="font-ui truncate text-[11px] text-[color:var(--muted)]">
        {selected?.owned_by ?? "unknown provider"}
        {selected?.x_eugene_plexus?.context_length != null &&
          ` · ${selected.x_eugene_plexus.context_length.toLocaleString()} ctx`}
        {selected?.x_eugene_plexus?.tool_calling === true && " · tools"}
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
  if (info.latency_ms != null) parts.push(`${(info.latency_ms / 1000).toFixed(1)}s`);
  if (info.promptTokens != null && info.completionTokens != null) {
    parts.push(`${info.promptTokens}→${info.completionTokens} tok`);
  }
  // The window that applied to *this* turn, which is not the smallest
  // across every replica -- that one is on the model picker above.
  if (info.context_length != null) {
    parts.push(`${info.context_length.toLocaleString()} ctx`);
  }
  return (
    <div className="flex items-center gap-2 border-t border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-1 font-mono text-[11px] text-[color:var(--muted)]">
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
    </div>
  );
}
