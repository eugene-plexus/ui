"use client";

import Link from "next/link";
import { useState } from "react";

import { ChatInput } from "@/components/ChatInput";
import { ChatLog } from "@/components/ChatLog";
import { HemisphereRail } from "@/components/HemisphereRail";
import { ApiError, api } from "@/lib/api";
import type { ChatRequest, ChatResponse, Message, PassRecord } from "@/lib/types";

export default function ChatPage() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [latestPasses, setLatestPasses] = useState<PassRecord[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setLatestPasses([]);
    setError(null);
  }

  return (
    <main className="grid h-screen grid-cols-[1fr_400px]">
      <section className="flex flex-col border-r border-[color:var(--border)]">
        <header className="flex items-center justify-between border-b border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3">
          <div>
            <h1 className="text-sm font-semibold tracking-wide">Eugene</h1>
            <p className="text-[11px] text-[color:var(--muted)]">
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
              className="rounded border border-[color:var(--border)] px-3 py-1 text-xs disabled:opacity-30"
            >
              New
            </button>
            <Link
              href="/config"
              className="rounded border border-[color:var(--border)] px-3 py-1 text-xs text-[color:var(--foreground)]"
            >
              Config
            </Link>
          </div>
        </header>

        <div className="flex-1 overflow-hidden">
          <ChatLog messages={messages} />
        </div>

        {error && (
          <div className="border-t border-rose-900 bg-rose-950/40 px-4 py-2 text-xs text-rose-300">
            {error}
          </div>
        )}

        <ChatInput onSend={handleSend} disabled={pending} />
      </section>

      <aside className="flex flex-col bg-[color:var(--background)]">
        <header className="border-b border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3 font-mono text-xs tracking-wider text-[color:var(--muted)] uppercase">
          hemispheres
        </header>
        <div className="flex-1 overflow-hidden">
          <HemisphereRail passes={latestPasses} />
        </div>
      </aside>
    </main>
  );
}
