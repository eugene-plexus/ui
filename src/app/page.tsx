"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ChatInput } from "@/components/ChatInput";
import { ChatLog } from "@/components/ChatLog";
import { ApiError, api } from "@/lib/api";
import { errorMessage, listModels, streamChatCompletion } from "@/lib/completions";
import { clearSessionToken, hasSessionToken } from "@/lib/session";
import type { ChatCompletionMessage, CompletionRoutingInfo, Model } from "@/lib/types";
import type { AgentConfigDocument } from "@/lib/agent";

const STORAGE_KEY = "eugene-playground";

// Generation on a large local quant is slow but not unbounded. Past
// this, something is wedged and the operator wants an error rather than
// a spinner.
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

interface PersistedConversation {
  model: string | null;
  messages: ChatCompletionMessage[];
}

/** What actually served the last turn, straight off the response's
 * `x_eugene_plexus` extension. The failure mode of a routing layer is
 * opacity — `attempts > 1` is the visible evidence failover fired. */
interface TurnInfo extends CompletionRoutingInfo {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
}

export default function PlaygroundPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatCompletionMessage[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [turnInfo, setTurnInfo] = useState<TurnInfo | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [setupGate, setSetupGate] = useState<"checking" | "ready">("checking");
  const [seed, setSeed] = useState<{ text: string; nonce: number } | undefined>(undefined);

  // `model` is read inside the send path, which we don't want to re-create
  // on every keystroke-driven re-render.
  const modelRef = useRef<string | null>(null);
  modelRef.current = model;

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

  // The model list is the gateway's routing table, so it changes as
  // runtimes come and go. Refresh on a slow interval rather than once at
  // mount — a model that became routable while the tab was open should
  // show up without a reload.
  const loadModels = useCallback(async () => {
    try {
      const list = await listModels();
      const data = list.data ?? [];
      setModels(data);
      setModelsError(null);
      setModel((current) => {
        if (current && data.some((m) => m.id === current)) return current;
        return data[0]?.id ?? null;
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      setModelsError(e instanceof ApiError ? (errorMessage(e.body) ?? e.message) : String(e));
    }
  }, []);

  useEffect(() => {
    if (setupGate !== "ready") return;
    void loadModels();
    const id = setInterval(() => void loadModels(), 15000);
    return () => clearInterval(id);
  }, [setupGate, loadModels]);

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
   * Factored out of `handleSend` so Regenerate is the same code path with a
   * different history rather than a parallel one that can drift from it. The
   * gateway and the drivers below it are stateless by contract, so "resend
   * this turn" really is just "send these messages again". */
  async function runTurn(outgoing: ChatCompletionMessage[]) {
    const chosen = modelRef.current;
    if (!chosen) {
      setError("No model selected — the gateway is not routing to anything yet.");
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
      const response = await streamChatCompletion(
        {
          model: chosen,
          // Full history every turn: the gateway and the drivers below it
          // are stateless by contract, so the transcript is the caller's
          // to carry.
          messages: outgoing,
          timeoutMs: REQUEST_TIMEOUT_MS,
        },
        (delta) => {
          streamed += delta;
          setMessages((prev) => {
            if (!appended) {
              appended = true;
              return [...prev, { role: "assistant", content: streamed }];
            }
            const next = [...prev];
            next[next.length - 1] = { role: "assistant", content: streamed };
            return next;
          });
        },
      );
      const choice = response.choices?.[0];
      if (choice && !appended) {
        // A backend that answered without emitting a single delta --
        // possible for a batching backend, whose stream is one event.
        setMessages((prev) => [...prev, choice.message]);
      }
      const truncatedBy = (response as { truncatedBy?: string }).truncatedBy;
      if (truncatedBy) {
        // The text above is real but incomplete. Showing it without
        // saying so would present a truncated answer as a finished one,
        // which is exactly what the gateway's commit-point rule trades
        // away for early delivery.
        setError(`The answer was cut short: ${truncatedBy}`);
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

  return (
    <main className="relative z-10 flex h-screen flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Image
            src="/eugene-icon.png"
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
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={newConversation}
            disabled={messages.length === 0}
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30"
          >
            New
          </button>
          <Link
            href="/library"
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs text-[color:var(--foreground)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
          >
            Library
          </Link>
          <Link
            href="/discover"
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs text-[color:var(--foreground)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
          >
            Discover
          </Link>
          <Link
            href="/runtimes"
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs text-[color:var(--foreground)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
          >
            Runtimes
          </Link>
          <Link
            href="/metrics"
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs text-[color:var(--foreground)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
          >
            Metrics
          </Link>
          <Link
            href="/nodes"
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs text-[color:var(--foreground)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
          >
            Nodes
          </Link>
          <Link
            href="/config"
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs text-[color:var(--foreground)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
          >
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

      <div className="min-h-0 flex-1 overflow-hidden">
        <ChatLog
          messages={messages}
          pending={pending}
          onRegenerate={handleRegenerate}
          onEditUserMessage={handleEditUserMessage}
        />
      </div>

      {turnInfo && <RoutingBar info={turnInfo} />}
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
}: {
  models: Model[];
  value: string | null;
  onChange: (id: string) => void;
  disabled: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <p className="font-ui truncate text-xs text-[color:var(--muted)]" title={error}>
        Gateway unreachable — {error}
      </p>
    );
  }
  if (models.length === 0) {
    return (
      <p className="font-ui text-xs text-[color:var(--muted)]">
        No routable models.{" "}
        <Link href="/runtimes" className="underline">
          Check runtimes
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
