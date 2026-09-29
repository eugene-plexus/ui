"use client";

/**
 * The completions door: a prompt continued as written, or the middle
 * filled in (`POST /v1/completions`, P6b). What a code editor's
 * autocomplete sends, tried by hand.
 *
 * The answer is shown between the prompt and the suffix, the way an
 * editor would place it, so "did it fill the gap" is visible at a glance.
 */

import { useEffect, useRef, useState } from "react";

import {
  type CompletionAnswer,
  type CompletionDraft,
  EMPTY_COMPLETION_DRAFT,
  answerFromBody,
  buildCompletionBody,
  readCompletionStream,
  suffixWarning,
} from "@/lib/completionDoor";
import type { Transport } from "@/lib/completions";
import {
  type DoorReport as Report,
  newDoorReport,
  recordDoorFailure,
  sendToDoor,
} from "@/lib/doorRequest";
import type { Model } from "@/lib/types";

import { DoorModelSelect, keepModel } from "./DoorModelSelect";
import { DoorReport } from "./DoorReport";
import {
  buttonClass,
  errorClass,
  fieldLabel,
  inputClass,
  noteClass,
  primaryButtonClass,
  readDraft,
  textareaClass,
  writeDraft,
} from "./doorStyles";

const DRAFT_KEY = "eugene-playground-door-completion";

export function CompletionDoor({
  models,
  transport,
  reproduceBaseUrl,
  apiKey,
}: {
  models: readonly Model[];
  transport: Transport;
  reproduceBaseUrl: string | null;
  apiKey: string | null;
}) {
  const [model, setModel] = useState(models[0]?.id ?? "");
  const [draft, setDraft] = useState<CompletionDraft>(EMPTY_COMPLETION_DRAFT);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<CompletionAnswer | null>(null);
  const [streamed, setStreamed] = useState("");
  const [sentPrompt, setSentPrompt] = useState<{ prompt: string; suffix: string } | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setDraft(readDraft(DRAFT_KEY, EMPTY_COMPLETION_DRAFT));
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) writeDraft(DRAFT_KEY, draft);
  }, [loaded, draft]);
  useEffect(() => {
    setModel((current) => keepModel(models, current));
  }, [models]);

  const selected = models.find((m) => m.id === model);
  const built = buildCompletionBody(model, draft);
  const warning = suffixWarning(draft.suffix, selected?.x_eugene_plexus?.fill_in_middle);

  async function send() {
    if ("error" in built) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const payload = { kind: "json" as const, body: built.body };
    const next = newDoorReport(transport, "/v1/completions", payload, reproduceBaseUrl);
    setPending(true);
    setError(null);
    setAnswer(null);
    setStreamed("");
    setSentPrompt({ prompt: built.body.prompt, suffix: built.body.suffix ?? "" });
    const started = performance.now();
    try {
      const response = await sendToDoor(transport, "/v1/completions", payload, next, {
        accept: built.body.stream ? "text/event-stream" : "application/json",
        signal: controller.signal,
      });
      let result: CompletionAnswer;
      if (built.body.stream) {
        result = await readCompletionStream(response, next, started, (piece) =>
          setStreamed((s) => s + piece),
        );
      } else {
        const text = await response.text();
        next.bytes = new TextEncoder().encode(text).length;
        next.firstByteMs = Math.round(performance.now() - started);
        result = answerFromBody(JSON.parse(text));
      }
      next.routing = result.routing ?? next.routing;
      setAnswer(result);
      if (result.truncatedBy) setError(`Cut short: ${result.truncatedBy}`);
    } catch (e) {
      if (controller.signal.aborted) {
        setError("Stopped. What arrived is kept.");
      } else {
        recordDoorFailure(next, e);
        setError(next.error);
      }
    } finally {
      next.elapsedMs = Math.round(performance.now() - started);
      setReport(next);
      setPending(false);
      abortRef.current = null;
    }
  }

  const shown = answer?.text ?? streamed;
  return (
    <div data-testid="completion-door" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <DoorModelSelect models={models} value={model} onChange={setModel} disabled={pending} />
          <label className={fieldLabel}>
            <span className="text-[color:var(--muted)]">Max tokens</span>
            <input
              data-testid="completion-max-tokens"
              value={draft.maxTokens}
              onChange={(e) => setDraft({ ...draft, maxTokens: e.target.value })}
              inputMode="numeric"
              className={`${inputClass} w-24`}
            />
          </label>
          <label className={fieldLabel}>
            <span className="text-[color:var(--muted)]">Temperature</span>
            <input
              data-testid="completion-temperature"
              value={draft.temperature}
              onChange={(e) => setDraft({ ...draft, temperature: e.target.value })}
              placeholder="default"
              inputMode="decimal"
              className={`${inputClass} w-24`}
            />
          </label>
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              data-testid="completion-stream"
              checked={draft.stream}
              onChange={(e) => setDraft({ ...draft, stream: e.target.checked })}
            />
            Stream
          </label>
        </div>
        <label className={fieldLabel}>
          <span className="text-[color:var(--muted)]">Prompt, continued exactly as written</span>
          <textarea
            data-testid="completion-prompt"
            value={draft.prompt}
            onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
            rows={6}
            className={textareaClass}
          />
        </label>
        <label className={fieldLabel}>
          <span className="text-[color:var(--muted)]">
            Suffix, the text after the gap (leave empty to continue the prompt only)
          </span>
          <textarea
            data-testid="completion-suffix"
            value={draft.suffix}
            onChange={(e) => setDraft({ ...draft, suffix: e.target.value })}
            rows={3}
            className={textareaClass}
          />
        </label>
        {warning && (
          <p data-testid="completion-warning" className={noteClass}>
            {warning}
          </p>
        )}
        {"error" in built && draft.prompt && <p className={errorClass}>{built.error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="completion-send"
            onClick={() => void send()}
            disabled={pending || !model || "error" in built}
            className={primaryButtonClass}
          >
            Send
          </button>
          {pending && (
            <button
              type="button"
              data-testid="completion-stop"
              onClick={() => abortRef.current?.abort()}
              className={buttonClass}
            >
              Stop
            </button>
          )}
        </div>
        {error && (
          <p role="alert" data-testid="completion-error" className={errorClass}>
            {error}
          </p>
        )}
        {sentPrompt && (shown || pending) && (
          <pre
            data-testid="completion-result"
            className="overflow-auto rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] p-3 font-mono text-sm whitespace-pre-wrap"
          >
            <span className="text-[color:var(--muted)]">{sentPrompt.prompt}</span>
            <mark
              data-testid="completion-answer"
              className="bg-[color:var(--panel-hover)] text-[color:var(--foreground)]"
            >
              {shown}
            </mark>
            <span className="text-[color:var(--muted)]">{sentPrompt.suffix}</span>
          </pre>
        )}
        {answer && (
          <p data-testid="completion-finish" className="text-sm text-[color:var(--muted)]">
            {answer.finishReason === "length"
              ? "Stopped at the token limit."
              : answer.finishReason === "stop"
                ? "Finished."
                : `Finish: ${answer.finishReason ?? "not given"}.`}
            {answer.usage?.completion_tokens != null
              ? ` ${answer.usage.completion_tokens} tokens written from ${answer.usage.prompt_tokens ?? "?"} read.`
              : ""}
          </p>
        )}
      </div>
      {report && <DoorReport report={report} apiKey={apiKey || null} />}
    </div>
  );
}
