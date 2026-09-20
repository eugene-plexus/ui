"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { ChatLog } from "@/components/ChatLog";
import { describeError } from "@/lib/api";
import { PROXY, streamChatCompletion } from "@/lib/completions";
import { readPlaygroundTranscript, writePlaygroundTranscript } from "@/lib/playgroundTranscript";
import type { ChatCompletionMessage, Model } from "@/lib/types";

// The playground's ceiling, for the same reason: past this something is
// wedged and the person wants an error rather than a spinner.
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

/** What served the last turn, for the one line under the reply. */
interface TurnInfo {
  model: string | null;
  driver: string | null;
  seconds: number | null;
}

/**
 * "Try it": the playground's first line, on Home.
 *
 * Hobbyist UX §6.1: *"Try it on Home IS the composer, wired to the same
 * code; a first reply lands on Home, not on a screen the user had to
 * find."* P1 — time to first token — is the metric this card exists for.
 *
 * Same send path as the playground (`streamChatCompletion` through the
 * proxy), same stored transcript (`lib/playgroundTranscript.ts`), so
 * "Continue in the Playground" opens the conversation that just
 * happened. What is deliberately NOT here: the diagnostic panel, tools,
 * attachments, the request report, regenerate and edit. Those answer
 * *why*; this card answers *whether*, and a person who wants the rest
 * is one click from it.
 */
export function TryItCard({ models }: { models: Model[] }) {
  const [messages, setMessages] = useState<ChatCompletionMessage[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turn, setTurn] = useState<TurnInfo | null>(null);

  // The stored conversation, read after mount so the first render matches
  // the exported HTML. The playground's own pick is honoured when it is
  // still routable; the effect below falls back to the first otherwise.
  useEffect(() => {
    const stored = readPlaygroundTranscript();
    setMessages(stored.messages);
    setModel(stored.model);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    setModel((current) =>
      current && models.some((m) => m.id === current) ? current : (models[0]?.id ?? null),
    );
  }, [hydrated, models]);

  useEffect(() => {
    if (!hydrated) return;
    writePlaygroundTranscript({ model, messages });
  }, [hydrated, model, messages]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const content = text.trim();
    if (!content || pending || !model) return;
    setText("");
    setError(null);
    setTurn(null);
    const outgoing: ChatCompletionMessage[] = [...messages, { role: "user", content }];
    setMessages(outgoing);
    setPending(true);
    try {
      // Appended empty and grown in place, as the playground does: the
      // reply appears as it is generated, which is what a first token
      // looks like to the person waiting for one.
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
          model,
          messages: outgoing,
          timeoutMs: REQUEST_TIMEOUT_MS,
          transport: PROXY,
        },
        (delta) => {
          streamed += delta;
          upsert({ role: "assistant", content: streamed });
        },
      );
      const choice = response.choices?.[0];
      if (choice) upsert(choice.message);
      if (response.truncatedBy) setError(`The answer was cut short: ${response.truncatedBy}`);
      const latency = response.x_eugene_plexus?.latency_ms ?? response.report.elapsedMs;
      setTurn({
        model: response.model ?? model,
        driver: response.x_eugene_plexus?.driver ?? null,
        seconds: latency != null ? latency / 1000 : null,
      });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setPending(false);
    }
  }

  const disabled = pending || model === null;
  return (
    <section
      data-testid="home-try-it"
      className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-ui text-base font-semibold">Try it</h2>
        <Link href="/playground" className="font-ui text-xs underline" data-testid="home-continue">
          Continue in the Playground
        </Link>
      </div>
      <form onSubmit={send} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <select
          value={model ?? ""}
          onChange={(e) => setModel(e.target.value)}
          disabled={pending}
          aria-label="Model"
          data-testid="home-model"
          className="font-ui max-w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-2 text-xs outline-none hover:border-[color:var(--border-hover)] disabled:opacity-50 sm:max-w-[220px]"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={disabled}
          placeholder={pending ? "Answering…" : "Say something…"}
          aria-label="Message"
          data-testid="home-composer"
          className="min-w-0 flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm transition-colors outline-none hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || text.trim() === ""}
          className="font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-4 py-2 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:brightness-100"
        >
          Send
        </button>
      </form>
      {messages.length > 0 && (
        <div className="mt-3 h-64 overflow-hidden rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)]">
          <ChatLog messages={messages} pending={pending} />
        </div>
      )}
      {turn && (
        <p
          data-testid="home-turn-info"
          className="mt-2 font-mono text-[0.6875rem] text-[color:var(--muted)]"
        >
          {[turn.model, turn.driver, turn.seconds !== null ? `${turn.seconds.toFixed(1)} s` : null]
            .filter((part): part is string => part !== null)
            .join(" · ")}
        </p>
      )}
      {error && (
        <p className="status-error mt-2 rounded-[var(--radius)] border px-3 py-2 text-xs">
          {error}
        </p>
      )}
    </section>
  );
}
