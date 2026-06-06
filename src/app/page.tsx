"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ChatInput } from "@/components/ChatInput";
import { ChatLog } from "@/components/ChatLog";
import { ConsciousnessStream, type FeedItem } from "@/components/ConsciousnessStream";
import { CopyTraceButton } from "@/components/CopyTraceButton";
import { ApiError, api } from "@/lib/api";
import { DEMO_CONVERSATION_ID, DEMO_FEED, DEMO_MESSAGES } from "@/lib/demoData";
import { sendMessageEvent } from "@/lib/events";
import { clearSessionToken, hasSessionToken } from "@/lib/session";
import type {
  ConsciousnessEvent,
  EfferentSpeechAct,
  FocusSwitch,
  Message,
  NTState,
  PassRecord,
  PhaseChange,
} from "@/lib/types";
import { useConsciousnessStream } from "@/lib/useConsciousnessStream";
import type { WatchdogConfigDocument } from "@/lib/watchdog";

const STORAGE_KEY = "eugene-conversation";

// The consciousness feed grows for the life of the tab. Cap it so a long
// session doesn't grow the DOM / state unboundedly — the most recent
// activity is what matters, and the full record lives in memory + logs.
const FEED_CAP = 300;

interface PersistedConversation {
  conversationId: string | null;
  messages: Message[];
  // Thoughts from the most recent turn — feeds the "Thought for X.Xs"
  // chip + copy-trace. The live feed itself is ephemeral (it rebuilds
  // from the stream on reload), so it isn't persisted.
  latestTurnThoughts: PassRecord[];
  latestTurnLatencyMs: number | null;
  ntState: NTState | null;
}

