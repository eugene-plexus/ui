/**
 * Leaving the install (ui#20, agent#21): `POST /v1/node/unenroll` on this
 * machine's agent, with the session, or with this machine's own passphrase
 * and no session.
 *
 * The passphrase way is for a machine that can get no session its own agent
 * accepts: one the install removed, or one whose control root is gone. The
 * agent allows it only then, and refuses it while the install still lists
 * the machine.
 */

import { api } from "@/lib/api";
import type { components } from "@/generated/agent";

export type UnenrollResult = components["schemas"]["UnenrollResult"];

/** Leave with the session: the root is told first. */
export function leaveWithSession(): Promise<UnenrollResult> {
  return api.post<UnenrollResult>("agent", "/v1/node/unenroll", {});
}

/** Leave with this machine's own passphrase and no session. */
export function leaveWithPassphrase(passphrase: string): Promise<UnenrollResult> {
  return api.post<UnenrollResult>("agent", "/v1/node/unenroll", { passphrase }, { skipAuth: true });
}

/** The one line that says what leaving did, then what is owed, if anything. */
export function leftMessage(result: UnenrollResult): string {
  const from = result.previousControlUrl ? ` at ${result.previousControlUrl}` : "";
  const head = `This machine left the install${from} and works on its own now.`;
  if (result.controlNotified) return head;
  return result.detail ? `${head} ${result.detail}` : head;
}

/** The sign-in refusals after which leaving by passphrase is offered. */
export function offersLeave(status: number, title: string | undefined): boolean {
  return (
    (status === 409 && title === "This machine was removed from the install") ||
    (status === 503 && title === "Control root unreachable")
  );
}
