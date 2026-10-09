/**
 * Spoken replies on the chat path (P2b, U2 of playground-doors.md): what
 * is asked, and how the streamed audio and its words come back.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildChatRequest, streamChatCompletion } from "./completions";
import { bytesToBase64 } from "./imageAttachments";
import { base64ToBytes } from "./mediaAttachments";

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
        async cancel() {},
      };
    },
  };
  return { ok: true, status: 200, statusText: "OK", body } as unknown as Response;
}

const frame = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
const base = { id: "c", object: "chat.completion.chunk", created: 0, model: "m" };
const delta = (d: Record<string, unknown>, finish: string | null = null) =>
  frame({ ...base, choices: [{ index: 0, delta: d, finish_reason: finish }] });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("asking for a spoken reply", () => {
  it("asks for audio with the voice, pcm16 when streamed and wav when not", () => {
    const opts = { model: "m", messages: [], audio: { voice: "coral" } };
    expect(buildChatRequest(opts, true)).toMatchObject({
      modalities: ["text", "audio"],
      audio: { voice: "coral", format: "pcm16" },
    });
    expect(buildChatRequest(opts, false)).toMatchObject({
      audio: { voice: "coral", format: "wav" },
    });
  });

  it("asks for nothing extra when it is off", () => {
    const body = buildChatRequest({ model: "m", messages: [] }, true);
    expect(body).not.toHaveProperty("modalities");
    expect(body).not.toHaveProperty("audio");
  });
});

describe("reading a spoken reply", () => {
  it("joins the audio, streams its words as the answer, and reports what the bytes are", async () => {
    const pcm = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          delta({ role: "assistant" }),
          delta({ audio: { id: "a1", format: "pcm16", transcript: "Hello" } }),
          delta({ audio: { data: bytesToBase64(pcm.subarray(0, 1)), transcript: " there" } }),
          delta({ audio: { data: bytesToBase64(pcm.subarray(1)) } }),
          delta({}, "stop"),
          "data: [DONE]\n\n",
        ]),
      ),
    );
    const words: string[] = [];
    const result = await streamChatCompletion(
      { model: "m", messages: [], audio: { voice: "alloy" } },
      (d) => words.push(d),
    );
    expect(words).toEqual(["Hello", " there"]);
    // The words are the content: what a replay sends back in place of audio.
    expect(result.choices[0]?.message.content).toBe("Hello there");
    expect(result.spoken?.format).toBe("pcm16");
    expect(Array.from(base64ToBytes(result.spoken!.data))).toEqual(Array.from(pcm));
  });

  it("carries no spoken audio when none arrived", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse([delta({ content: "text only" }, "stop"), "data: [DONE]\n\n"])),
    );
    const result = await streamChatCompletion({ model: "m", messages: [] }, () => {});
    expect(result.spoken).toBeUndefined();
  });
});
