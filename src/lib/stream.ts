/**
 * Browser-side client for Eugene's stream of consciousness.
 *
 * `GET /v1/stream/consciousness` is a bearer-authed Server-Sent Events
 * endpoint. The native `EventSource` API cannot attach an `Authorization`
 * header, and our auth is a `Bearer` token (see lib/session) — so instead
 * of `EventSource` we open the stream with `fetch` (which *can* set the
 * header), going through the same same-origin proxy as every other call,
 * and parse the SSE frames off the response body reader ourselves.
 *
 * The proxy (`app/api/proxy/...`) passes the upstream body straight
 * through unbuffered and strips `content-length`/`transfer-encoding`, so
 * the stream arrives chunk-by-chunk here. On disconnect we reconnect with
 * capped exponential backoff (the browser's built-in EventSource retry,
 * reimplemented) unless the caller explicitly closed.
 */

import type { ConsciousnessEvent } from "./types";
import { clearSessionToken, getSessionToken } from "./session";

const STREAM_PATH = "/api/proxy/orchestrator/v1/stream/consciousness";

const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 15000;

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface ConsciousnessHandlers {
  /** One parsed SSE frame. Unknown `type`s still arrive (informational). */
  onEvent: (event: ConsciousnessEvent) => void;
  /** Connection lifecycle, for a UI indicator. */
  onStatus?: (status: ConnectionStatus) => void;
}

export interface ConsciousnessSubscription {
  /** Stop the stream and suppress further reconnects. Idempotent. */
  close: () => void;
}

/**
 * Open a long-lived subscription to the consciousness stream. Returns a
 * handle whose `close()` aborts the in-flight fetch and cancels the
 * reconnect loop. Safe to call only in the browser (uses `fetch` + the
 * session token); callers gate this behind a client-side effect.
 */
export function subscribeConsciousness(handlers: ConsciousnessHandlers): ConsciousnessSubscription {
  const controller = new AbortController();
  let closed = false;
  let backoff = BACKOFF_BASE_MS;

  const setStatus = (s: ConnectionStatus) => {
    if (!closed || s === "closed") handlers.onStatus?.(s);
  };

  function redirectToLogin(): void {
    // Mirror lib/api.ts: a 401 means the session token is gone/expired.
    // Clear it and bounce to /login, preserving the return path. The
    // reconnect loop stops (closed) so we don't hammer the login wall.
    clearSessionToken();
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login?next=${next}`);
    }
  }

  async function connectOnce(): Promise<void> {
    const headers = new Headers({ accept: "text/event-stream" });
    const token = getSessionToken();
    if (token) headers.set("authorization", `Bearer ${token}`);

    const response = await fetch(STREAM_PATH, {
      method: "GET",
      headers,
      signal: controller.signal,
      cache: "no-store",
    });

    if (response.status === 401) {
      closed = true;
      redirectToLogin();
      return;
    }
    if (!response.ok || !response.body) {
      // Transient upstream error (proxy 502/503, loop not up yet). Throw
      // so the caller's reconnect loop backs off and retries.
      throw new Error(`stream open failed: HTTP ${response.status}`);
    }

    // Open. A successful read resets backoff so a brief blip doesn't
    // escalate the retry delay.
    setStatus("open");
    backoff = BACKOFF_BASE_MS;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // SSE accumulator: an event is terminated by a blank line; `event:`
    // sets the type (default "message"), `data:` lines concatenate, lines
    // starting with `:` are comments (the server's keep-alive heartbeat).
    let eventType = "message";
    let dataLines: string[] = [];

    const dispatch = () => {
      if (dataLines.length === 0) {
        eventType = "message";
        return;
      }
      const raw = dataLines.join("\n");
      dataLines = [];
      const type = eventType;
      eventType = "message";
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        // Non-JSON data line — surface it raw rather than dropping it.
        data = raw;
      }
      handlers.onEvent({ type, data } as ConsciousnessEvent);
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);

        if (line === "") {
          dispatch();
        } else if (line.startsWith(":")) {
          // comment / heartbeat — ignore
        } else if (line.startsWith("event:")) {
          eventType = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          let d = line.slice("data:".length);
          if (d.startsWith(" ")) d = d.slice(1);
          dataLines.push(d);
        }
        // id: / retry: are ignored — we manage retry ourselves.
      }
    }
  }

  async function run(): Promise<void> {
    setStatus("connecting");
    while (!closed) {
      try {
        await connectOnce();
        if (closed) break;
        // Stream ended cleanly (server closed) — reconnect after backoff.
      } catch (e) {
        if (closed || controller.signal.aborted) break;
        void e; // transient; fall through to backoff
      }
      if (closed) break;
      setStatus("reconnecting");
      await sleep(backoff, controller.signal);
      backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
    }
    setStatus("closed");
  }

  void run();

  return {
    close() {
      if (closed) return;
      closed = true;
      controller.abort();
    },
  };
}

/** Abortable sleep — resolves early (without throwing) if the signal fires. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const id = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
