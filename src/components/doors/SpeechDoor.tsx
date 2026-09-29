"use client";

/**
 * The speech door: text in, audio out (`POST /v1/audio/speech`, P3a).
 * The answer is played in place and offered as a file; what served it
 * comes from the response headers, since the body is the audio.
 */

import { useEffect, useRef, useState } from "react";

import type { Transport } from "@/lib/completions";
import {
  type DoorReport as Report,
  extensionFor,
  newDoorReport,
  recordDoorFailure,
  sendToDoor,
} from "@/lib/doorRequest";
import { bytesToBase64 } from "@/lib/imageAttachments";
import {
  EMPTY_SPEECH_DRAFT,
  type SpeechDraft,
  buildSpeechBody,
  formatsFor,
  speechPlayable,
  voicesFor,
} from "@/lib/speechDoor";
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
  textareaClass,
  writeDraft,
} from "./doorStyles";

const DRAFT_KEY = "eugene-playground-door-speech";

interface Clip {
  /** Plays in place. */
  playUrl: string;
  /** The bytes that came, as a file. */
  saveUrl: string;
  fileName: string;
  bytes: number;
}

export function SpeechDoor({
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
  // Read when the state is made: an effect would run after the first
  // paint and overwrite whatever was chosen before it did.
  const [draft, setDraft] = useState<SpeechDraft>(() => readDraft(DRAFT_KEY, EMPTY_SPEECH_DRAFT));
  const [pending, setPending] = useState(false);
  const [clip, setClip] = useState<Clip | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    writeDraft(DRAFT_KEY, draft);
  }, [draft]);
  useEffect(() => {
    setModel((current) => keepModel(models, current));
  }, [models]);

  const selected = models.find((m) => m.id === model);
  const voices = voicesFor(selected);
  const formats = formatsFor(selected);
  // Keep the choices inside what this model lists: a format or voice
  // picked for another model reads as this one's first. Worked out here
  // rather than synced in an effect, so what is shown is what is sent.
  const effective: SpeechDraft = {
    ...draft,
    format: formats.includes(draft.format) ? draft.format : (formats[0] ?? "mp3"),
    voice: voices && !voices.includes(draft.voice) ? (voices[0] ?? "") : draft.voice,
  };

  const built = buildSpeechBody(model, effective);

  async function send() {
    if ("error" in built) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const payload = { kind: "json" as const, body: built.body };
    const next = newDoorReport(transport, "/v1/audio/speech", payload, reproduceBaseUrl);
    setPending(true);
    setError(null);
    setClip(null);
    const started = performance.now();
    try {
      const response = await sendToDoor(transport, "/v1/audio/speech", payload, next, {
        accept: "audio/*",
        signal: controller.signal,
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      next.firstByteMs = Math.round(performance.now() - started);
      next.bytes = bytes.length;
      const playable = speechPlayable(built.body.response_format, bytes);
      const saveType = next.contentType ?? playable.mime;
      setClip({
        playUrl: `data:${playable.mime};base64,${bytesToBase64(playable.bytes)}`,
        saveUrl: `data:${saveType};base64,${bytesToBase64(bytes)}`,
        fileName: `speech.${built.body.response_format === "pcm" ? "pcm" : extensionFor(saveType)}`,
        bytes: bytes.length,
      });
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
    <div data-testid="speech-door" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <DoorModelSelect models={models} value={model} onChange={setModel} disabled={pending} />
          <label className={fieldLabel}>
            <span className="text-[color:var(--muted)]">Voice</span>
            {voices ? (
              <select
                data-testid="speech-voice"
                value={effective.voice}
                onChange={(e) => setDraft({ ...draft, voice: e.target.value })}
                className={inputClass}
              >
                {voices.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            ) : (
              <input
                data-testid="speech-voice"
                value={effective.voice}
                onChange={(e) => setDraft({ ...draft, voice: e.target.value })}
                placeholder="alloy"
                className={`${inputClass} w-32`}
                title="This model lists no voices, so any name is passed through as typed"
              />
            )}
          </label>
          <label className={fieldLabel}>
            <span className="text-[color:var(--muted)]">Format</span>
            <select
              data-testid="speech-format"
              value={effective.format}
              onChange={(e) => setDraft({ ...draft, format: e.target.value })}
              className={inputClass}
            >
              {formats.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldLabel}>
            <span className="text-[color:var(--muted)]">Speed</span>
            <input
              data-testid="speech-speed"
              value={draft.speed}
              onChange={(e) => setDraft({ ...draft, speed: e.target.value })}
              placeholder="1"
              inputMode="decimal"
              className={`${inputClass} w-20`}
            />
          </label>
        </div>
        <label className={fieldLabel}>
          <span className="text-[color:var(--muted)]">Text to say</span>
          <textarea
            data-testid="speech-input"
            value={draft.input}
            onChange={(e) => setDraft({ ...draft, input: e.target.value })}
            rows={4}
            className={textareaClass}
          />
        </label>
        <label className={fieldLabel}>
          <span className="text-[color:var(--muted)]">How to say it (optional)</span>
          <input
            data-testid="speech-instructions"
            value={draft.instructions}
            onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
            placeholder="cheerful and slow"
            className={inputClass}
          />
        </label>
        {"error" in built && <p className={errorClass}>{built.error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="speech-send"
            onClick={() => void send()}
            disabled={pending || !model || "error" in built}
            className={primaryButtonClass}
          >
            Speak
          </button>
          {pending && (
            <button type="button" onClick={() => abortRef.current?.abort()} className={buttonClass}>
              Stop
            </button>
          )}
        </div>
        {error && (
          <p role="alert" data-testid="speech-error" className={errorClass}>
            {error}
          </p>
        )}
        {clip && (
          <div className="flex flex-wrap items-center gap-3">
            <audio data-testid="speech-audio" controls src={clip.playUrl} className="max-w-full" />
            <a
              data-testid="speech-download"
              href={clip.saveUrl}
              download={clip.fileName}
              className={buttonClass}
            >
              Save {clip.fileName}
            </a>
          </div>
        )}
      </div>
      {report && <DoorReport report={report} apiKey={apiKey} />}
    </div>
  );
}
