/**
 * Browser-side API client.
 *
 * Talks to the same-origin proxy at `/api/proxy/<target>/<path>`, which
 * **the agent serves** (`eugene_plexus_agent/routes/proxy.py`) and which
 * forwards to the component that target names. Same origin as the page
 * itself, because the agent also serves the page. This module only deals
 * in relative paths and JSON.
 *
 * v0.2: every request automatically gets `Authorization: Bearer <token>`
 * when the user has an active session. 401 responses are intercepted
 * here — the session token is cleared and the browser is redirected to
 * `/login`. Routes that need to opt out of the redirect (the login form
 * itself, the auth-init endpoint on the wizard) pass `{ skipAuth: true }`.
 */

import type { ProxyTarget } from "./config";
import { clearSessionToken, getSessionToken } from "./session";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: unknown,
  ) {
    super(`HTTP ${status} ${statusText}`);
    this.name = "ApiError";
  }
}

/**
 * The sentence a component wrote, out of whatever envelope carried it.
 *
 * Every component in this install answers a failure with an RFC 7807
 * `Problem` whose `detail` is the operator's next action — *"Set
 * `advertiseUrl` in that node's agent config"*, not *"resolution
 * failed"*. FastAPI nests that document one level down, as
 * `{detail: {title, detail, status, …}}`, and a screen that renders the
 * body instead of reading it shows the operator a JSON document to
 * parse by eye. That is exactly how the worker-node gateway failure was
 * reported: a paragraph of punctuation with one usable sentence inside
 * it.
 *
 * Four shapes, because two of them really do occur:
 * `/v1/chat/completions` answers with OpenAI's `{error: {message}}` so
 * SDKs can build their exception types, and everything else answers
 * with a `Problem` — nested under `detail` when FastAPI raised it,
 * bare when a component returned it directly.
 *
 * Returns null when the body carries no sentence, so a caller can fall
 * back to the status line rather than printing "null".
 */
export function problemMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return typeof body === "string" && body.trim() !== "" ? body : null;
  }
  const record = body as Record<string, unknown>;

  const openai = record.error;
  if (typeof openai === "string") return openai;
  if (typeof openai === "object" && openai !== null) {
    const message = (openai as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }

  const detail = record.detail;
  if (typeof detail === "string") return detail;
  if (typeof detail === "object" && detail !== null) {
    const inner = detail as Record<string, unknown>;
    if (typeof inner.detail === "string") return inner.detail;
    if (typeof inner.title === "string") return inner.title;
  }

  if (typeof record.title === "string") return record.title;
  return null;
}

/** What to put on screen when a call failed: the component's own
 * sentence when it wrote one, and the status line when it did not. */
export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    return problemMessage(e.body) ?? `${e.status} ${e.statusText}`;
  }
  return e instanceof Error ? e.message : String(e);
}

interface RequestOptions {
  /** When true, don't attach the Bearer token and don't redirect on 401.
   * Used by the login form and the wizard's `/v1/auth/initialize` call —
   * both expect to talk to the agent without an existing session. */
  skipAuth?: boolean;
  /** Use this bearer instead of the stored session token.
   *
   * Exactly one caller: the first-run wizard, which needs a control-root
   * token to mint a join token. Between initializing the agent and
   * enrolling it, the agent and the root genuinely hold different signing
   * keys — the agent mints its own random per-restart one, the root mints
   * the install's — so the session in `localStorage` is not a credential
   * the root accepts.
   *
   * **This used to be a second header.** `x-eugene-plexus-upstream-
   * authorization` existed because the old Next proxy spent the request's
   * `Authorization` on its own lookup: finding where `control` lives
   * meant calling the agent's bearer-protected `/v1/components`, so one
   * header could not be both credentials at once and a 401 at the
   * resolver surfaced as "no control component in the agent topology" —
   * alarming, false, and on record twice. The agent resolves targets in
   * process now and spends no credential doing it, so there is one
   * header again and it means what it says.
   *
   * A 401 here is the *supplied* token being refused, not the session, so
   * it does not clear the session or bounce to /login. */
  bearer?: string;
  /** Client-side timeout in milliseconds. When the request exceeds this,
   * the fetch is aborted and a friendly `ApiError` (`status=0`,
   * `statusText='request timed out'`) is thrown. Useful for endpoints
   * whose upstream may hang (a chat completion waiting on a wedged
   * local engine). Unset = no client-side timeout. */
  timeoutMs?: number;
}

