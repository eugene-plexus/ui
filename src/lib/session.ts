/**
 * Client-side session-token storage.
 *
 * The watchdog issues a JWT on successful `/v1/auth/initialize` or
 * `/v1/auth/login`. v0.2 stores it in `sessionStorage` — per-tab, cleared
 * on tab close, no SSR leakage. The api client (lib/api.ts) reads from
 * here and attaches `Authorization: Bearer ...` on every request; the
 * same-origin proxy forwards the header upstream unchanged.
 *
 * v0.3+ may upgrade to an HttpOnly cookie set by a server-side login
 * route. The function-level API here is stable; switching storage
 * backends only touches this file.
 */

const STORAGE_KEY = "eugene-session-token";

export function getSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Private mode / quota exceeded. The user will need to log in again
    // on the next request rather than transparently — acceptable.
  }
}

export function clearSessionToken(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function hasSessionToken(): boolean {
  return getSessionToken() !== null;
}
