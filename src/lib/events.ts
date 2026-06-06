/**
 * Afferent-event injection — the UI's "send" path under the M2 contract.
 *
 * There is no synchronous chat endpoint anymore. Sending a message means
 * POSTing one `AfferentEvent` to `/v1/events`; the orchestrator enqueues
 * it for the continuous loop and returns `202` immediately. Eugene's reply
 * (if it elects to speak) arrives asynchronously as a `speech` event on
 * `GET /v1/stream/consciousness` — see lib/stream + lib/useConsciousnessStream.
 */

import { api } from "./api";
import type { AfferentEvent, MessageSource } from "./types";

/** The all-zero UUID. A UI message tagged with this person means "the
 * operator" — the orchestrator resolves it against identity. Mirrors the
 * orchestrator's NIL_PERSON_ID sentinel. */
export const NIL_PERSON_ID = "00000000-0000-0000-0000-000000000000";

/** The local UI is one platform/source among many (discord, …). DMs by
 * definition — the operator talking to Eugene directly. */
const UI_SOURCE: MessageSource = { platform: "ui", isDirectMessage: true };

interface InjectResult {
  eventId: string;
  accepted: boolean;
}

/** RFC4122 v4 id. `crypto.randomUUID` is available in secure contexts
 * (https + localhost, which covers every Eugene deployment); the fallback
 * keeps a plain-http LAN dev box working. */
function newEventId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Send a chat message as a `message`-kind AfferentEvent. Returns the
 * minted `eventId` so the caller can correlate it to the `speech` event
 * whose `inResponseTo` echoes it (used to clear the per-send "thinking"
 * indicator and to time the reply).
 */
export async function sendMessageEvent(opts: {
  content: string;
  conversationId?: string | null;
  personId?: string;
}): Promise<InjectResult> {
  const eventId = newEventId();
  const event: AfferentEvent = {
    eventId,
    kind: "message",
    source: UI_SOURCE,
    timestamp: new Date().toISOString(),
    message: {
      personId: opts.personId ?? NIL_PERSON_ID,
      content: opts.content,
      source: UI_SOURCE,
      ...(opts.conversationId ? { conversationId: opts.conversationId } : {}),
    },
  };
  return api.post<InjectResult>("orchestrator", "/v1/events", event);
}
