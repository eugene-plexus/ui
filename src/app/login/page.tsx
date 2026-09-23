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
import { ApiError, api } from "@/lib/api";
import { unlockControlRoot } from "@/lib/controlUnlock";
import { pageTitle, useDocumentTitle } from "@/lib/pageTitle";
import { setSessionToken } from "@/lib/session";

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Probe init state on mount via the public /v1/auth/status endpoint
  // so a fresh install lands directly on /setup without ever rendering
  // the "Unlock — enter your install passphrase" form (which implies
  // the operator has one when they don't). The form only renders once
  // we've confirmed the install IS initialized.
  const [probing, setProbing] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function probe() {
      try {
        const status = await api.get<{ initialized: boolean }>("agent", "/v1/auth/status", {
          skipAuth: true,
        });
        if (cancelled) return;
        if (!status.initialized) {
          setSetupRequired(true);
          return;
        }
        setProbing(false);
      } catch {
        // If the probe fails (older agent without the endpoint, or
        // agent down) fall through to showing the form. The submit
        // path's existing 503 handling still covers the pre-init case.
        if (!cancelled) setProbing(false);
      }
    }
    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

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
      // The same passphrase opens the control root, which seals on every
      // restart and used to ask for it a second time on /nodes. Awaited so
      // the page we land on already routes; never fatal -- see the module.
      const unlock = await unlockControlRoot(passphrase, resp.sessionToken);
      if (unlock === "mismatch") {
        console.warn(
          "signed in, but the control root refused the same passphrase; the Nodes screen will ask for its own",
        );
      }
      router.replace(safeNext(searchParams.get("next")));
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 503) {
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
          <input
            ref={field}
            id="passphrase"
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            readOnly={submitting}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "passphrase-error" : undefined}
            autoFocus
            autoComplete="current-password"
            spellCheck={false}
            className={`font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)] ${
              submitting ? "opacity-50" : ""
            }`}
          />
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
