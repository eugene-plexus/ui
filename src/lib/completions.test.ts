/**
 * The streaming client, and specifically the parts a first draft gets
 * wrong.
 *
 * Nothing here talks to a gateway. What is under test is the SSE
 * reassembly, which is pure: given a sequence of byte chunks, does the
 * right text come out in the right number of callbacks. The interesting
 * cases are the ones the network creates rather than the sender --
 * a frame arriving in two reads, a `[DONE]` sentinel, an error frame
 * after content has already been delivered.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { streamChatCompletion } from "./completions";

/** A `Response` whose body yields exactly these string chunks. */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const body = {
    getReader() {
      return {
        async read() {
          if (index >= chunks.length) return { done: true, value: undefined };
          return { done: false, value: encoder.encode(chunks[index++]) };
        },
        releaseLock() {},
      };
    },
  };
  return { ok: true, status: 200, statusText: "OK", body } as unknown as Response;
}

function frame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function contentChunk(text: string) {
  return {
    id: "c",
    object: "chat.completion.chunk",
    created: 0,
    model: "m",
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(response: Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response),
  );
}

describe("streamChatCompletion", () => {
  it("calls back once per delta and assembles the whole answer", async () => {
    mockFetch(
      sseResponse([
        frame(contentChunk("Hel")),
        frame(contentChunk("lo ")),
        frame(contentChunk("world")),
        "data: [DONE]\n\n",
      ]),
    );
    const seen: string[] = [];
    const result = await streamChatCompletion(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      (delta) => seen.push(delta),
    );
    expect(seen).toEqual(["Hel", "lo ", "world"]);
    expect(result.choices?.[0]?.message?.content).toBe("Hello world");
  });

  it("reassembles a frame that arrives in two reads", async () => {
    // The sender framed one event; the network split it. Nothing
    // guarantees a read ends on a frame boundary, and a parser that
    // assumes otherwise drops or corrupts whichever token straddles it.
    const whole = frame(contentChunk("split"));
    const cut = Math.floor(whole.length / 2);
    mockFetch(sseResponse([whole.slice(0, cut), whole.slice(cut), "data: [DONE]\n\n"]));

    const seen: string[] = [];
    await streamChatCompletion(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      (delta) => seen.push(delta),
    );
    expect(seen).toEqual(["split"]);
  });

  it("keeps delivered text when the stream is truncated, and says so", async () => {
    // Past the first token the gateway cannot fail over, so a dead
    // backend becomes an error frame mid-answer. What the user has
    // already read is real and must survive; the caller is told the
    // answer is incomplete rather than left to assume it is finished.
    mockFetch(
      sseResponse([
        frame(contentChunk("half an ")),
        frame({ error: { message: "backend died", type: "upstream_error" } }),
        "data: [DONE]\n\n",
      ]),
    );
    const seen: string[] = [];
    const result = await streamChatCompletion(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      (delta) => seen.push(delta),
    );
    expect(seen).toEqual(["half an "]);
    expect(result.choices?.[0]?.message?.content).toBe("half an ");
    expect((result as { truncatedBy?: string }).truncatedBy).toContain("backend died");
  });

  it("throws when the stream fails before delivering anything", async () => {
    // Nothing reached the user, so this is an ordinary failure and
    // should read like one -- not an empty assistant message.
    mockFetch(
      sseResponse([
        frame({ error: { message: "every backend failed", type: "upstream_error" } }),
        "data: [DONE]\n\n",
      ]),
    );
    await expect(
      streamChatCompletion({ model: "m", messages: [{ role: "user", content: "hi" }] }, () => {}),
    ).rejects.toThrow(/every backend failed/);
  });

  it("carries usage and the routing extension off the final frame", async () => {
    mockFetch(
      sseResponse([
        frame(contentChunk("hi")),
        frame({
          id: "c",
          object: "chat.completion.chunk",
          created: 0,
          model: "served-model",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
          x_eugene_plexus: { driver: "d", tier: 2 },
        }),
        "data: [DONE]\n\n",
      ]),
    );
    const result = await streamChatCompletion(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      () => {},
    );
    expect(result.model).toBe("served-model");
    expect(result.usage?.total_tokens).toBe(4);
    expect(result.x_eugene_plexus?.tier).toBe(2);
    expect(result.choices?.[0]?.finish_reason).toBe("stop");
  });
});
