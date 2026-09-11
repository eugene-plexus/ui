/**
 * What pressing Start actually does, minus the rendering.
 *
 * The wizard treats the whole flow as one transaction, and these are its
 * steps' helpers. Extracted at M9 with the bodies unchanged - each one
 * carries a lesson that a rewrite would have had to relearn:
 *
 * - `withRetry` exists because **initializing restarts every child**, so
 *   anything the wizard does next can land in that window.
 * - `initializeControlRoot` deliberately does **not** retry: the trust
 *   root is skipped by `restart_all` on purpose, and its 409 is a final
 *   answer, not a race.
 * - `driverNameFor` / `freeDriverPort` exist because nothing declares a
 *   driver for a backend the agent does not supervise, so the wizard has
 *   to create one rather than patch one that is not there.
 */

import { WIZARD_PROVIDERS } from "@/lib/agent";
import { ApiError, api } from "@/lib/api";
import type { Component } from "@/lib/types";

import type { BackendDraft } from "./draft";

/**
 * Retry a call across the restart the wizard itself causes.
 *
 * `POST /v1/auth/initialize` makes the master key available, and the agent
 * responds by respawning every supervised child so each one gets it. Anything
 * the wizard does immediately afterwards can land in that window and be
 * refused, which reads to the operator as their setup failing.
 */
export async function withRetry<T>(
  call: () => Promise<T>,
  attempts = 10,
  delayMs = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await call();
    } catch (e) {
      lastError = e;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

/**
 * Enroll **this** host's agent with the control root it just spawned.
 *
 * A locked decision nothing had ever implemented outside an acceptance
 * script: *"Every node enrolls the same way, including the control host's
 * ... the control host's agent mints a join token at the root it spawned
 * and enrolls through it; that is also what puts the control host in
 * `/v1/nodes` at all."*
 *
 * **What it costs to skip, which is how this was found.** An unenrolled
 * agent mints a fresh random signing key on every restart; the control
 * root mints the install's. So a session token from the agent - which is
 * every token this browser has - does not verify at the control root, and
 * every control-root page 401s, clears the session and bounces to login.
 * M9's Playwright arc walked into it on `/nodes`; nothing before had a
 * control-root page to walk into.
 *
 * Order matters and is unforgiving:
 *   1. log in at the control root - it has its own auth and just got a
 *      passphrase, and only an operator there can mint a join token;
 *   2. mint the token;
 *   3. enroll, which **invalidates the session this wizard is holding**,
 *      because the key it was signed with has been replaced;
 *   4. log in again at the agent, which now signs with the install's key.
 *
 * Returns the replacement session token. `restart_all` deliberately skips
 * the control root, so the root this just enrolled with stays up.
 */
export async function enrollLocalAgent(passphrase: string, controlUrl: string): Promise<string> {
  // Control ignores an Authorization header on its own login route, and
  // since the agent resolves proxy targets in process, nothing else is
  // reading one here either -- which is what makes the call below a
  // one-credential call again.
  const session = await api.post<{ sessionToken: string }>("control", "/v1/auth/login", {
    passphrase,
  });
  const minted = await api.post<{ token: string }>(
    "control",
    "/v1/nodes/join-token",
    {},
    // The root's token, not the browser's session: an install that has
    // not enrolled yet genuinely has two signing keys, and this call is
    // addressed to the one holding the other. It used to need a second
    // header to say so, because resolving `control` spent the first.
    { bearer: session.sessionToken },
  );
  await api.post("agent", "/v1/node/enroll", { controlUrl, token: minted.token });
  // The enrollment restarted every child and replaced the signing key, so
  // this is retried: the agent answers immediately but is briefly the only
  // thing that does.
  const replacement = await withRetry(() =>
    api.post<{ sessionToken: string }>(
      "agent",
      "/v1/auth/login",
      { passphrase },
      { skipAuth: true },
    ),
  );
  return replacement.sessionToken;
}

/**
 * The URL the local agent should use to reach the control root.
 *
 * Read from the agent's own topology rather than guessed, because the
 * agent is the thing that spawned it and therefore the thing that knows
 * which port it is on. The browser cannot supply this: it reaches the
 * control root through a proxy that resolves it the same way.
 */
export function controlUrlFrom(components: Component[]): string | null {
  const entry = components.find((c) => c.kind === "control");
  return entry?.url ? String(entry.url).replace(/\/+$/, "") : null;
}

/**
 * Set the operator passphrase on the control root.
 *
 * Its own function rather than a `withRetry` call, for two reasons that
 * `withRetry` gets wrong here.
 *
 * **409 is a final answer, not a failure.** It means an earlier run already
 * initialized this install, and there is no reset endpoint by design. Retrying
 * it would spend ten seconds re-learning something settled.
 *
 * **There is no restart window to ride out.** `withRetry` exists because
 * `POST /v1/auth/initialize` on the agent respawns every supervised child. The
 * supervisor deliberately skips the trust root — a restart hands it nothing
 * (it receives no key from the agent) and costs it everything (it comes back
 * with its keys sealed and locked until someone logs in). So the only reason
 * to retry is a root still finishing the boot the agent spawned it for, which
 * is a few seconds at most.
 *
 * The session token rides along deliberately, so no `skipAuth`. Control ignores
 * an Authorization header on this route, but the UI's proxy needs the token to
 * resolve `control` to a URL through the agent's `/v1/components` — without it
 * that lookup 401s and the operator gets "no control component in the agent
 * topology", which is both alarming and false.
 */
export async function initializeControlRoot(passphrase: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await api.post("control", "/v1/auth/initialize", { passphrase });
      return;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) return;
      lastError = e;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  // Named as the trust root rather than reported as a bare HTTP error, because
  // the consequence is specific and worth saying: the agent has a passphrase
  // and the root does not, so every install-wide operation will refuse.
  const because = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `The trust root would not accept a passphrase (${because}). Your passphrase ` +
      `is set on this node's agent, but the control root has none, so it will ` +
      `refuse node enrollment, join tokens and its own configuration until it ` +
      `does. Setup cannot simply be repeated from here — the agent's passphrase ` +
      `is already set and it will refuse a second one — so check the control ` +
      `component's logs, then finish the job by POSTing the same passphrase to ` +
      `the control root's /v1/auth/initialize (scripts/dev-seed.ps1 does exactly ` +
      `this).`,
  );
}

