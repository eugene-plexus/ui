/**
 * The video door (`POST /v1/videos`, `GET /v1/videos/{id}` and its
 * `/content`, P5): a job, polled until it finishes, then downloaded.
 *
 * The durations and sizes offered are the model's own listing
 * (`video_durations`, `video_sizes`); with none listed they are typed.
 * A first frame (`input_reference`) is offered only where the model
 * lists `video_first_frame`, and then the request is the SDK's multipart
 * form; otherwise it is JSON. The job id is the gateway's signed handle
 * and is sent back as given.
 */

import type { FormField } from "./doorRequest";
import type { Model } from "./types";

/** How often a job is asked about. A video takes minutes. */
export const POLL_MS = 5000;

export interface VideoDraft {
  prompt: string;
  /** Whole seconds, as text; empty means not sent. */
  seconds: string;
  size: string;
}

export const EMPTY_VIDEO_DRAFT: VideoDraft = {
  prompt: "A paper boat drifting down a rainy street, close up",
  seconds: "",
  size: "",
};

export function durationsFor(model: Model | undefined): number[] | null {
  const listed = model?.x_eugene_plexus?.video_durations;
  return listed && listed.length > 0 ? [...listed] : null;
}

export function sizesFor(model: Model | undefined): string[] | null {
  const listed = model?.x_eugene_plexus?.video_sizes;
  return listed && listed.length > 0 ? [...listed] : null;
}

export function takesFirstFrame(model: Model | undefined): boolean {
  return model?.x_eugene_plexus?.video_first_frame === true;
}

export type VideoRequest =
  | { kind: "json"; body: Record<string, string> }
  | { kind: "form"; form: FormData; fields: FormField[] };

export function buildVideoRequest(
  model: string,
  draft: VideoDraft,
  firstFrame: File | null,
): { request: VideoRequest } | { error: string } {
  if (!draft.prompt.trim()) return { error: "Describe the video." };
  const values: Record<string, string> = { model, prompt: draft.prompt };
  if (draft.seconds.trim()) {
    if (!/^[0-9]{1,3}$/.test(draft.seconds.trim()) || Number(draft.seconds) < 1) {
      return { error: "Length must be a whole number of seconds." };
    }
    values.seconds = draft.seconds.trim();
  }
  if (draft.size.trim()) values.size = draft.size.trim();
  if (!firstFrame) return { request: { kind: "json", body: values } };
  const form = new FormData();
  const fields: FormField[] = [];
  for (const [name, value] of Object.entries(values)) {
    form.append(name, value);
    fields.push({ name, value });
  }
  form.append("input_reference", firstFrame, firstFrame.name);
  fields.push({ name: "input_reference", file: firstFrame.name });
  return { request: { kind: "form", form, fields } };
}

export interface VideoJob {
  id: string;
  status: "queued" | "in_progress" | "completed" | "failed" | string;
  progress?: number;
  model?: string;
  seconds?: string;
  size?: string;
  error?: { code?: string; message?: string } | null;
  x_eugene_plexus?: Record<string, unknown>;
}

export function isFinished(job: VideoJob): boolean {
  return job.status === "completed" || job.status === "failed";
}

/** One line for where the job is. */
export function describeJob(job: VideoJob): string {
  switch (job.status) {
    case "queued":
      return "Waiting to start.";
    case "in_progress":
      return typeof job.progress === "number" ? `Making it: ${job.progress}% done.` : "Making it.";
    case "completed":
      return "Finished.";
    case "failed":
      return `It failed: ${job.error?.message ?? "the provider gave no reason"}.`;
    default:
      return `The provider says: ${job.status}.`;
  }
}

/**
 * A URL the page can play and save. An object URL where the browser has
 * them, since a video is megabytes and a data URL copies it into a
 * string; a data URL otherwise. The caller revokes an object URL.
 */
export function mediaUrl(
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
): { url: string; revoke: () => void } {
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    return { url, revoke: () => URL.revokeObjectURL(url) };
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return { url: `data:${mime};base64,${btoa(binary)}`, revoke: () => {} };
}

export function jobPath(id: string, content = false): string {
  return `/v1/videos/${encodeURIComponent(id)}${content ? "/content" : ""}`;
}
