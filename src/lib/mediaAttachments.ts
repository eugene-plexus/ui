/**
 * Audio and PDF attachments, and spoken replies -- the pure half (U2 of
 * `playground-doors.md`).
 *
 * The contract (`MessageContent`, P2a): an `input_audio` part carries a
 * WAV or MP3 as bare base64 with its format named; a `file` part carries
 * a PDF as a `data:application/pdf;base64,` URL. Each at most 10 MiB
 * decoded, and every attachment in a request together -- images
 * included -- at most 11 MiB, which is what fits the 16 MiB JSON body
 * once base64 has grown it. The gateway checks the bytes against the
 * format; so does this, so the refusal names the file before megabytes
 * cross the wire.
 *
 * A spoken reply (P2b) streams as base64 fragments of `pcm16`: raw
 * 16-bit little-endian mono samples at 24 kHz, which no browser plays
 * until a WAV header is put in front. `format` on the answer is what
 * the bytes are, so an MP3 (Lyria) is played as the MP3 it is.
 */

import { bytesToBase64 } from "./imageAttachments";
import type { ImageAttachment } from "./imageAttachments";
import type { MessageContentPart } from "./types";

export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
export const MAX_ALL_ATTACHMENT_BYTES = 11 * 1024 * 1024;
/** OpenAI's `pcm16`, and what the driver wraps as WAV (`audio_out.py`). */
export const PCM16_RATE = 24_000;

export type AudioFormat = "wav" | "mp3";

export interface AudioAttachment {
  name: string;
  format: AudioFormat;
  size: number;
  /** Bare base64, no `data:` prefix: OpenAI's `input_audio.data`. */
  base64: string;
}

export interface PdfAttachment {
  name: string;
  size: number;
  /** `data:application/pdf;base64,...`, the form OpenRouter accepts. */
  dataUrl: string;
}

/** What the bytes are, read the way the gateway reads them: a WAV is
 * `RIFF....WAVE`; an MP3 has an ID3 tag or a frame sync. */
export function sniffAudio(bytes: Uint8Array): AudioFormat | null {
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  ) {
    return "wav";
  }
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33)
    return "mp3";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return "mp3";
  return null;
}

export function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

/** Whether a picked file should take the audio path: by its type or its
 * name, since a browser often reports an MP3 as `audio/mpeg` and a WAV
 * as `audio/wav`, `audio/x-wav` or nothing. */
export function looksLikeAudio(name: string, type: string): boolean {
  return type.startsWith("audio/") || /\.(wav|mp3)$/i.test(name);
}

export function looksLikePdf(name: string, type: string): boolean {
  return type === "application/pdf" || /\.pdf$/i.test(name);
}

function megabytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/** The audio part, or a sentence naming the file and what is wrong. */
export function readAudioAttachment(name: string, bytes: Uint8Array): AudioAttachment | string {
  const format = sniffAudio(bytes);
  if (format === null)
    return `${name} is not a WAV or MP3 recording. Those are the two a model can hear.`;
  if (bytes.length > MAX_MEDIA_BYTES)
    return `${name} is ${megabytes(bytes.length)}; a recording stops at 10 MB.`;
  return { name, format, size: bytes.length, base64: bytesToBase64(bytes) };
}

export function readPdfAttachment(name: string, bytes: Uint8Array): PdfAttachment | string {
  if (!isPdf(bytes))
    return `${name} does not begin like a PDF. Only PDF documents can be attached.`;
  if (bytes.length > MAX_MEDIA_BYTES)
    return `${name} is ${megabytes(bytes.length)}; a document stops at 10 MB.`;
  return {
    name,
    size: bytes.length,
    dataUrl: `data:application/pdf;base64,${bytesToBase64(bytes)}`,
  };
}

/** The request-wide limit, across images, recordings and documents. */
export function checkAllAttachments(sizes: ReadonlyArray<{ size: number }>): string | null {
  const total = sizes.reduce((sum, a) => sum + a.size, 0);
  if (total > MAX_ALL_ATTACHMENT_BYTES) {
    return `The attachments total ${megabytes(total)}; a request stops at 11 MB altogether.`;
  }
  return null;
}

/**
 * Text plus every attachment, as the wire carries them. **A message
 * with none stays a plain string**, so every text request is exactly
 * what it was. With attachments the text comes first, then images,
 * recordings and documents in the order they were attached.
 */
export function buildMessageParts(
  text: string,
  images: ReadonlyArray<ImageAttachment>,
  audio: ReadonlyArray<AudioAttachment>,
  pdfs: ReadonlyArray<PdfAttachment>,
): string | MessageContentPart[] {
  if (images.length === 0 && audio.length === 0 && pdfs.length === 0) return text;
  const parts: MessageContentPart[] = [];
  if (text !== "") parts.push({ type: "text", text });
  for (const image of images) parts.push({ type: "image_url", image_url: { url: image.dataUrl } });
  for (const clip of audio) {
    parts.push({ type: "input_audio", input_audio: { data: clip.base64, format: clip.format } });
  }
  for (const pdf of pdfs)
    parts.push({ type: "file", file: { filename: pdf.name, file_data: pdf.dataUrl } });
  return parts;
}

// --- spoken replies ----------------------------------------------------

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Joins the base64 fragments of a streamed reply into one base64 string.
 * Fragments are decoded first: two base64 strings do not concatenate
 * into the base64 of both unless the first ends on a three-byte edge. */
export function joinBase64(fragments: readonly string[]): string {
  const chunks = fragments.map(base64ToBytes);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return bytesToBase64(out);
}

/** A 44-byte WAV header in front of 16-bit mono PCM. */
export function wavFromPcm16(pcm: Uint8Array, rate = PCM16_RATE): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) out[at + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/** What a browser can play, from a reply's format and base64 bytes. */
export function playableAudio(format: string, b64: string): { bytes: Uint8Array; mime: string } {
  const bytes = base64ToBytes(b64);
  if (format === "pcm16") return { bytes: wavFromPcm16(bytes), mime: "audio/wav" };
  const mime: Record<string, string> = {
    wav: "audio/wav",
    mp3: "audio/mpeg",
    flac: "audio/flac",
    opus: "audio/ogg",
    aac: "audio/aac",
  };
  return { bytes, mime: mime[format] ?? "application/octet-stream" };
}
