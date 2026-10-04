/**
 * Server-sent events off a `Response`, one `{event, data}` per frame.
 *
 * The playground's other doors share this; chat keeps its own loop in
 * `completions.ts` because it counts frame kinds as it reads. The two
 * rules either must get right: a frame can be split across reads, so a
 * partial frame waits for the blank line that ends it; and a frame's
 * `data:` lines join with newlines.
 */

export interface SseEvent {
  /** The `event:` name, or null for an unnamed frame. */
  event: string | null;
  data: string;
}

function parseFrame(frame: string): SseEvent | null {
  let event: string | null = null;
  const data: string[] = [];
  for (const raw of frame.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return data.length > 0 ? { event, data: data.join("\n") } : null;
}

export async function* sseEvents(response: Response): AsyncGenerator<SseEvent> {
  if (!response.body) throw new Error("the answer had no stream body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      const frames = buffered.split("\n\n");
      buffered = frames.pop() ?? "";
      for (const frame of frames) {
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
      }
    }
    const last = parseFrame(buffered + decoder.decode());
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}