export default function ChatPage() {
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  // Consciousness-stream state.
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [ntState, setNtState] = useState<NTState | null>(null);
  const [phase, setPhase] = useState<"awake" | "asleep">("awake");
  const [focus, setFocus] = useState<string | null>(null);

  // Per-turn metadata for the chat-side chip / copy-trace.
  const [latestTurnThoughts, setLatestTurnThoughts] = useState<PassRecord[]>([]);
  const [latestTurnLatencyMs, setLatestTurnLatencyMs] = useState<number | null>(null);

  // In-flight sends. `pendingCount` drives the thinking indicator;
  // `pendingStartRef` maps an afferent eventId → its send timestamp so the
  // matching `speech` (inResponseTo) can be timed and cleared.
  const [pendingCount, setPendingCount] = useState(0);
  const pendingStartRef = useRef<Map<string, number>>(new Map());

  const [error, setError] = useState<string | null>(null);
  // Don't persist before the initial hydration has run — otherwise the
  // first render's empty state would clobber whatever was in storage.
  const [hydrated, setHydrated] = useState(false);
  const [setupGate, setSetupGate] = useState<"checking" | "ready">("checking");
  const [operatorName, setOperatorName] = useState<string | null>(null);

  // Monotonic key source for feed items (events carry no id of their own).
  const seqRef = useRef(0);

  // Auth + first-run gate. Runs in order:
  //   1. Probe init state (public endpoint, no auth) — route to /setup
  //      if uninitialized.
  //   2. Check for a session token BEFORE making any authed call. If
  //      absent, redirect to /login immediately so the chat surface never
  //      renders for an unauthenticated visitor.
  //   3. Authed call to GET /v1/config to honor firstRunComplete.
  // Watchdog unreachable falls through to the chat surface so standalone
  // dev runs against just-the-orchestrator still work.
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const status = await api.get<{ initialized: boolean }>("watchdog", "/v1/auth/status", {
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
        const doc = await api.get<WatchdogConfigDocument>("watchdog", "/v1/config");
        if (cancelled) return;
        if (doc.firstRunComplete === false) {
          router.replace("/setup");
          return;
        }
        setSetupGate("ready");
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) {
          return;
        }
        setSetupGate("ready");
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Resolve the operator's display name so the chat header can show who
  // Eugene is talking to. Fails silently when identity is absent.
  useEffect(() => {
    if (setupGate !== "ready") return;
    let cancelled = false;
    void (async () => {
      try {
        const resp = await api.get<{ persons: { displayName: string; isOperator?: boolean }[] }>(
          "identity",
          "/v1/identity/persons",
        );
        if (cancelled) return;
        const op = (resp.persons ?? []).find((p) => p.isOperator);
        if (op) setOperatorName(op.displayName);
      } catch {
        // identity unavailable — header just shows no name.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setupGate]);

  // Hydrate conversation from sessionStorage so the chat survives
  // navigation to /config and back, plus F5 reloads within the tab.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedConversation>;
        if (typeof parsed.conversationId === "string") setConversationId(parsed.conversationId);
        if (Array.isArray(parsed.messages)) setMessages(parsed.messages);
        if (Array.isArray(parsed.latestTurnThoughts))
          setLatestTurnThoughts(parsed.latestTurnThoughts);
        if (typeof parsed.latestTurnLatencyMs === "number")
          setLatestTurnLatencyMs(parsed.latestTurnLatencyMs);
        if (parsed.ntState != null) setNtState(parsed.ntState);
      }
    } catch {
      // sessionStorage can throw in private modes; fall through to empty.
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") === "1") {
      setConversationId(DEMO_CONVERSATION_ID);
      setMessages(DEMO_MESSAGES);
      setFeed(DEMO_FEED.map((event) => ({ seq: seqRef.current++, event })));
    }
    if (params.get("thinking") === "1") {
      setPendingCount(1);
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
        latestTurnThoughts,
        latestTurnLatencyMs,
        ntState,
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [hydrated, conversationId, messages, latestTurnThoughts, latestTurnLatencyMs, ntState]);

  // Single dispatch for every event on Eugene's consciousness stream.
  // Stable (empty deps): reads mutable values through refs and writes
  // through functional setters, so the stream subscription is never torn
  // down by a re-render (which would drop in-flight thoughts).
  const handleStreamEvent = useCallback((e: ConsciousnessEvent) => {
    setFeed((prev) => {
      const next = [...prev, { seq: seqRef.current++, event: e }];
      return next.length > FEED_CAP ? next.slice(next.length - FEED_CAP) : next;
    });

    switch (e.type) {
      case "thought":
        setLatestTurnThoughts((prev) => [...prev, e.data as PassRecord]);
        break;
      case "nt_update":
        setNtState(e.data as NTState);
        break;
      case "focus_switch":
        setFocus((e.data as FocusSwitch).to);
        break;
      case "phase_change":
        setPhase((e.data as PhaseChange).phase);
        break;
      case "speech": {
        // Eugene elected to speak. The reply joins the transcript; if it's
        // reactive to one of our sends (inResponseTo), time + clear it.
        // Self-initiated speech (no/unknown inResponseTo) still appears —
        // Eugene can speak unprompted under the continuous model.
        const act = e.data as EfferentSpeechAct;
        setMessages((prev) => [...prev, { role: "assistant", content: act.content }]);
        if (act.conversationId) setConversationId(act.conversationId);
        const rid = act.inResponseTo;
        if (rid && pendingStartRef.current.has(rid)) {
          const start = pendingStartRef.current.get(rid)!;
          pendingStartRef.current.delete(rid);
          setLatestTurnLatencyMs(Math.round(performance.now() - start));
          setPendingCount((c) => Math.max(0, c - 1));
        }
        break;
      }
      // gate_decision / tool_call / unknown: feed-only (already appended).
      default:
        break;
    }
  }, []);

  const { status: connection } = useConsciousnessStream(setupGate === "ready", handleStreamEvent);

  async function handleSend(text: string) {
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    // A new turn — reset the per-turn chip metadata. Thoughts for this turn
    // accumulate from the stream into this freshly-cleared list.
    setLatestTurnThoughts([]);
    setLatestTurnLatencyMs(null);

    const startMs = performance.now();
    try {
      const { eventId } = await sendMessageEvent({ content: text, conversationId });
      pendingStartRef.current.set(eventId, startMs);
      setPendingCount((c) => c + 1);
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
    }
  }

  function newConversation() {
    // A UI view reset, NOT a consciousness reset: the loop keeps running
    // server-side. We clear the local transcript + the feed view; fresh
    // stream events repopulate the feed as Eugene continues to think.
    setConversationId(null);
    setMessages([]);
    setLatestTurnThoughts([]);
    setLatestTurnLatencyMs(null);
    setFeed([]);
    setError(null);
  }

  async function handleLogout() {
    try {
      await api.delete("watchdog", "/v1/auth/sessions/current");
    } catch {
      // ignore
    }
    clearSessionToken();
    router.push("/login");
  }

  const thinking = pendingCount > 0;
  // Conservative first-turn guard: block a second send only while the very
  // first reply is still pending and no conversationId exists yet —
  // otherwise two no-conversationId sends would spawn two conversations
  // server-side. Once a conversation exists, concurrent sends are fine (the
  // loop queues them), which is the more faithful continuous-model UX.
  const inputDisabled = thinking && conversationId == null;

  const sectionClass =
    "relative flex min-h-0 flex-col border-r border-[color:var(--border)]" +
    (thinking ? " is-thinking" : "");
  const asideClass = "relative flex min-h-0 flex-col" + (thinking ? " is-thinking" : "");
  const railContentClass =
    "relative min-h-0 flex-1 overflow-hidden" + (thinking ? " is-thinking-rail" : "");

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
            <div className="flex flex-col gap-0.5">
              {operatorName && (
                <p className="font-ui text-[11px]">
                  <span className="text-[color:var(--muted)]">talking to </span>
                  <span className="font-medium text-[color:var(--foreground)]">{operatorName}</span>
                </p>
              )}
              <p className="font-ui text-[11px] text-[color:var(--muted)]">
                {conversationId
                  ? `conversation ${conversationId.slice(0, 8)}…`
                  : "no conversation yet"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={newConversation}
              disabled={messages.length === 0}
              className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[color:var(--border)] disabled:hover:bg-transparent"
            >
              New
            </button>
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
            latestPasses={latestTurnThoughts}
            latestVoicePass={null}
            latestTotalLatencyMs={latestTurnLatencyMs}
          />
        </div>

        {error && <div className="status-error border-t px-4 py-2 text-xs">{error}</div>}

        <ChatInput onSend={handleSend} disabled={inputDisabled} />
      </section>

      <aside className={asideClass}>
        <header className="flex items-center justify-between border-b border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3">
          <span className="font-mono text-xs tracking-wider text-[color:var(--muted)] uppercase">
            consciousness
          </span>
          <CopyTraceButton messages={messages} passes={latestTurnThoughts} voicePass={null} />
        </header>
        <div className={railContentClass}>
          <ConsciousnessStream
            items={feed}
            ntState={ntState}
            phase={phase}
            focus={focus}
            connection={connection}
          />
        </div>
      </aside>
    </main>
  );
}