function proxyUrl(target: ProxyTarget, path: string): string {
  return `/api/proxy/${target}${path.startsWith("/") ? path : `/${path}`}`;
}

/** The headers every proxied call carries: content type, accept, the
 * session bearer, and the second upstream credential the wizard needs.
 * Shared so a streaming request cannot drift from a JSON one on auth --
 * which would show up only as a 401 on exactly one code path. */
function proxyHeaders(init: RequestInit, options: RequestOptions, accept: string): Headers {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (!headers.has("accept")) {
    headers.set("accept", accept);
  }
  if (!headers.has("authorization")) {
    const token = options.bearer ?? (options.skipAuth ? null : getSessionToken());
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
  }
  return headers;
}

/**
 * POST that hands back the raw `Response` so the caller can read a
 * stream off it.
 *
 * Deliberately NOT part of `jsonRequest`: that function's contract is
 * "give me the parsed body", and it reads the whole response to deliver
 * it. A streaming caller needs the opposite, and conflating the two is
 * how a "streaming" client ends up awaiting `.text()` and rendering
 * everything at once -- which is precisely the shape of the gap M10 was
 * built to close.
 */
export async function postStream(
  target: ProxyTarget,
  path: string,
  body: unknown,
  options: RequestOptions = {},
): Promise<Response> {
  const init: RequestInit = { method: "POST", body: JSON.stringify(body) };
  const response = await fetch(proxyUrl(target, path), {
    ...init,
    headers: proxyHeaders(init, options, "text/event-stream"),
  });
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
  return response;
}

async function jsonRequest<T>(
  target: ProxyTarget,
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<T> {
  const url = proxyUrl(target, path);
  const headers = proxyHeaders(init, options, "application/json");

  // Per-call timeout via AbortController. Without this, a hung upstream
  // component (e.g. a completion waiting on a stuck local engine)
  // can leave the UI's request pending indefinitely — disabled buttons,
  // hung loading states, no way to recover except a hard page refresh.
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  if (options.timeoutMs != null && options.timeoutMs > 0) {
    const controller = new AbortController();
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs);
    init = { ...init, signal: controller.signal };
  }

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch (e) {
    if (timedOut) {
      throw new ApiError(0, "request timed out", {
        detail: `Request to ${target}${path} exceeded ${options.timeoutMs}ms — the upstream component is hung or unreachable.`,
      });
    }
    throw e;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
  const text = await response.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (response.status === 401 && !options.skipAuth && !options.bearer) {
    // Session expired or token rejected — clear it and bounce to login.
    // The login page reads the current URL via `next` so it can return
    // here once authentication succeeds.
    clearSessionToken();
    if (typeof window !== "undefined") {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      // Avoid redirect loops if we're already on /login.
      if (!window.location.pathname.startsWith("/login")) {
        window.location.replace(`/login?next=${next}`);
      }
    }
  }
  if (!response.ok) {
    throw new ApiError(response.status, response.statusText, parsed);
  }
  return parsed as T;
}

export const api = {
  get: <T>(target: ProxyTarget, path: string, options?: RequestOptions) =>
    jsonRequest<T>(target, path, { method: "GET" }, options),
  post: <T>(target: ProxyTarget, path: string, body: unknown, options?: RequestOptions) =>
    jsonRequest<T>(target, path, { method: "POST", body: JSON.stringify(body) }, options),
  patch: <T>(target: ProxyTarget, path: string, body: unknown, options?: RequestOptions) =>
    jsonRequest<T>(target, path, { method: "PATCH", body: JSON.stringify(body) }, options),
  // PUT exists for launch profiles, which replace whole-document rather
  // than merging: `flags` is a document, and merge semantics give no way
  // to express removing a flag.
  put: <T>(target: ProxyTarget, path: string, body: unknown, options?: RequestOptions) =>
    jsonRequest<T>(target, path, { method: "PUT", body: JSON.stringify(body) }, options),
  delete: <T>(target: ProxyTarget, path: string, options?: RequestOptions) =>
    jsonRequest<T>(target, path, { method: "DELETE" }, options),
};
