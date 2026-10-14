/**
 * The images door (`POST /v1/images/generations` and `/edits`, P4): the
 * request a form builds, and the pictures read back, streamed or not.
 *
 * An edit is the OpenAI SDK's multipart form: one reference image as
 * `image`, several as `image[]` once each, and a `mask` where the model
 * lists `image_mask`. Every answer is `b64_json` (P4-1). A stream is SSE
 * events: `*.partial_image` while it draws, `*.completed` per finished
 * picture (the last carrying `usage` and `x_eugene_plexus`), or `error`
 * when a backend stops after the first.
 *
 * Streaming, editing and a mask are offered only where the model's
 * listing says so (`image_streaming`, `image_edits`, `image_mask`); the
 * form sends none of them for a model that does not list it.
 */

import type { FormField } from "./doorRequest";
import { sseEvents } from "./sse";

export type ImageMode = "generate" | "edit";
export const IMAGE_QUALITIES = ["auto", "low", "medium", "high", "standard", "hd"] as const;
export const IMAGE_OUTPUT_FORMATS = ["png", "jpeg", "webp"] as const;

export interface ImageDraft {
  mode: ImageMode;
  prompt: string;
  /** Raw text; empty means not sent. */
  n: string;
  size: string;
  /** Empty means not sent. */
  quality: string;
  outputFormat: string;
  stream: boolean;
  partialImages: string;
}

export const EMPTY_IMAGE_DRAFT: ImageDraft = {
  mode: "generate",
  prompt: "A red fox asleep in fresh snow, soft morning light",
  n: "",
  size: "",
  quality: "",
  outputFormat: "",
  stream: false,
  partialImages: "",
};

type Settings = Record<string, string | number | boolean>;

/** The fields the two modes share, or a sentence naming the bad one. */
function settings(draft: ImageDraft): { values: Settings } | { error: string } {
  if (!draft.prompt.trim()) return { error: "Describe the picture." };
  const values: Settings = {};
  if (draft.n.trim()) {
    const n = Number(draft.n);
    if (!Number.isInteger(n) || n < 1 || n > 10)
      return { error: "Pictures must be a whole number from 1 to 10." };
    values.n = n;
  }
  if (draft.size.trim()) values.size = draft.size.trim();
  if (draft.quality) values.quality = draft.quality;
  if (draft.outputFormat) values.output_format = draft.outputFormat;
  if (draft.stream) {
    values.stream = true;
    if (draft.partialImages.trim()) {
      const p = Number(draft.partialImages);
      if (!Number.isInteger(p) || p < 0 || p > 3)
        return { error: "Partial pictures must be 0 to 3." };
      values.partial_images = p;
    }
  }
  return { values };
}

export function buildGenerateBody(
  model: string,
  draft: ImageDraft,
): { body: Record<string, unknown> } | { error: string } {
  const shared = settings(draft);
  if ("error" in shared) return shared;
  return { body: { model, prompt: draft.prompt, ...shared.values } };
}

export function buildEditForm(
  model: string,
  draft: ImageDraft,
  images: readonly File[],
  mask: File | null,
): { form: FormData; fields: FormField[] } | { error: string } {
  if (images.length === 0) return { error: "Choose a picture to edit." };
  const shared = settings(draft);
  if ("error" in shared) return shared;
  const form = new FormData();
  const fields: FormField[] = [];
  const add = (name: string, value: string) => {
    form.append(name, value);
    fields.push({ name, value });
  };
  add("model", model);
  add("prompt", draft.prompt);
  // One picture is `image`, several are `image[]` once each: the SDK's form.
  const key = images.length === 1 ? "image" : "image[]";
  for (const image of images) {
    form.append(key, image, image.name);
    fields.push({ name: key, file: image.name });
  }
  if (mask) {
    form.append("mask", mask, mask.name);
    fields.push({ name: "mask", file: mask.name });
  }
  for (const [name, value] of Object.entries(shared.values)) add(name, String(value));
  return { form, fields };
}

/** What a picture is, from its named format or its first bytes. */
export function mimeForImage(format: string | undefined, b64: string): string {
  const named: Record<string, string> = {
    png: "image/png",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    webp: "image/webp",
    svg: "image/svg+xml",
  };
  if (format && named[format]) return named[format]!;
  if (b64.startsWith("iVBOR")) return "image/png";
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("UklGR")) return "image/webp";
  return "image/png";
}

export interface Picture {
  src: string;
  revisedPrompt: string | null;
}

export interface ImagesAnswer {
  pictures: Picture[];
  usage: { input_tokens?: number; output_tokens?: number; total_tokens?: number } | null;
  routing: Record<string, unknown> | null;
  /** Set when a stream stopped before its pictures were finished. */
  truncatedBy: string | null;
}

interface ImagesBody {
  data?: Array<{ b64_json?: string; revised_prompt?: string }>;
  output_format?: string;
  usage?: ImagesAnswer["usage"];
  x_eugene_plexus?: Record<string, unknown>;
}

export function answerFromImages(body: ImagesBody): ImagesAnswer {
  return {
    pictures: (body.data ?? [])
      .filter((d) => d.b64_json)
      .map((d) => ({
        src: `data:${mimeForImage(body.output_format, d.b64_json!)};base64,${d.b64_json}`,
        revisedPrompt: d.revised_prompt ?? null,
      })),
    usage: body.usage ?? null,
    routing: body.x_eugene_plexus ?? null,
    truncatedBy: null,
  };
}

interface StreamEvent {
  type?: string;
  b64_json?: string;
  output_format?: string;
  partial_image_index?: number;
  usage?: ImagesAnswer["usage"];
  x_eugene_plexus?: Record<string, unknown>;
  error?: { message?: string };
}

/**
 * Read a streamed answer. `onPartial` is handed each partial picture as it
 * is drawn; the answer holds the finished ones. A stream that ends with
 * none finished, or with an `error` event, is cut short.
 */
export async function readImageStream(
  response: Response,
  onPartial: (src: string, index: number) => void,
  onFirst?: () => void,
): Promise<ImagesAnswer> {
  const answer: ImagesAnswer = { pictures: [], usage: null, routing: null, truncatedBy: null };
  for await (const { event, data } of sseEvents(response)) {
    let parsed: StreamEvent;
    try {
      parsed = JSON.parse(data) as StreamEvent;
    } catch {
      continue;
    }
    onFirst?.();
    const type = parsed.type ?? event ?? "";
    if (type === "error" || parsed.error) {
      answer.truncatedBy = parsed.error?.message ?? "the stream failed";
      continue;
    }
    if (!parsed.b64_json) continue;
    const src = `data:${mimeForImage(parsed.output_format, parsed.b64_json)};base64,${parsed.b64_json}`;
    if (type.endsWith(".partial_image")) {
      onPartial(src, parsed.partial_image_index ?? 0);
    } else if (type.endsWith(".completed")) {
      answer.pictures.push({ src, revisedPrompt: null });
      if (parsed.usage) answer.usage = parsed.usage;
      if (parsed.x_eugene_plexus) answer.routing = parsed.x_eugene_plexus;
    }
  }
  if (answer.pictures.length === 0 && answer.truncatedBy === null) {
    answer.truncatedBy = "the stream ended before a picture was finished";
  }
  return answer;
}
