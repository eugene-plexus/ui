/**
 * Unlock the control root with the passphrase that just signed the operator in.
 *
 * Reported from the live install (Troy, 2026-09-13): after updating the
 * container, the UI asked for the passphrase at sign-in and then `/nodes`
 * asked for it *again*. Two prompts for one secret. The wizard sets the
 * same passphrase on the agent and on the control root — `setup` posts
 * it to both `initialize` endpoints, and a test asserts they match — but
 * sign-in posted it only to the agent, which is not the thing that seals
 * on restart. The control root holds the install's signing key sealed
 * under the passphrase and, in a container with no OS keyring, comes
 * back locked every time it starts; until something posts the passphrase
 * to *its* `/v1/auth/login`, the gateway cannot read the topology and
 * `/v1/models` is empty.
 *
 * So sign-in does that too. The outcome never blocks the login: the
 * agent accepted the passphrase, the session is real, and a root that is
 * unreachable, uninitialized or keyed differently is the Nodes screen's
 * business to explain — it keeps its own unlock form for exactly those
 * cases.
 */

import { ApiError, api } from "./api";

export type ControlUnlockOutcome =
  /** The root accepted the passphrase (or was already open; login is idempotent). */
  | "unlocked"
  /** The root has a different passphrase. Rare — a re-initialized side. */
  | "mismatch"
  /** Nothing to unlock from here: no root in the topology, not enrolled, or it did not answer. */
  | "unavailable";

/** Long enough for Argon2id to derive the key on a slow NAS; short
 * enough that a dead root does not hold the login screen hostage. */
const UNLOCK_TIMEOUT_MS = 8000;

/**
 * Is this the *sealed* 503 rather than the *uninitialized* one?
 *
 * The control root distinguishes them carefully — `dependencies.py` says
 * telling them apart "matters most on the day it matters at all",
 * because "run first-run setup" is advice to wipe an install that
 * already exists. The Nodes page once threw the distinction away by
 * returning one sentence for every 503, so a sealed root read as an
 * absent one.
 *
 * It lives here, beside the unlock, rather than in each screen that asks
 * the question: two copies of this rule are two chances to flatten the
 * distinction again, and the Issues badge asks it on every page now.
 */
export function isLockedError(e: unknown): boolean {
  if (!(e instanceof ApiError) || e.status !== 503) return false;
  if (typeof e.body !== "object" || e.body === null) return false;
  const detail = (e.body as { detail?: unknown }).detail;
  if (typeof detail !== "object" || detail === null) return false;
  const problem = detail as { type?: string; title?: string };
  return problem.type?.endsWith("#locked") === true || problem.title === "Locked";
}

export async function unlockControlRoot(
  passphrase: string,
  sessionToken: string,
): Promise<ControlUnlockOutcome> {
  try {
    // `bearer`, not the stored session: the proxy spends this credential
    // to find the root when it lives on another node, and a 401 from a
    // mismatched passphrase must not clear the session that was just
    // issued -- `api.ts` only bounces to /login on a 401 against the
    // stored token, never against a supplied one.
    await api.post(
      "control",
      "/v1/auth/login",
      { passphrase },
      {
        bearer: sessionToken,
        timeoutMs: UNLOCK_TIMEOUT_MS,
      },
    );
    return "unlocked";
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return "mismatch";
    return "unavailable";
  }
}
