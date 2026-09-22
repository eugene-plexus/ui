/**
 * The one conversation the playground and Home's "Try it" card share.
 *
 * The playground has kept its transcript in `sessionStorage` since M0 —
 * browser-side, per tab, the design's explicit call until a component
 * for durable history exists. Home's card is the same composer wired to
 * the same code (hobbyist UX §6.1), so a first reply that lands on Home
 * must be the conversation the playground opens on "Continue in the
 * Playground". Two writers of one key is how a shape drifts, so both
 * read and write through here and the shape is defined once.
 *
 * **The shape is `{ model, messages }` under `eugene-playground`**, and
 * a test asserts those two keys and nothing else — a third field added
 * on one side would be silently dropped by the other.
 *
 * Pure apart from the storage calls, and tolerant on read: a value from
 * an older build, a private-mode `sessionStorage` that throws, or a hand-
 * edited entry all come back as an empty conversation rather than an
 * error on the page that shows it.
 */

import type { ChatCompletionMessage } from "./types";

/** A data URL that is valid, empty, and eight bytes long. */
const STRIPPED_IMAGE_URL = "data:,";

/**
 * The same messages with every inline image's bytes removed.
 *
 * Written for the storage fallback below: a conversation with 10 MB of
 * base64 images does not fit in `sessionStorage`, and before images the
 * failure mode was already "the conversation does not survive a
 * reload". Losing the whole transcript to one screenshot is worse than
 * a reload that keeps the words and drops the pixels -- the request
 * that was SENT is unchanged either way, and the report holds it.
 */
export function stripImageBytes(messages: PlaygroundMessage[]): PlaygroundMessage[] {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    return {
      ...message,
      content: message.content.map((part) =>
        part.type === "image_url"
          ? { ...part, image_url: { ...part.image_url, url: STRIPPED_IMAGE_URL } }
          : part,
      ),
    };
  });
}

export const PLAYGROUND_STORAGE_KEY = "eugene-playground";

export type PlaygroundMessage = ChatCompletionMessage & {
  /** Browser time when the first part of this response arrived; never sent to a model. */
  generatedAt?: string;
};

export function requestMessages(messages: PlaygroundMessage[]): ChatCompletionMessage[] {
  return messages.map((message) => {
    const wire = { ...message };
    delete wire.generatedAt;
    return wire;
  });
}

export interface PlaygroundTranscript {
  model: string | null;
  messages: PlaygroundMessage[];
}

function empty(): PlaygroundTranscript {
  return { model: null, messages: [] };
}

/** Parse whatever is stored, which may be nothing or not ours. */
export function parseTranscript(raw: string | null | undefined): PlaygroundTranscript {
  if (!raw) return empty();
  try {
    const parsed = JSON.parse(raw) as Partial<PlaygroundTranscript> | null;
    if (typeof parsed !== "object" || parsed === null) return empty();
    return {
      model: typeof parsed.model === "string" ? parsed.model : null,
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    };
  } catch {
    return empty();
  }
}

/** The stored form: exactly the two keys, in this order. */
export function serializeTranscript(transcript: PlaygroundTranscript): string {
  const payload: PlaygroundTranscript = {
    model: transcript.model,
    messages: transcript.messages,
  };
  return JSON.stringify(payload);
}

export function readPlaygroundTranscript(): PlaygroundTranscript {
  if (typeof window === "undefined") return empty();
  try {
    return parseTranscript(sessionStorage.getItem(PLAYGROUND_STORAGE_KEY));
  } catch {
    // sessionStorage throws in some private modes; start empty.
    return empty();
  }
}

export function writePlaygroundTranscript(transcript: PlaygroundTranscript): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(PLAYGROUND_STORAGE_KEY, serializeTranscript(transcript));
  } catch {
    // Almost always the quota, and almost always because of inline
    // image bytes. Retry with the pixels stripped so the words survive
    // a reload; if even that fails (private mode), give up as before.
    try {
      sessionStorage.setItem(
        PLAYGROUND_STORAGE_KEY,
        serializeTranscript({
          model: transcript.model,
          messages: stripImageBytes(transcript.messages),
        }),
      );
    } catch {
      // The conversation just does not survive a reload.
    }
  }
}
