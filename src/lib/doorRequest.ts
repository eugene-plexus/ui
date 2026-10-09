/**
 * One request to one of the playground's other doors, through either
 * transport, with the report a bug needs.
 *
 * Chat has its own, richer path (`completions.ts`), because it counts
 * deltas, tool-call fragments and progress frames. The other doors send
 * JSON or a multipart form and get back JSON, text, a stream or bytes;
 * what they share is the transport (proxy or direct, exactly as chat),
 * the report and the curl line. The caller reads the body, because only
 * it knows whether the answer is a picture or a sentence.
 */

import { ApiError, fetchRaw, problemMessage } from "./api";
import { type Transport, urlFor } from "./completions";
import { CURL_KEY_PLACEHOLDER, asciiJson, normalizeBaseUrl, shellQuote } from "./diagnostic";

/** A multipart field as the report and the curl line show it: a value,
 * or a file by name (its bytes are not repeated). */
export type FormField = { name: string; value: string } | { name: string; file: string };

export type DoorPayload =
  | { kind: "json"; body: unknown }
  | { kind: "form"; form: FormData; fields: FormField[] }
  | { kind: "get" };

export interface DoorReport {
  mode: "proxy" | "direct";
  method: "GET" | "POST";
  /** What was dialled. In proxy mode a same-origin path. */
  url: string;
  /** The gateway URL a harness would dial, for the curl line; null when unknown. */
  reproduceUrl: string | null;
  /** The JSON exactly as sent, or null for a form or a GET. */
  body: string | null;
  fields: FormField[] | null;
  status: number | null;
  error: string | null;
  elapsedMs: number | null;
  /** Send to the first byte of the answer's body. */
  firstByteMs: number | null;
  bytes: number | null;
  contentType: string | null;
  requestId: string | null;
  /** What served it: the body's `x_eugene_plexus`, or the
   * `x-eugene-plexus-*` response headers where the answer is not JSON. */
  routing: Record<string, unknown> | null;
  at: string;
}

export function newDoorReport(
  transport: Transport,
  path: string,
  payload: DoorPayload,
  reproduceBaseUrl: string | null,
): DoorReport {
  const url = urlFor(transport, path);
  const reproduceUrl =
    transport.kind === "direct"
      ? url
      : reproduceBaseUrl
        ? `${normalizeBaseUrl(reproduceBaseUrl)}${path}`
        : null;
  return {
    mode: transport.kind,
    method: payload.kind === "get" ? "GET" : "POST",
    url,
    reproduceUrl,
    body: payload.kind === "json" ? JSON.stringify(payload.body) : null,
    fields: payload.kind === "form" ? payload.fields : null,
    status: null,
    error: null,
    elapsedMs: null,
    firstByteMs: null,
    bytes: null,
    contentType: null,
    requestId: null,
    routing: null,
    at: new Date().toISOString(),
  };
}

/** The routing envelope carried as headers, as `/v1/messages` does:
 * `x-eugene-plexus-driver: a` becomes `{driver: "a"}`. Null when none. */
export function routingFromHeaders(headers: Headers): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (!name.startsWith("x-eugene-plexus-") || name === "x-eugene-plexus-ignored-settings") return;
    const field = name.slice("x-eugene-plexus-".length).replace(/-/g, "_");
    const numeric = Number(value);
    out[field] =
      value === "true"
        ? true
        : value === "false"
          ? false
          : value !== "" && !Number.isNaN(numeric)
            ? numeric
            : value;
  });
  return Object.keys(out).length > 0 ? out : null;
}

/** Record a failure on the report in the gateway's own words. */
export function recordDoorFailure(report: DoorReport, e: unknown): void {
  if (e instanceof ApiError) {
    report.status = e.status === 0 ? null : e.status;
    report.error = problemMessage(e.body) ?? `${e.status} ${e.statusText}`;
  } else {
    report.error = e instanceof Error ? e.message : String(e);
  }
}

/**
 * Send one request and hand back the response, headers read.
 *
 * Throws `ApiError` for a refusal (the body parsed where it is JSON) and
 * a plain `Error` naming the URL when the browser could not reach it,
 * which in direct mode is all the evidence there is. The caller reads
 * the body and then sets `elapsedMs`, `bytes` and `routing` itself.
 */
export async function sendToDoor(
  transport: Transport,
  path: string,
  payload: DoorPayload,
  report: DoorReport,
  { accept, signal }: { accept: string; signal?: AbortSignal },
): Promise<Response> {
  const method = payload.kind === "get" ? "GET" : "POST";
  const body: BodyInit | undefined =
    payload.kind === "json"
      ? JSON.stringify(payload.body)
      : payload.kind === "form"
        ? payload.form
        : undefined;
  let response: Response;
  if (transport.kind === "proxy") {
    response = await fetchRaw("gateway", path, { method, body, accept }, { signal });
  } else {
    const headers: Record<string, string> = {
      authorization: `Bearer ${transport.key}`,
      accept,
    };
    if (payload.kind === "json") headers["content-type"] = "application/json";
    try {
      // Plain `fetch`, as chat's direct path: nothing of ours on it.
      response = await fetch(report.url, { method, headers, body, signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new Error(
        `The browser could not reach ${report.url}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!response.ok) {
      const text = await response.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        // keep the raw text
      }
      throw new ApiError(response.status, response.statusText, parsed);
    }
  }
  report.status = response.status;
  report.contentType = response.headers.get("content-type");
  report.requestId = response.headers.get("x-request-id");
  report.routing = routingFromHeaders(response.headers);
  return response;
}

/** The file extension a saved answer should get, from its media type. */
export function extensionFor(contentType: string | null): string {
  const type = (contentType ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const known: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/ogg": "opus",
    "audio/opus": "opus",
    "audio/aac": "aac",
    "audio/flac": "flac",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/pcm": "pcm",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "application/json": "json",
    "text/plain": "txt",
    "text/vtt": "vtt",
    "application/x-subrip": "srt",
  };
  return known[type] ?? "bin";
}

/**
 * The shell line that replays the request outside a browser. The key is
 * the placeholder unless the person asks for it, in double quotes so the
 * shell expands it (the playground's first curl line single-quoted it and
 * sent the literal string). A binary answer is written to a file rather
 * than to the terminal.
 */
export function doorCurl(report: DoorReport, key: string | null): string | null {
  if (report.reproduceUrl === null) return null;
  const parts = ["curl -sS", shellQuote(report.reproduceUrl)];
  parts.push(
    "-H",
    key === null
      ? `"Authorization: Bearer ${CURL_KEY_PLACEHOLDER}"`
      : shellQuote(`Authorization: Bearer ${key}`),
  );
  if (report.body !== null) {
    parts.push("-H", shellQuote("Content-Type: application/json"));
    parts.push("-d", shellQuote(asciiJson(report.body)));
  }
  for (const field of report.fields ?? []) {
    parts.push(
      "-F",
      shellQuote("file" in field ? `${field.name}=@${field.file}` : `${field.name}=${field.value}`),
    );
  }
  const type = (report.contentType ?? "").toLowerCase();
  if (/^(audio|image|video)\//.test(type) || type.startsWith("application/octet-stream")) {
    parts.push("-o", shellQuote(`answer.${extensionFor(report.contentType)}`));
  }
  return parts.join(" ");
}
