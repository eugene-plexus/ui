"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { AgentConfigDocument } from "./agent";
import { ApiError, api } from "./api";
import { hasSessionToken } from "./session";

export type SetupGateState = "checking" | "ready" | "unreachable";

/**
 * How long each of the gate's two calls may take before the page stops
 * saying "Checking" and says it cannot reach the agent instead.
 *
 * Ten seconds, not two: the first `GET /v1/auth/status` of a cold agent
 * pays for a keyring probe with its own 3 s budget (S0), and a console
 * opened over a tailnet adds a hop. Long enough that a slow start is not
 * reported as a dead one, short enough that nobody waits on a spinner
 * wondering whether to reload. The same number as the Issues reads'
 * `READ_TIMEOUT_MS`, for the same reason.
 */
export const SETUP_GATE_TIMEOUT_MS = 10_000;

/**
 * No answer at all: a deadline that fired, or a fetch that never reached
 * a server. An `ApiError` with a real status means the agent DID answer,
 * which is a different problem and one the page's own reads will name.
 */
function isNoAnswer(e: unknown): boolean {
  if (e instanceof ApiError) return e.status === 0;
  return true;
}

/**
 * The first-run and sign-in gate, shared by every page the install root
 * owns.
 *
 * Until S1 this lived inline in the playground, which was the only page
 * at `/`. Home took `/` and the playground moved to `/playground`, and
 * two copies of a redirect sequence are two places for it to drift — the
 * wizard's own history is four defects found by hand in screens that
 * looked right, so the gate is one function with one caller list.
 *
 * Runs in order:
 *
 *   1. Probe init state (public endpoint, no auth) — route to `/setup`
 *      if uninitialized.
 *   2. Check for a session token BEFORE making any authed call, so the
 *      page never renders for an unauthenticated visitor.
 *   3. Authed `GET /v1/config` to honour `firstRunComplete`.
 *
 * **Both calls have a deadline, and no answer is its own state.** The
 * gate used to wait as long as the browser would, so an agent that took
 * the connection and never replied left every install-root page reading
 * "Checking setup state…" forever with nothing to press. It also used to
 * treat an unreachable agent as `ready`, "so a dev run against just the
 * gateway still works" — a fossil since install-paths step 1 moved the
 * proxy into the agent: every call this UI makes goes through the agent,
 * so with no agent there is no page that can work, and opening one only
 * trades a clear sentence for a screen of failed reads. `unreachable`
 * is what `SetupGateScreen` turns into that sentence and a Try again
 * button, and `retry` runs the whole sequence again from step 1.
 *
 * An agent that answered with an error still falls through to `ready`:
 * it is there, and the page's own reads will say what is wrong. A 401 is
 * left to the api client, which has already cleared the session and
 * started the bounce to `/login`.
 */
export function useSetupGate(): { state: SetupGateState; retry: () => void } {
  const router = useRouter();
  const [state, setState] = useState<SetupGateState>("checking");
  // Bumped by `retry`; the effect below re-runs on each new value.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const status = await api.get<{ initialized: boolean }>("agent", "/v1/auth/status", {
          skipAuth: true,
          timeoutMs: SETUP_GATE_TIMEOUT_MS,
        });
        if (cancelled) return;
        if (!status.initialized) {
          router.replace("/setup");
          return;
        }
        if (!hasSessionToken()) {
          const next = encodeURIComponent(window.location.pathname + window.location.search);
          router.replace(`/login?next=${next}`);
          return;
        }
        const doc = await api.get<AgentConfigDocument>("agent", "/v1/config", {
          timeoutMs: SETUP_GATE_TIMEOUT_MS,
        });
        if (cancelled) return;
        if (doc.firstRunComplete === false) {
          router.replace("/setup");
          return;
        }
        setState("ready");
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) return;
        setState(isNoAnswer(e) ? "unreachable" : "ready");
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [router, attempt]);

  const retry = useCallback(() => {
    setState("checking");
    setAttempt((n) => n + 1);
  }, []);

  return { state, retry };
}