/**
 * What this backend can actually serve.
 *
 * The driver discovers its backend's models and publishes them as
 * `suggestions` on the `modelId` field of its own config schema - live for
 * HTTP providers, hardcoded for the CLI ones. `modelId` stays free text
 * either way, so a model pulled after this call can still be typed in.
 */
export async function fetchBackendModels(driverName: string): Promise<string[]> {
  const schema = await api.get<{
    fields?: { key: string; suggestions?: string[] }[];
  }>(driverName, "/v1/config/schema");
  const field = (schema.fields ?? []).find((f) => f.key === "modelId");
  return field?.suggestions ?? [];
}

export function buildBackendPatch(b: BackendDraft): Record<string, unknown> {
  const credentials = WIZARD_PROVIDERS.find((p) => p.key === b.provider)?.credentials ?? [];
  const patch: Record<string, unknown> = { provider: b.provider };
  if (b.modelId.trim()) patch.modelId = b.modelId.trim();
  if (credentials.includes("api_key")) patch.apiKey = b.apiKey;
  if (credentials.includes("claude_cli")) patch.claudeCodeCliPath = b.claudeCodeCliPath || "claude";
  if (credentials.includes("codex_cli")) patch.codexCliPath = b.codexCliPath || "codex";
  if (credentials.includes("base_url")) patch.baseUrl = b.baseUrl;
  return patch;
}

/** A readable name, and a free one - the agent 409s a duplicate. */
export function driverNameFor(provider: string, existing: Component[]): string {
  const base = provider.replace(/_local$|_subscription$/, "").replace(/_/g, "-");
  const taken = new Set(existing.map((c) => c.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  }
}

/**
 * A port below the range the agent allocates companions from (8090+), so a
 * driver added here can never collide with one the agent declares later.
 * 8081 is the inference-driver default in the specs' `servers` block.
 */
export function freeDriverPort(existing: Component[]): number {
  const taken = new Set(
    existing.map((c) => Number(new URL(c.url).port)).filter((n) => Number.isFinite(n)),
  );
  for (let port = 8081; port < 8090; port++) {
    if (!taken.has(port)) return port;
  }
  throw new Error(
    "No free port between 8081 and 8089 for another driver. Remove one from Config first.",
  );
}

/**
 * Turn anything thrown during Start into one sentence an operator can act
 * on. Lifted out of the component unchanged, 409 special case included:
 * "already initialized" is the one failure whose fix is a different page.
 */
export function formatStartError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 409) {
      return (
        "This install already has a passphrase set. Use the login page " +
        "to sign in, or reset the install by removing the auth block " +
        "from agent.yaml by hand."
      );
    }
    if (
      typeof e.body === "object" &&
      e.body !== null &&
      "detail" in e.body &&
      typeof (e.body as { detail?: unknown }).detail === "object"
    ) {
      const detail = (e.body as { detail: { title?: string; detail?: string } }).detail;
      return detail.detail || detail.title || `${e.status} ${e.statusText}`;
    }
    return `${e.status} ${e.statusText}`;
  }
  return e instanceof Error ? e.message : String(e);
}
