"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { AgentConfigDocument } from "./agent";
import { ApiError, api } from "./api";
import { hasSessionToken } from "./session";

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
 * An unreachable agent falls through to `ready`, so a dev run against
 * just the gateway still works; a 401 is left to the api client, which
 * has already cleared the session and started the bounce to `/login`.
 */
export function useSetupGate(): "checking" | "ready" {
  const router = useRouter();
  const [gate, setGate] = useState<"checking" | "ready">("checking");

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const status = await api.get<{ initialized: boolean }>("agent", "/v1/auth/status", {
          skipAuth: true,
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
        const doc = await api.get<AgentConfigDocument>("agent", "/v1/config");
        if (cancelled) return;
        if (doc.firstRunComplete === false) {
          router.replace("/setup");
          return;
        }
        setGate("ready");
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) return;
        setGate("ready");
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return gate;
}
