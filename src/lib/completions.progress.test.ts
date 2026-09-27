/**
 * The stream reader, for what a stream says besides the answer.
 *
 * 2026-09-27: the gateway streams a reasoning model's thinking as
 * `delta.reasoning_content` and, when asked, what the backend is doing as
 * progress chunks (`choices: []`, `x_eugene_plexus.progress`). This
 * reader looked at `content` and `tool_calls` only, so the thinking was
 * discarded one hop from the screen.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { type RequestReport, buildChatRequest, streamChatCompletion } from "./completions";
import type { StreamProgress } from "./types";

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
const progress = (p: StreamProgress) =>
  frame({ ...base, choices: [], x_eugene_plexus: { progress: p } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("asking", () => {
  it("asks for progress on a stream only when something will read it", () => {
    expect(buildChatRequest({ model: "m", messages: [] }, true)).not.toHaveProperty(
      "stream_options",
    );
    expect(
      buildChatRequest({ model: "m", messages: [], onProgress: () => {} }, true),
    ).toMatchObject({
      stream_options: { include_progress: true },
    });
    // A batch request cannot carry stream_options at all: the gateway
    // refuses it.
    expect(
      buildChatRequest({ model: "m", messages: [], onProgress: () => {} }, false),
    ).not.toHaveProperty("stream_options");
  });
});

describe("reading", () => {
  const READ: StreamProgress = {
    stage: "prompt",
    prompt_tokens: 100,
    cached_tokens: 0,
    processed_tokens: 50,
  };

  function script() {
    return sseResponse([
      progress({ stage: "working" }),
      progress(READ),
      delta({ role: "assistant" }),
      delta({ reasoning_content: "Which " }),
      delta({ reasoning_content: "way?" }),
      progress({ stage: "tool", tool: "Read" }),
      delta({ content: "East" }),
      frame({
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        x_eugene_plexus: { driver: "box", latency_ms: 900 },
      }),
      "data: [DONE]\n\n",
    ]);
  }

  it("hands each part to its own reader, in order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => script()),
    );
    const seen: string[] = [];
    const result = await streamChatCompletion(
      {
        model: "m",
        messages: [],
        onProgress: (p) => seen.push(`progress:${p.stage}`),
        onReasoning: (d) => seen.push(`thought:${d}`),
      },
      (d) => seen.push(`word:${d}`),
    );
    expect(seen).toEqual([
      "progress:working",
      "progress:prompt",
      "thought:Which ",
      "thought:way?",
      "progress:tool",
      "word:East",
    ]);
    expect(result.reasoning).toBe("Which way?");
    expect(result.choices[0]?.message.content).toBe("East");
  });

  it("does not take a progress chunk for the routing envelope or for the first token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => script()),
    );
    let report: RequestReport | undefined;
    const result = await streamChatCompletion(
      { model: "m", messages: [], onProgress: () => {}, onReport: (r) => (report = r) },
      () => {},
    );
    expect(result.x_eugene_plexus).toEqual({ driver: "box", latency_ms: 900 });
    expect(report?.progressFrames).toBe(3);
    expect(report?.reasoningDeltas).toBe(2);
    // Five frames of output (role, two thoughts, a word, the end); the
    // three progress chunks are counted apart.
    expect(report?.frames).toBe(5);
  });

  it("keeps a turn that only thought, rather than throwing it away", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          delta({ reasoning_content: "Thinking it over" }),
          frame({ error: { message: "the backend closed the connection mid-answer" } }),
          "data: [DONE]\n\n",
        ]),
      ),
    );
    const result = await streamChatCompletion({ model: "m", messages: [] }, () => {});
    expect(result.reasoning).toBe("Thinking it over");
    expect(result.truncatedBy).toBe("the backend closed the connection mid-answer");
  });
});

describe("the first-token clock", () => {
  it("starts at the first output, not at a progress chunk", async () => {
    // The rate the page works out divides by the time after this mark;
    // a prompt read on the processor would otherwise count as generating.
    const encoder = new TextEncoder();
    const parts: Array<[number, string]> = [
      [0, progress({ stage: "prompt", prompt_tokens: 10, processed_tokens: 5 })],
      [120, delta({ content: "East" }, "stop")],
      [0, "data: [DONE]\n\n"],
    ];
    let index = 0;
    const body = {
      getReader() {
        return {
          async read() {
            const next = parts[index++];
            if (!next) return { done: true, value: undefined };
            await new Promise((r) => setTimeout(r, next[0]));
            return { done: false, value: encoder.encode(next[1]) };
          },
          releaseLock() {},
          async cancel() {},
        };
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", body }) as unknown as Response),
    );
    const result = await streamChatCompletion(
      { model: "m", messages: [], onProgress: () => {} },
      () => {},
    );
    expect(result.report.firstFrameMs).toBeGreaterThanOrEqual(100);
  });
});
