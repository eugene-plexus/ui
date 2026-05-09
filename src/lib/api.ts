/**
 * Browser-side API client.
 *
 * Talks to the same-origin proxy at `/api/proxy/<target>/<path>`. The
 * server-side proxy (see `app/api/proxy/[target]/[...path]/route.ts`)
 * forwards to the configured component URL. This module only deals in
 * relative paths and JSON.
 */

import type { ProxyTarget } from "./config";

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

async function jsonRequest<T>(
  target: ProxyTarget,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `/api/proxy/${target}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (!headers.has("accept")) {
    headers.set("accept", "application/json");
  }
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!response.ok) {
    throw new ApiError(response.status, response.statusText, parsed);
  }
  return parsed as T;
}

export const api = {
  get: <T>(target: ProxyTarget, path: string) => jsonRequest<T>(target, path, { method: "GET" }),
  post: <T>(target: ProxyTarget, path: string, body: unknown) =>
    jsonRequest<T>(target, path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(target: ProxyTarget, path: string, body: unknown) =>
    jsonRequest<T>(target, path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(target: ProxyTarget, path: string) =>
    jsonRequest<T>(target, path, { method: "DELETE" }),
};
