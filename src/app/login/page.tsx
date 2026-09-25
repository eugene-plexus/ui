"use client";

/**
 * Operator login.
 *
 * Reached when:
 *   - The user lands fresh in a tab with no session token.
 *   - A protected route returned 401 (token missing, malformed, expired,
 *     or rejected because the agent rotated its signing key on its
 *     own restart — Phase 8 of the v0.2 security rollout).
 *
 * A 401 from a request that carried the stored session arrives here with
 * `reason=expired`, and the page says the session ended.
 *
 * Posts the passphrase to the agent's `/v1/auth/login`. On success
 * stores the issued JWT in sessionStorage and returns to wherever the
 * user was before (via the `next` query param). On 503 "Setup required"
 * sends them to /setup — they hit /login but the install isn't
 * initialized yet, which means the wizard is the right destination.
 *
 * Rate limiting (5 failures / 60s per source IP) is enforced by the
 * agent; a 429 response renders a "wait and try again" message.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { Attribution } from "@/components/Attribution";
import { SetupGateScreen } from "@/components/SetupGateScreen";
import { ApiError, api } from "@/lib/api";
import { pageTitle, useDocumentTitle } from "@/lib/pageTitle";
import { setSessionToken } from "@/lib/session";
import { SETUP_GATE_TIMEOUT_MS, isNoAnswer } from "@/lib/useSetupGate";

interface LoginResponse {
  sessionToken: string;
  expiresAt: string;
  operatorName?: string | null;
}

function isProblemDetail(
  value: unknown,
): value is { detail?: { detail?: string; title?: string } } {
  return typeof value === "object" && value !== null && "detail" in value;
}

function safeNext(raw: string | null): string {
  if (!raw) return "/";
  try {
    const decoded = decodeURIComponent(raw);
    // Only allow same-origin relative paths to avoid open-redirect
    // shenanigans from a crafted `?next=https://attacker.example`.
    if (decoded.startsWith("/") && !decoded.startsWith("//")) {
      return decoded;
    }
  } catch {
    // fall through
  }
  return "/";
}

function problemTitle(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail !== "object" || detail === null) return undefined;
  const title = (detail as { title?: unknown }).title;
  return typeof title === "string" ? title : undefined;
}

export default function LoginPage() {
  // Named like every other screen. Nothing else here can be: there is no
  // session, so no topology and no machine count -- and a sign-in page
  // that named a host would be naming one it has not authenticated to.
  useDocumentTitle(pageTitle({ page: "Sign in", node: null, machines: 1 }));
  // Next 15 requires useSearchParams to be wrapped in Suspense — the
  // route would otherwise bail out of static prerender. We do the bare
  // minimum: the form is a client component anyway, so the Suspense
  // boundary is just a frame.
  return (
    <Suspense
      fallback={
        <main className="relative z-10 flex h-screen items-center justify-center">
          <p className="font-ui text-sm text-[color:var(--muted)]">Loading…</p>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const expired = searchParams.get("reason") === "expired";
  const [passphrase, setPassphrase] = useState("");
  // A long passphrase typed blind, with no way to look and no word about
  // Caps Lock, is the commonest way a right passphrase is refused.
  const [shown, setShown] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Probe init state on mount via the public /v1/auth/status endpoint
  // so a fresh install lands directly on /setup without ever rendering
  // the "Unlock — enter your install passphrase" form (which implies
  // the operator has one when they don't). The form only renders once
  // we've confirmed the install IS initialized.
  const [probing, setProbing] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  // No answer at all within the gate's deadline. The probe used to wait
  // as long as the browser would, so a hung agent left "Loading…" on
  // screen forever with nothing to press.
  const [unreachable, setUnreachable] = useState(false);
  // Bumped by Try again; the probe re-runs on each new value.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function probe() {
      try {
        const status = await api.get<{ initialized: boolean }>("agent", "/v1/auth/status", {
          skipAuth: true,
          timeoutMs: SETUP_GATE_TIMEOUT_MS,
        });
        if (cancelled) return;
        if (!status.initialized) {
          setSetupRequired(true);
          return;
        }
        setProbing(false);
      } catch (e) {
        if (cancelled) return;
        // No answer is its own screen, with Try again. An agent that
        // answered with an error (an older build without the endpoint)
        // still gets the form; the submit path's 503 handling covers the
        // pre-init case.
        if (isNoAnswer(e)) setUnreachable(true);
        else setProbing(false);
      }
    }
    void probe();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    if (setupRequired) {
      router.replace("/setup");
    }
  }, [setupRequired, router]);

  // Back in the box after a refusal, with what was typed selected, so a
  // retype is just typing. The box used to be `disabled` while the
  // request was out, which drops focus to <body>; it is read-only now.
  const field = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!error) return;
    field.current?.focus();
    field.current?.select();
  }, [error]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!passphrase) return;
    setSubmitting(true);
    setError(null);
    try {
      const resp = await api.post<LoginResponse>(
        "agent",
        "/v1/auth/login",
        { passphrase },
        { skipAuth: true },
      );
      setSessionToken(resp.sessionToken);
      // One call. Since per-node token keys (2026-09-25) the session comes
      // from the control root: the agent forwards the passphrase there,
      // and the root's login is also what unlocks it after a restart. This
      // page used to post the passphrase to the root a second time itself,
      // which cost a second key derivation on every sign-in.
      router.replace(safeNext(searchParams.get("next")));
    } catch (e) {
      if (e instanceof ApiError) {
        // **Only the agent's own "Setup required" sends someone to setup.**
        // A sign-in that could not reach the control root is also a 503,
        // and running setup on an install that exists is refused -- the
        // wizard says so itself. It used to read every 503 as the first.
        if (e.status === 503 && problemTitle(e.body) === "Setup required") {
          setSetupRequired(true);
          return;
        }
        if (e.status === 429) {
          setError(
            "Too many failed login attempts from this source. Wait 60 seconds and try again.",
          );
        } else if (e.status === 401) {
          setError("Passphrase did not match. Try again.");
        } else {
          const detail = isProblemDetail(e.body)
            ? e.body.detail?.detail || e.body.detail?.title || e.message
            : e.message;
          setError(detail);
        }
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Don't render the form (or "Unlock" header) until we've confirmed
  // the install is initialized. Otherwise a fresh install shows
  // "enter your install passphrase" misleadingly before the probe's
  // redirect to /setup fires.
  if (unreachable) {
    return (
      <SetupGateScreen
        state="unreachable"
        onRetry={() => {
          setUnreachable(false);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }

  if (probing || setupRequired) {
    return (
      <main className="relative z-10 flex h-screen items-center justify-center">
        <p className="font-ui text-sm text-[color:var(--muted)]">
          {setupRequired ? "Redirecting to setup…" : "Loading…"}
        </p>
      </main>
    );
  }

  return (
    <main className="relative z-10 flex h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <header className="mb-8 text-center">
          <p className="font-mono text-[0.625rem] tracking-wider text-[color:var(--muted)] uppercase">
            eugene plexus
          </p>
          <h1 className="font-ui mt-1 text-xl font-semibold">Unlock</h1>
          <p className="mt-3 text-sm leading-relaxed text-[color:var(--muted)]">
            Enter your install passphrase. It was set during the first-run setup wizard and is used
            to decrypt at-rest secrets like provider API keys.
          </p>
        </header>
        {/* The api client sends `reason=expired` only when the session it
            carried was refused, so this line reaches the person it
            happened to and nobody arriving with no session at all.
            Without it, a page they were reading turned into this form
            with nothing to say why. */}
        {expired && !error && (
          <p
            role="status"
            data-testid="session-ended"
            className="status-warn mb-4 rounded-[var(--radius)] border px-3 py-2 text-sm"
          >
            Your session ended. Sign in again.
          </p>
        )}
        <form onSubmit={handleSubmit} noValidate>
          <label className="font-ui mb-1 block text-sm font-medium" htmlFor="passphrase">
            Passphrase
          </label>
          <div className="flex items-stretch gap-2">
            <input
              ref={field}
              id="passphrase"
              type={shown ? "text" : "password"}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => setCapsLock(e.getModifierState?.("CapsLock") ?? false)}
              onKeyUp={(e) => setCapsLock(e.getModifierState?.("CapsLock") ?? false)}
              onBlur={() => setCapsLock(false)}
              readOnly={submitting}
              aria-invalid={error ? true : undefined}
              aria-describedby={
                [error ? "passphrase-error" : null, capsLock ? "passphrase-caps" : null]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              autoFocus
              autoComplete="current-password"
              spellCheck={false}
              className={`font-ui min-w-0 flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)] ${
                submitting ? "opacity-50" : ""
              }`}
            />
            <button
              type="button"
              onClick={() => setShown((v) => !v)}
              aria-pressed={shown}
              aria-controls="passphrase"
              className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
            >
              {shown ? "Hide" : "Show"}
            </button>
          </div>
          {capsLock && (
            <p
              id="passphrase-caps"
              role="status"
              data-testid="caps-lock"
              className="status-warn mt-2 rounded-[var(--radius)] border px-3 py-1.5 text-sm"
            >
              Caps Lock is on.
            </p>
          )}
          {error && (
            <p
              id="passphrase-error"
              role="alert"
              className="status-error mt-3 rounded-[var(--radius)] border px-3 py-2 text-sm"
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting || !passphrase}
            className="font-ui mt-4 w-full rounded-[var(--radius)] bg-[color:var(--accent-left)] px-5 py-2 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Unlocking…" : "Unlock"}
          </button>
        </form>
        <p className="mt-6 text-center text-[0.625rem] text-[color:var(--muted)]">
          Sessions persist for the lifetime of this browser tab. Closing the tab signs you out.
        </p>
        {/* The first screen anyone sees, and the one screen with room. */}
        <Attribution className="mt-3 text-center text-[0.625rem]" />
      </div>
    </main>
  );
}
