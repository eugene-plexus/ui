"use client";

/**
 * The transcription door: a recording to text, or to English text
 * (`/v1/audio/transcriptions`, `/v1/audio/translations`). Translate is
 * offered only when some model lists the `translation` surface.
 */

import { useEffect, useRef, useState } from "react";

import type { Transport } from "@/lib/completions";
import {
  type DoorReport as Report,
  newDoorReport,
  recordDoorFailure,
  sendToDoor,
} from "@/lib/doorRequest";
import {
  EMPTY_TRANSCRIPTION_DRAFT,
  RESPONSE_FORMATS,
  type Task,
  type TranscriptionAnswer,
  type TranscriptionDraft,
  buildTranscriptionForm,
  modelsForTask,
  pathFor,
  readTranscriptionAnswer,
} from "@/lib/transcriptionDoor";
import type { Model } from "@/lib/types";

import { DoorModelSelect, keepModel } from "./DoorModelSelect";
import { DoorReport } from "./DoorReport";
import {
  buttonClass,
  errorClass,
  fieldLabel,
  inputClass,
  primaryButtonClass,
  readDraft,
  writeDraft,
} from "./doorStyles";

const DRAFT_KEY = "eugene-playground-door-transcription";

export function TranscriptionDoor({
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
  // Read when the state is made: an effect would run after the first
  // paint and overwrite whatever was chosen before it did.
  const [draft, setDraft] = useState<TranscriptionDraft>(() =>
    readDraft(DRAFT_KEY, EMPTY_TRANSCRIPTION_DRAFT),
  );
  const [file, setFile] = useState<File | null>(null);
  const [model, setModel] = useState("");
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<TranscriptionAnswer | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    writeDraft(DRAFT_KEY, draft);
  }, [draft]);

  const translates = modelsForTask(models, "translate").length > 0;
  const task: Task = draft.task === "translate" && translates ? "translate" : "transcribe";
  const taskModels = modelsForTask(models, task);
  useEffect(() => {
    setModel((current) => keepModel(taskModels, current));
    // `taskModels` is rebuilt every render; the task and the list's ids decide.
  }, [task, taskModels.map((m) => m.id).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const built = buildTranscriptionForm(model, { ...draft, task }, file);

  async function send() {
    if ("error" in built) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const path = pathFor(task);
    const payload = { kind: "form" as const, form: built.form, fields: built.fields };
    const next = newDoorReport(transport, path, payload, reproduceBaseUrl);
    setPending(true);
    setError(null);
    setAnswer(null);
    const started = performance.now();
    try {
      const response = await sendToDoor(transport, path, payload, next, {
        accept: draft.responseFormat === "text" ? "text/plain" : "application/json",
        signal: controller.signal,
      });
      const raw = await response.text();
      next.firstByteMs = Math.round(performance.now() - started);
      next.bytes = new TextEncoder().encode(raw).length;
      setAnswer(readTranscriptionAnswer(draft.responseFormat, raw));
    } catch (e) {
      if (controller.signal.aborted) {
        setError("Stopped.");
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

  return (
    <div data-testid="transcription-door" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-3 p-4">
        {translates && (
          <div role="radiogroup" aria-label="What to do" className="flex gap-3 text-sm">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                data-testid="task-transcribe"
                checked={task === "transcribe"}
                onChange={() => setDraft({ ...draft, task: "transcribe" })}
              />
              Write down what was said
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                data-testid="task-translate"
                checked={task === "translate"}
                onChange={() => setDraft({ ...draft, task: "translate" })}
              />
              Translate it into English
            </label>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <DoorModelSelect
            models={taskModels}
            value={model}
            onChange={setModel}
            disabled={pending}
          />
          <label className={fieldLabel}>
            <span className="text-[color:var(--muted)]">Answer as</span>
            <select
              data-testid="transcription-format"
              value={draft.responseFormat}
              onChange={(e) => setDraft({ ...draft, responseFormat: e.target.value })}
              className={inputClass}
            >
              {RESPONSE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          {task === "transcribe" && (
            <label className={fieldLabel}>
              <span className="text-[color:var(--muted)]">Language</span>
              <input
                data-testid="transcription-language"
                value={draft.language}
                onChange={(e) => setDraft({ ...draft, language: e.target.value })}
                placeholder="detect"
                className={`${inputClass} w-24`}
              />
            </label>
          )}
          <label className={fieldLabel}>
            <span className="text-[color:var(--muted)]">Temperature</span>
            <input
              data-testid="transcription-temperature"
              value={draft.temperature}
              onChange={(e) => setDraft({ ...draft, temperature: e.target.value })}
              placeholder="default"
              inputMode="decimal"
              className={`${inputClass} w-24`}
            />
          </label>
        </div>
        <label className={fieldLabel}>
          <span className="text-[color:var(--muted)]">Recording (up to 25 MB)</span>
          <input
            data-testid="transcription-file"
            type="file"
            accept="audio/*,video/mp4,video/webm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
        </label>
        <label className={fieldLabel}>
          <span className="text-[color:var(--muted)]">Hint for spelling and style (optional)</span>
          <input
            data-testid="transcription-prompt"
            value={draft.prompt}
            onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
            className={inputClass}
          />
        </label>
        {"error" in built && file && <p className={errorClass}>{built.error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="transcription-send"
            onClick={() => void send()}
            disabled={pending || !model || "error" in built}
            className={primaryButtonClass}
          >
            {task === "translate" ? "Translate" : "Transcribe"}
          </button>
          {pending && (
            <button type="button" onClick={() => abortRef.current?.abort()} className={buttonClass}>
              Stop
            </button>
          )}
        </div>
        {error && (
          <p role="alert" data-testid="transcription-error" className={errorClass}>
            {error}
          </p>
        )}
        {answer && (
          <div className="flex flex-col gap-2">
            <p
              data-testid="transcription-text"
              className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] p-3 text-sm whitespace-pre-wrap"
            >
              {answer.text || "No words were heard."}
            </p>
            {(answer.language || answer.duration !== null || answer.segments !== null) && (
              <p data-testid="transcription-meta" className="text-sm text-[color:var(--muted)]">
                {[
                  answer.language && `Language: ${answer.language}`,
                  answer.duration !== null && `${answer.duration.toFixed(1)} s of audio`,
                  answer.segments !== null && `${answer.segments} segments`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            <button
              type="button"
              onClick={() => setShowRaw((s) => !s)}
              className={`${buttonClass} self-start`}
            >
              {showRaw ? "Hide the answer as sent" : "Show the answer as sent"}
            </button>
            {showRaw && (
              <pre className="max-h-60 overflow-auto rounded-[var(--radius)] bg-[color:var(--panel-soft)] p-2 font-mono text-xs whitespace-pre-wrap">
                {answer.raw}
              </pre>
            )}
          </div>
        )}
      </div>
      {report && <DoorReport report={report} apiKey={apiKey} />}
    </div>
  );
}
