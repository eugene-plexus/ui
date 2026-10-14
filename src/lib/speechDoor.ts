/**
 * The speech door (`POST /v1/audio/speech`, P3a): the request a form
 * builds, and the audio played back. The voices and formats offered are
 * the model's own listing (`x_eugene_plexus.voices`, `speech_formats`);
 * with none listed, any voice may be typed, since an absent list is a
 * provider that does not say, not one with no voices.
 */

import { wavFromPcm16 } from "./mediaAttachments";
import type { Model } from "./types";

export const SPEECH_FORMATS = ["mp3", "opus", "aac", "flac", "wav", "pcm"] as const;
export type SpeechFormat = (typeof SPEECH_FORMATS)[number];
export const MAX_SPEECH_CHARACTERS = 4096;

export interface SpeechDraft {
  input: string;
  voice: string;
  format: string;
  /** Raw text; empty means not sent. */
  speed: string;
  instructions: string;
}

export const EMPTY_SPEECH_DRAFT: SpeechDraft = {
  input: "Hello from Eugene Plexus.",
  voice: "",
  format: "mp3",
  speed: "",
  instructions: "",
};

export function voicesFor(model: Model | undefined): string[] | null {
  const voices = model?.x_eugene_plexus?.voices;
  return voices && voices.length > 0 ? voices : null;
}

/** How a voice is shown: its name where the provider gives one
 * (`x_eugene_plexus.voice_names`; ElevenLabs' ids say nothing), with the id
 * only when another listed voice shares the name. The id is what is sent. */
export function voiceLabel(model: Model | undefined, id: string): string {
  const names = model?.x_eugene_plexus?.voice_names ?? {};
  const name = names[id];
  if (!name) return id;
  const shared = (model?.x_eugene_plexus?.voices ?? []).some((v) => v !== id && names[v] === name);
  return shared ? `${name} (${id})` : name;
}

export function formatsFor(model: Model | undefined): string[] {
  const listed = model?.x_eugene_plexus?.speech_formats;
  return listed && listed.length > 0 ? [...listed] : [...SPEECH_FORMATS];
}

export type SpeechBody = {
  model: string;
  input: string;
  voice: string;
  response_format: string;
  speed?: number;
  instructions?: string;
};

export function buildSpeechBody(
  model: string,
  draft: SpeechDraft,
): { body: SpeechBody } | { error: string } {
  if (!draft.input.trim()) return { error: "Type something to say." };
  if (draft.input.length > MAX_SPEECH_CHARACTERS) {
    return {
      error: `The text is ${draft.input.length} characters; speech stops at ${MAX_SPEECH_CHARACTERS}.`,
    };
  }
  if (!draft.voice.trim()) return { error: "Pick or type a voice." };
  const body: SpeechBody = {
    model,
    input: draft.input,
    voice: draft.voice.trim(),
    response_format: draft.format,
  };
  if (draft.speed.trim()) {
    const speed = Number(draft.speed);
    if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
      return { error: "Speed must be between 0.25 and 4." };
    }
    body.speed = speed;
  }
  if (draft.instructions.trim()) body.instructions = draft.instructions.trim();
  return { body };
}

const MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
};

/** What a browser can play from the answer's bytes. `pcm` is raw 16-bit
 * mono samples at 24 kHz, played only once a WAV header is in front; the
 * saved file keeps the bytes that came. */
export function speechPlayable(
  format: string,
  bytes: Uint8Array,
): { bytes: Uint8Array; mime: string } {
  if (format === "pcm") return { bytes: wavFromPcm16(bytes), mime: "audio/wav" };
  return { bytes, mime: MIME[format] ?? "application/octet-stream" };
}
