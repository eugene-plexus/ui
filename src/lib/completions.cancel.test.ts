import { afterEach, describe, expect, it, vi } from "vitest";
import { streamChatCompletion, type Transport } from "./completions";

afterEach(() => vi.unstubAllGlobals());

/** Fetch stub respects the signal at both actual cancellation boundaries. */
function hangFetch(headers: boolean) {
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      const abortError = () => new DOMException("Aborted", "AbortError");
      if (!headers)
        return new Promise((_resolve, reject) => {
          if (signal!.aborted) reject(abortError());
          else signal!.addEventListener("abort", () => reject(abortError()), { once: true });
        });
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              if (signal!.aborted) controller.error(abortError());
              else
                signal!.addEventListener("abort", () => controller.error(abortError()), {
                  once: true,
                });
            },
          }),
          { status: 200 },
        ),
      );
    }),
  );
  return () => signal;
}

describe("a cancelled or timed-out stream closes its fetch", () => {
  for (const transport of [
    { kind: "proxy" },
    { kind: "direct", baseUrl: "http://example.invalid", key: "test" },
  ] satisfies Transport[]) {
    for (const headers of [false, true]) {
      it(`${transport.kind}: deadline covers ${headers ? "the body" : "waiting for headers"}`, async () => {
        const signal = hangFetch(headers);
        await expect(
          streamChatCompletion({ model: "m", messages: [], transport, timeoutMs: 20 }, () => {}),
        ).rejects.toThrow("took too long");
        expect(signal()?.aborted).toBe(true);
      });
      it(`${transport.kind}: caller can cancel ${headers ? "the body" : "waiting for headers"}`, async () => {
        const signal = hangFetch(headers);
        const controller = new AbortController();
        const completion = streamChatCompletion(
          { model: "m", messages: [], transport, signal: controller.signal },
          () => {},
        );
        const rejected = expect(completion).rejects.toThrow();
        await new Promise((r) => setTimeout(r, 0));
        controller.abort();
        await rejected;
        expect(signal()?.aborted).toBe(true);
      });
    }
  }
});
