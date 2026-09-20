"use client";

import { useState } from "react";

import { CopyButton } from "@/components/CopyButton";
import { api, describeError } from "@/lib/api";
import { type PageLocation, baseUrlHints, displayBaseUrl } from "@/lib/diagnostic";
import type { ClientKeyCreated } from "@/lib/types";

export type GatewayMode = "proxy" | "direct";

/**
 * Which path the playground takes to the gateway.
 *
 * **Through the agent** is the path every other page takes: same-origin
 * proxy, topology-resolved, works out of the box. **Direct** is the
 * path a harness takes: this browser dials the gateway's own address
 * with a bearer, and nothing of ours is on the way. The panel exists so
 * the same request can be run down both and compared -- see the design's
 * §1 table -- and it is deliberately a little awkward compared to what
 * the UI could do internally: the base URL is a guess it asks you to
 * confirm, and the key is a token you can see. That awkwardness is the
 * instrument. A harness user meets both.
 */
export function DiagnosticPanel({
  mode,
  onMode,
  baseUrl,
  onBaseUrl,
  guess,
  apiKey,
  onApiKey,
  sessionToken,
  page,
}: {
  mode: GatewayMode;
  onMode: (mode: GatewayMode) => void;
  baseUrl: string;
  onBaseUrl: (value: string) => void;
  /** Where the gateway probably is, from the agent's topology and this
   * page's address. Null when the agent declares no gateway here. */
  guess: string | null;
  apiKey: string;
  onApiKey: (value: string) => void;
  sessionToken: string | null;
  page: PageLocation;
}) {
  const [revealed, setRevealed] = useState(false);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);

  /**
   * Mint a client key and put it in the field (S4).
   *
   * The panel exists to reproduce what a harness does, and since S4 what
   * a harness is *given* is a client key rather than the operator's
   * session -- so a diagnostic run with the session token is now a run
   * with a credential the real client will not be holding. One button,
   * on the local agent: the panel is about this page's own reachability,
   * and picking a node here would be a second idea in an instrument
   * whose value is that it has one.
   */
  async function mintClientKey() {
    if (minting) return;
    setMinting(true);
    setMintError(null);
    try {
      const made = await api.post<ClientKeyCreated>("agent", "/v1/auth/client-keys", {
        name: "Playground diagnostic",
      });
      onApiKey(made.token);
    } catch (e) {
      setMintError(describeError(e));
    } finally {
      setMinting(false);
    }
  }
  const hints = mode === "direct" ? baseUrlHints(baseUrl, page) : [];
  const guessDisplay = guess ? displayBaseUrl(guess) : null;
  const keyIsSession = sessionToken !== null && apiKey === sessionToken;

  return (
    <section
      className="flex min-w-0 flex-1 flex-col gap-2 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] p-3"
      aria-label="Path to the gateway"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-ui text-xs font-semibold">Path to the gateway</h2>
        <div className="font-ui flex gap-1 text-xs" role="radiogroup" aria-label="Gateway mode">
          <ModeButton
            active={mode === "proxy"}
            onClick={() => onMode("proxy")}
            testId="mode-proxy"
            title="Same-origin proxy served by the agent; the path every other page takes"
          >
            Through the agent
          </ModeButton>
          <ModeButton
            active={mode === "direct"}
            onClick={() => onMode("direct")}
            testId="mode-direct"
            title="This browser dials the gateway itself with a bearer token, the way OpenCode or the OpenAI SDK does"
          >
            Direct to the gateway
          </ModeButton>
        </div>
      </header>

      {mode === "proxy" ? (
        <p className="font-ui text-[0.6875rem] text-[color:var(--muted)]">
          Requests go to <code className="font-mono">/api/proxy/gateway</code> on this page&apos;s
          origin and the agent forwards them. A harness does not take this path, so a turn that
          works here says the control plane works — not that it is reachable from where the harness
          stands. Switch to <em>Direct</em> to test that.
        </p>
      ) : (
        <>
          <label className="font-ui flex flex-col gap-1 text-[0.6875rem] text-[color:var(--muted)]">
            <span>
              Base URL — what you would give an OpenAI client as{" "}
              <code className="font-mono">base_url</code>
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <input
                data-testid="base-url"
                type="text"
                value={baseUrl}
                onChange={(e) => onBaseUrl(e.target.value)}
                onBlur={() => onBaseUrl(displayBaseUrl(baseUrl) || baseUrl)}
                spellCheck={false}
                placeholder="http://192.168.1.20:8080/v1"
                className="min-w-0 basis-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 font-mono text-xs text-[color:var(--foreground)] outline-none hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)] sm:flex-1 sm:basis-auto"
              />
              {guessDisplay && guessDisplay !== baseUrl && (
                <button
                  type="button"
                  onClick={() => onBaseUrl(guessDisplay)}
                  className="rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-[0.6875rem] hover:bg-[color:var(--panel-hover)]"
                  title="This page's host plus the gateway's port from the agent's topology. A guess: a container that publishes the port under another number will make it wrong, exactly as it would be for a harness given the same numbers."
                >
                  Use guess {guessDisplay}
                </button>
              )}
              <CopyButton
                text={displayBaseUrl(baseUrl) || baseUrl}
                label="Copy"
                title="Copy the base URL"
              />
            </span>
          </label>
          {hints.map((hint) => (
            <p
              key={hint}
              className="status-warn rounded-[var(--radius)] px-2 py-1 text-[0.6875rem]"
            >
              {hint}
            </p>
          ))}

          <label className="font-ui flex flex-col gap-1 text-[0.6875rem] text-[color:var(--muted)]">
            <span>
              API key — the bearer the gateway checks; an OpenAI client sends it as{" "}
              <code className="font-mono">api_key</code>
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <input
                data-testid="api-key"
                type={revealed ? "text" : "password"}
                value={apiKey}
                onChange={(e) => onApiKey(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                className="min-w-0 basis-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 font-mono text-xs text-[color:var(--foreground)] outline-none hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)] sm:flex-1 sm:basis-auto"
              />
              <button
                type="button"
                onClick={() => setRevealed((r) => !r)}
                className="rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-[0.6875rem] hover:bg-[color:var(--panel-hover)]"
              >
                {revealed ? "Hide" : "Reveal"}
              </button>
              <CopyButton text={apiKey} label="Copy" title="Copy the key" />
              {!keyIsSession && sessionToken !== null && (
                <button
                  type="button"
                  onClick={() => onApiKey(sessionToken)}
                  className="rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-[0.6875rem] hover:bg-[color:var(--panel-hover)]"
                >
                  Use this session&apos;s token
                </button>
              )}
              <button
                type="button"
                data-testid="mint-client-key"
                disabled={minting}
                onClick={() => void mintClientKey()}
                className="rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-[0.6875rem] hover:bg-[color:var(--panel-hover)] disabled:opacity-50"
              >
                {minting ? "Making…" : "Make a client key"}
              </button>
            </span>
          </label>
          {mintError && (
            <p className="status-error rounded-[var(--radius)] px-2 py-1 text-[0.6875rem]">
              {mintError}
            </p>
          )}
          <p className="font-ui text-[0.6875rem] text-[color:var(--muted)]">
            {keyIsSession
              ? "This is the token you were issued when you signed in. It can do everything you can " +
                "and it expires 14 days after sign-in, so it is right for a one-off check and wrong " +
                "for a harness you leave configured -- make a client key for that."
              : "A key you typed or made. The gateway accepts the operator's session token, a " +
                "component's service token, or a client key; anything else is refused with a 401."}
          </p>
        </>
      )}
    </section>
  );
}

function ModeButton({
  active,
  onClick,
  children,
  testId,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
  title: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      data-testid={testId}
      onClick={onClick}
      title={title}
      className={`rounded-[var(--radius)] border px-2 py-1 transition-colors ${
        active
          ? "border-[color:var(--accent-left)] bg-[color:var(--panel-soft)] text-[color:var(--foreground)]"
          : "border-[color:var(--border)] text-[color:var(--muted)] hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
      }`}
    >
      {children}
    </button>
  );
}
