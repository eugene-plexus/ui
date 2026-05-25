/**
 * Browser-side API client.
 *
 * Talks to the same-origin proxy at `/api/proxy/<target>/<path>`. The
 * server-side proxy (see `app/api/proxy/[target]/[...path]/route.ts`)
 * forwards to the configured component URL. This module only deals in
 * relative paths and JSON.
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

interface RequestOptions {
  /** When true, don't attach the Bearer token and don't redirect on 401.
   * Used by the login form and the wizard's `/v1/auth/initialize` call —
   * both expect to talk to the watchdog without an existing session. */
  skipAuth?: boolean;
  /** Client-side timeout in milliseconds. When the request exceeds this,
   * the fetch is aborted and a friendly `ApiError` (`status=0`,
   * `statusText='request timed out'`) is thrown. Useful for endpoints
   * whose upstream may hang (identity reflection waiting on a slow
   * hemisphere-driver). Unset = no client-side timeout. */
  timeoutMs?: number;
}

async function jsonRequest<T>(
  target: ProxyTarget,
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<T> {
  const url = `/api/proxy/${target}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (!headers.has("accept")) {
    headers.set("accept", "application/json");
  }
  if (!options.skipAuth && !headers.has("authorization")) {
    const token = getSessionToken();
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
  }

  // Per-call timeout via AbortController. Without this, a hung upstream
  // component (e.g. identity reflection waiting on a stuck local LLM)
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
  if (response.status === 401 && !options.skipAuth) {
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
  delete: <T>(target: ProxyTarget, path: string, options?: RequestOptions) =>
    jsonRequest<T>(target, path, { method: "DELETE" }, options),
};
