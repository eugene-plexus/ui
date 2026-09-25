/**
 * What the wizard's buttons actually do, minus the rendering.
 *
 * Extracted at M9 with the bodies unchanged - each one carries a lesson
 * that a rewrite would have had to relearn:
 *
 * - `withRetry` exists because **initializing restarts every child**, so
 *   anything the wizard does next can land in that window.
 * - `initializeControlRoot` deliberately does **not** retry: the trust
 *   root is skipped by `restart_all` on purpose, and its 409 is a final
 *   answer, not a race.
 * - `driverNameFor` / `freeDriverPort` exist because nothing declares a
 *   driver for a backend the agent does not supervise, so a form that adds
 *   one has to create the component rather than patch one that is not
 *   there.
 *
 * Since S2 of the hobbyist UX plan the backend half of this file has no
 * caller in the wizard: adding an app the person already runs is a task,
 * not a setup step, and it lives at `/backends/add`. Those helpers stay
 * here rather than moving, because the lessons above were learned here
 * and the page imports them by name.
 */

import { WIZARD_PROVIDERS } from "@/lib/agent";
import { ApiError, api, describeError } from "@/lib/api";
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
 * Enroll **this** host's agent with the control root it just spawned,
 * granting it `gateway` -- this is the machine that runs the install's
 * gateway, which needs the grant to reach every other machine's drivers
 * and agents (per-node token keys, D8). Workers joined from `/nodes`
 * get no grant.
 *
 * A locked decision nothing had ever implemented outside an acceptance
 * script: *"Every node enrolls the same way, including the control host's
 * ... the control host's agent mints a join token at the root it spawned
 * and enrolls through it; that is also what puts the control host in
 * `/v1/nodes` at all."*
 *
 * **What it costs to skip, which is how this was found.** An unenrolled
 * agent is its own authority, as `node:local`; nothing else trusts it. So
 * a session from the agent -- which is every token this browser has --
 * does not verify at the control root, and every control-root page 401s,
 * clears the session and bounces to login. M9's Playwright arc walked
 * into it on `/nodes`; nothing before had a control-root page to walk
 * into.
 *
 * Order matters and is unforgiving:
 *   1. log in at the control root - it has its own auth and just got a
 *      passphrase, and only an operator there can mint a join token;
 *   2. mint the token;
 *   3. enroll, which **invalidates the session this wizard is holding**,
 *      because the agent stops being its own authority and trusts the
 *      root's bundle instead;
 *   4. log in again at the agent, which now forwards to the root and
 *      comes back with a session addressed to this machine.
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
    { grants: ["gateway"] },
    // The root's session, not the browser's: before enrollment this
    // agent is its own authority and the root trusts none of its tokens.
    // The control root is declared on this machine, so the proxy passes
    // the header through rather than translating it.
    { bearer: session.sessionToken },
  );
  await api.post("agent", "/v1/node/enroll", { controlUrl, token: minted.token });
  // The enrollment restarted every child and changed what this agent
  // trusts, so this is retried: the agent answers immediately but is
  // briefly the only thing that does.
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
  // **Rewritten for R1.5, review §6.3 #35 and §6.1 #7.** The old version
  // of this sentence was the worst copy in the product and it was
  // invisible to S8's checker, because a backtick literal matched
  // neither extractor pattern -- so it named the "trust root", ran to
  // seventy words, and ended by telling a first-time user in a browser
  // to POST JSON to an endpoint and to look at a PowerShell script in a
  // repository they may not have. The commonest cause is that something
  // else already holds the control root's port, which the install now
  // reports as an issue of its own with the holder named.
  //
  // Three short sentences: what happened, what not to do, where the
  // diagnosis is.
  const because = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `The control root did not take the passphrase (${because}).` +
      ` Your passphrase is saved on this machine, so do not run setup again: it will be` +
      ` refused.` +
      ` Open Needs attention on the home page — it names what is wrong and what to do.`,
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

/**
 * Whether a chosen backend carries the credentials its provider needs.
 * "None chosen" is false here: the caller is a form whose button does
 * nothing useful without a provider. The model id is deliberately NOT
 * required - a driver has to exist before it can be asked what it
 * serves, so the model is picked afterwards from a real list.
 */
export function backendCredentialsComplete(b: BackendDraft): boolean {
  if (!b.provider) return false;
  const credentials = WIZARD_PROVIDERS.find((p) => p.key === b.provider)?.credentials ?? [];
  if (credentials.includes("api_key") && !b.apiKey.trim()) return false;
  if (credentials.includes("base_url") && !b.baseUrl.trim()) return false;
  return true;
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
 * on: the component's own, which is `describeError`.
 *
 * **It used to replace every 409 with "remove the auth block from
 * agent.yaml by hand"** -- the instruction the agent's own 409s were
 * rewritten to stop giving (review §6.1 #7), because it is the most
 * destructive thing this product can tell someone and a browser cannot
 * carry it out. Worse, 409 is not only "already set up": adding an app
 * whose name is taken, and an install whose passphrase is missing from
 * its file, both answer 409, and each has its own sentence that says
 * what to do. The one for the missing passphrase says the exact opposite
 * of the old advice.
 */
export function formatStartError(e: unknown): string {
  return describeError(e);
}
