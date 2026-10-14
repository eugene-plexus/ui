/**
 * The transcription door: a recording to text (`POST
 * /v1/audio/transcriptions`, P3b), or to English text (`POST
 * /v1/audio/translations`, P3-4). A multipart form, as the OpenAI SDK
 * sends it; `srt` and `vtt` are not offered because the gateway refuses
 * them.
 */

import type { FormField } from "./doorRequest";
import type { Model } from "./types";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export type Task = "transcribe" | "translate";
export const RESPONSE_FORMATS = ["json", "text", "verbose_json"] as const;

export interface TranscriptionDraft {
  task: Task;
  language: string;
  prompt: string;
  responseFormat: string;
  /** Raw text; empty means not sent. */
  temperature: string;
}

export const EMPTY_TRANSCRIPTION_DRAFT: TranscriptionDraft = {
  task: "transcribe",
  language: "",
  prompt: "",
  responseFormat: "json",
  temperature: "",
};

export function pathFor(task: Task): string {
  return task === "translate" ? "/v1/audio/translations" : "/v1/audio/transcriptions";
}

/** The models a task can be sent to: translation is its own surface. */
export function modelsForTask(models: readonly Model[], task: Task): Model[] {
  const surface = task === "translate" ? "translation" : "transcription";
  return models.filter((m) => m.x_eugene_plexus?.surfaces?.includes(surface));
}

export function buildTranscriptionForm(
  model: string,
  draft: TranscriptionDraft,
  file: File | null,
): { form: FormData; fields: FormField[] } | { error: string } {
  if (!file) return { error: "Choose a recording." };
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      error: `${file.name} is ${(file.size / 1_048_576).toFixed(1)} MB; a recording stops at 25 MB.`,
    };
  }
  const form = new FormData();
  const fields: FormField[] = [];
  const add = (name: string, value: string) => {
    form.append(name, value);
    fields.push({ name, value });
  };
  form.append("file", file, file.name);
  fields.push({ name: "file", file: file.name });
  add("model", model);
  // A translation takes no language: the answer is always English.
  if (draft.task === "transcribe" && draft.language.trim()) add("language", draft.language.trim());
  if (draft.prompt.trim()) add("prompt", draft.prompt.trim());
  add("response_format", draft.responseFormat);
  if (draft.temperature.trim()) {
    const t = Number(draft.temperature);
    if (!Number.isFinite(t) || t < 0 || t > 1)
      return { error: "Temperature must be between 0 and 1." };
    add("temperature", String(t));
  }
  return { form, fields };
}

export interface TranscriptionAnswer {
  text: string;
  language: string | null;
  duration: number | null;
  segments: number | null;
  /** The answer as it came, for the raw view. */
  raw: string;
}

/** The text, and what a verbose answer says besides, read the way the
 * format asked for it: `text` is the words themselves. */
export function readTranscriptionAnswer(format: string, raw: string): TranscriptionAnswer {
  if (format === "text") return { text: raw, language: null, duration: null, segments: null, raw };
  const body = JSON.parse(raw) as {
    text?: string;
    language?: string;
    duration?: number;
    segments?: unknown[];
  };
  return {
    text: body.text ?? "",
    language: body.language ?? null,
    duration: typeof body.duration === "number" ? body.duration : null,
    segments: Array.isArray(body.segments) ? body.segments.length : null,
    raw,
  };
}
