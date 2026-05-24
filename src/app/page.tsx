"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ChatInput } from "@/components/ChatInput";
import { ChatLog } from "@/components/ChatLog";
import { CopyTraceButton } from "@/components/CopyTraceButton";
import { HemisphereRail } from "@/components/HemisphereRail";
import { ApiError, api } from "@/lib/api";
import {
  DEMO_CONVERSATION_ID,
  DEMO_MESSAGES,
  DEMO_PASSES,
} from "@/lib/demoData";
import { clearSessionToken } from "@/lib/session";
import type { ChatRequest, ChatResponse, Message, PassRecord } from "@/lib/types";
import type { WatchdogConfigDocument } from "@/lib/watchdog";

const STORAGE_KEY = "eugene-conversation";

// v0.2.x VoicePassRecord shape — hand-typed because the orchestrator
// generated types may lag the spec when codegen hasn't run since the
// most recent pin. Mirrors openapi/orchestrator.yaml.
interface VoicePassRecord {
  driverName: string;
  inputMessages: Message[];
  output: Message;
  latencyMs?: number;
}

interface PersistedConversation {
  conversationId: string | null;
  messages: Message[];
  latestPasses: PassRecord[];
  latestVoicePass: VoicePassRecord | null;
}

export default function ChatPage() {
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [latestPasses, setLatestPasses] = useState<PassRecord[]>([]);
  const [latestVoicePass, setLatestVoicePass] =
    useState<VoicePassRecord | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Don't persist before the initial hydration has run — otherwise the
  // first render's empty state would clobber whatever was in storage.
  const [hydrated, setHydrated] = useState(false);
  const [setupGate, setSetupGate] = useState<"checking" | "ready">("checking");

  // First-run gate: probe init state first (public endpoint, no auth
  // needed) so we route to /setup on fresh installs without bouncing
  // through /login. Then for initialized installs, fetch /v1/config to
  // honor firstRunComplete (operator may have un-flipped it to redo
  // setup). Watchdog unreachable falls through to the chat surface so
  // standalone dev runs against just-the-orchestrator still work.
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const status = await api.get<{ initialized: boolean }>(
          "watchdog",
          "/v1/auth/status",
          { skipAuth: true },
        );
        if (cancelled) return;
        if (!status.initialized) {
          router.replace("/setup");
          return;
        }
        // Initialized — read firstRunComplete. Requires auth; if absent,
        // bounce through login with our return path preserved.
        const doc = await api.get<WatchdogConfigDocument>("watchdog", "/v1/config");
        if (cancelled) return;
        if (doc.firstRunComplete === false) {
          router.replace("/setup");
          return;
        }
        setSetupGate("ready");
      } catch {
        if (cancelled) return;
        // Watchdog absent / unreachable → behave as before (open chat).
        setSetupGate("ready");
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Hydrate conversation from sessionStorage so the chat survives
  // navigation to /config and back, plus F5 reloads within the tab.
  // Demo / thinking flags from the URL run after, intentionally
  // overriding any persisted state when the user explicitly invokes
  // those modes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedConversation>;
        if (typeof parsed.conversationId === "string") setConversationId(parsed.conversationId);
        if (Array.isArray(parsed.messages)) setMessages(parsed.messages);
        if (Array.isArray(parsed.latestPasses)) setLatestPasses(parsed.latestPasses);
        if (parsed.latestVoicePass != null) setLatestVoicePass(parsed.latestVoicePass);
      }
    } catch {
      // sessionStorage can throw in private modes; fall through to empty.
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") === "1") {
      setConversationId(DEMO_CONVERSATION_ID);
      setMessages(DEMO_MESSAGES);
      setLatestPasses(DEMO_PASSES);
    }
    if (params.get("thinking") === "1") {
      setPending(true);
    }
    setHydrated(true);
  }, []);

  // Persist on any change after hydration.
  useEffect(() => {
    if (!hydrated) return;
    try {
      const payload: PersistedConversation = {
        conversationId,
        messages,
        latestPasses,
        latestVoicePass,
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [hydrated, conversationId, messages, latestPasses, latestVoicePass]);

  async function handleSend(text: string) {
    setError(null);
    setPending(true);

    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);

    // openapi-typescript treats fields with `default:` as required, so we
    // have to send maxPasses even though the orchestrator would default
    // it server-side. Mirror the spec default (3) here.
    const body: ChatRequest = {
      message: text,
      maxPasses: 3,
      ...(conversationId ? { conversationId } : {}),
    };

    try {
      const response = await api.post<ChatResponse>("orchestrator", "/v1/chat", body);
      setConversationId(response.conversationId);
      setMessages((prev) => [...prev, response.message]);
      setLatestPasses(response.passes);
      // v0.2.x ChatResponse carries voicePass — the LLM call that
      // converted internal deliberation into Eugene's user-facing
      // reply. Capture it for the copy-trace diagnostic.
      const voicePass = (response as { voicePass?: VoicePassRecord }).voicePass;
      setLatestVoicePass(voicePass ?? null);
    } catch (e) {
      const detail =
        e instanceof ApiError
          ? `${e.status} ${e.statusText}: ${
              typeof e.body === "object" && e.body !== null && "detail" in e.body
                ? JSON.stringify((e.body as Record<string, unknown>).detail)
                : JSON.stringify(e.body)
            }`
          : e instanceof Error
            ? e.message
            : String(e);
      setError(detail);
    } finally {
      setPending(false);
    }
  }

  function newConversation() {
    setConversationId(null);
    setMessages([]);
    setLatestVoicePass(null);
    setLatestPasses([]);
    setError(null);
  }

  async function handleLogout() {
    // Best-effort server-side revoke. The api client auto-attaches the
    // current Bearer; on success the watchdog adds the token to its
    // in-memory revocation set. Network/auth errors don't block the
    // local clear — losing the cached token in this tab is the
    // outcome users actually want when they click Sign out.
    try {
      await api.delete("watchdog", "/v1/auth/sessions/current");
    } catch {
      // ignore
    }
    clearSessionToken();
    // Push to /login so the next render starts fresh. /login itself
    // is auth-less so this won't redirect-loop.
    router.push("/login");
  }

  const sectionClass =
    "relative flex min-h-0 flex-col border-r border-[color:var(--border)]" +
    (pending ? " is-thinking" : "");
  const asideClass = "relative flex min-h-0 flex-col" + (pending ? " is-thinking" : "");
  const railContentClass =
    "relative min-h-0 flex-1 overflow-hidden" + (pending ? " is-thinking-rail" : "");

  if (setupGate === "checking") {
    return (
      <main className="relative z-10 flex h-screen items-center justify-center">
        <p className="font-ui text-xs text-[color:var(--muted)]">Checking setup state…</p>
      </main>
    );
  }

  return (
    <main className="relative z-10 grid h-screen grid-cols-[1fr_400px] overflow-hidden">
      <section className={sectionClass}>
        <header className="flex items-center justify-between border-b border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3">
          <div className="flex items-center gap-3">
            <Image
              src="/eugene-icon.png"
              alt="Eugene"
              width={64}
              height={64}
              priority
              className="shrink-0"
            />
            <p className="font-ui text-[11px] text-[color:var(--muted)]">
              {conversationId
                ? `conversation ${conversationId.slice(0, 8)}…`
                : "no conversation yet"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={newConversation}
              disabled={messages.length === 0}
              className="font-ui rounded border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[color:var(--border)] disabled:hover:bg-transparent"
            >
              New
            </button>
            <Link
              href="/config"
              className="font-ui rounded border border-[color:var(--border)] px-3 py-1 text-xs text-[color:var(--foreground)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
            >
              Config
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="font-ui rounded border border-[color:var(--border)] px-3 py-1 text-xs text-[color:var(--muted)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] hover:text-[color:var(--foreground)]"
              title="Revoke this session and return to the login screen"
            >
              Sign out
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden">
          <ChatLog messages={messages} />
        </div>

        {error && (
          <div className="status-error border-t px-4 py-2 text-xs">
            {error}
          </div>
        )}

        <ChatInput onSend={handleSend} disabled={pending} />
      </section>

      <aside className={asideClass}>
        <header className="flex items-center justify-between border-b border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3">
          <span className="font-mono text-xs tracking-wider text-[color:var(--muted)] uppercase">
            hemispheres
          </span>
          <CopyTraceButton
            messages={messages}
            passes={latestPasses}
            voicePass={latestVoicePass}
          />
        </header>
        <div className={railContentClass}>
          <HemisphereRail passes={latestPasses} />
        </div>
      </aside>
    </main>
  );
}
