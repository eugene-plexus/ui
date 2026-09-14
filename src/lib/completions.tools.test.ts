/**
 * Tool calls through the streaming client, and the direct transport.
 *
 * §0.3 of the diagnostic design: the first version of
 * `streamChatCompletion` read `delta.content` and nothing else, so a
 * streamed tool-call-only turn came out as an empty assistant message —
 * indistinguishable from "the model chose not to call anything". These
 * pin the accumulation rule against both shapes step 6 found in the
 * wild (OpenAI splits `arguments` mid-token; local engines send the
 * whole call in one delta), the report's counters, and that direct mode
 * dials the gateway itself with a bearer and nothing of ours.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type RequestReport,
  accumulateToolCallDeltas,
  buildChatRequest,
  listModels,
  streamChatCompletion,
  urlFor,
} from "./completions";

function sseResponse(chunks: string[], status = 200): Response {
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
  return { ok: status < 400, status, statusText: "OK", body } as unknown as Response;
}

function frame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function chunk(delta: Record<string, unknown>, finish: string | null = null) {
  return {
    id: "c",
    object: "chat.completion.chunk",
    created: 0,
    model: "m",
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("accumulateToolCallDeltas", () => {
  it("folds split arguments by index, id and name arriving once", () => {
    let calls = accumulateToolCallDeltas(
      [],
      [
        {
          index: 0,
          id: "call_1",
          type: "function",
          function: { name: "get_weather", arguments: '{"ci' },
        },
      ],
    );
    calls = accumulateToolCallDeltas(calls, [{ index: 0, function: { arguments: 'ty":"Os' } }]);
    calls = accumulateToolCallDeltas(calls, [{ index: 0, function: { arguments: 'lo"}' } }]);
    expect(calls).toEqual([
      {
        id: "call_1",
        type: "function",
        function: { name: "get_weather", arguments: '{"city":"Oslo"}' },
      },
    ]);
  });
  it("keeps two calls apart by index even when their fragments interleave", () => {
    const calls = accumulateToolCallDeltas(
      [],
      [
        { index: 0, id: "a", function: { name: "f", arguments: "{" } },
        { index: 1, id: "b", function: { name: "g", arguments: "[" } },
        { index: 0, function: { arguments: "}" } },
        { index: 1, function: { arguments: "]" } },
      ],
    );
    expect(calls.map((c) => [c.id, c.function.name, c.function.arguments])).toEqual([
      ["a", "f", "{}"],
      ["b", "g", "[]"],
    ]);
  });
  it("does not mutate the calls it was given", () => {
    const before = [
      { id: "a", type: "function" as const, function: { name: "f", arguments: "{" } },
    ];
    accumulateToolCallDeltas(before, [{ index: 0, function: { arguments: "}" } }]);
    expect(before[0]?.function.arguments).toBe("{");
  });
});

describe("streamChatCompletion with tool calls", () => {
  it("returns tool_calls on the message with content null, and counts the deltas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          frame(chunk({ role: "assistant" })),
          // One whole call in one delta: what Ollama does.
          frame(
            chunk({
              tool_calls: [
                {
                  index: 0,
                  id: "call_x",
                  type: "function",
                  function: { name: "get_weather", arguments: '{"city":"Oslo"}' },
                },
              ],
            }),
          ),
          frame({
            ...chunk({}, "tool_calls"),
            usage: { prompt_tokens: 40, completion_tokens: 12 },
          }),
          "data: [DONE]\n\n",
        ]),
      ),
    );
    const seenCalls: unknown[] = [];
    let report: RequestReport | undefined;
    const result = await streamChatCompletion(
      {
        model: "m",
        messages: [{ role: "user", content: "weather in Oslo?" }],
        tools: [{ type: "function", function: { name: "get_weather" } }],
        onToolCalls: (calls) => seenCalls.push(calls),
        onReport: (r) => (report = r),
      },
      () => {
        throw new Error("no content delta was sent, so onToken must not fire");
      },
    );
    const message = result.choices[0]?.message;
    expect(message?.content).toBeNull();
    expect(message?.tool_calls).toEqual([
      {
        id: "call_x",
        type: "function",
        function: { name: "get_weather", arguments: '{"city":"Oslo"}' },
      },
    ]);
    expect(result.choices[0]?.finish_reason).toBe("tool_calls");
    expect(seenCalls).toHaveLength(1);
    expect(report).toBeDefined();
    expect(report?.toolCallDeltas).toBe(1);
    expect(report?.contentDeltas).toBe(0);
    expect(report?.frames).toBe(3);
    expect(report?.finishReason).toBe("tool_calls");
    expect(report?.status).toBe(200);
    expect(report?.usage?.prompt_tokens).toBe(40);
    expect(report?.firstFrameMs).not.toBeNull();
  });

  it("assembles a call split across frames the way OpenAI splits it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          frame(
            chunk({ tool_calls: [{ index: 0, id: "c1", function: { name: "f", arguments: "" } }] }),
          ),
          frame(chunk({ tool_calls: [{ index: 0, function: { arguments: '{"a":' } }] })),
          frame(chunk({ tool_calls: [{ index: 0, function: { arguments: "1}" } }] })),
          frame(chunk({}, "tool_calls")),
          "data: [DONE]\n\n",
        ]),
      ),
    );
    const result = await streamChatCompletion({ model: "m", messages: [] }, () => {});
    expect(result.choices[0]?.message.tool_calls?.[0]?.function.arguments).toBe('{"a":1}');
    expect(result.report.toolCallDeltas).toBe(3);
  });

  it("carries tools, tool_choice and response_format on the body, and nothing when unset", () => {
    const plain = buildChatRequest({ model: "m", messages: [] }, true);
    expect(plain).toEqual({ model: "m", messages: [], stream: true });
    const withTools = buildChatRequest(
      {
        model: "m",
        messages: [],
        tools: [{ type: "function", function: { name: "f" } }],
        toolChoice: "required",
        responseFormat: { type: "json_object" },
      },
      false,
    );
    expect(withTools.tools).toHaveLength(1);
    expect(withTools.tool_choice).toBe("required");
    expect(withTools.response_format).toEqual({ type: "json_object" });
  });
});

describe("direct transport", () => {
  it("dials the base URL itself with the bearer, and the report says so", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return sseResponse([
          frame(chunk({ content: "ok" })),
          frame(chunk({}, "stop")),
          "data: [DONE]\n\n",
        ]);
      }),
    );
    let report: RequestReport | undefined;
    await streamChatCompletion(
      {
        model: "m",
        messages: [{ role: "user", content: "hi" }],
        transport: { kind: "direct", baseUrl: "http://gw:8280/v1/", key: "tok" },
        onReport: (r) => (report = r),
      },
      () => {},
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://gw:8280/v1/chat/completions");
    const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok");
    expect(headers["content-type"]).toBe("application/json");
    expect(report?.mode).toBe("direct");
    expect(report?.url).toBe("http://gw:8280/v1/chat/completions");
    expect(report?.reproduceUrl).toBe("http://gw:8280/v1/chat/completions");
    expect(report?.body).toBe(
      JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }], stream: true }),
    );
  });

  it("reports a network failure with the browser's own words and no status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    let report: RequestReport | undefined;
    await expect(
      streamChatCompletion(
        {
          model: "m",
          messages: [],
          transport: { kind: "direct", baseUrl: "http://127.0.0.1:1", key: "k" },
          onReport: (r) => (report = r),
        },
        () => {},
      ),
    ).rejects.toThrow(/Failed to fetch/);
    expect(report?.status).toBeNull();
    expect(report?.error).toBe("Failed to fetch");
    expect(report?.elapsedMs).not.toBeNull();
  });

  it("reports a 401 with the gateway's sentence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              detail: { title: "Invalid token", detail: "Bearer token rejected", status: 401 },
            }),
            {
              status: 401,
              statusText: "Unauthorized",
            },
          ),
      ),
    );
    let report: RequestReport | undefined;
    await expect(
      streamChatCompletion(
        {
          model: "m",
          messages: [],
          transport: { kind: "direct", baseUrl: "http://gw", key: "bad" },
          onReport: (r) => (report = r),
        },
        () => {},
      ),
    ).rejects.toThrow();
    expect(report?.status).toBe(401);
    expect(report?.error).toBe("Bearer token rejected");
  });

  it("lists models direct with the same bearer", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seen.push(url, (init.headers as Record<string, string>).authorization ?? "");
        return new Response(JSON.stringify({ object: "list", data: [] }), { status: 200 });
      }),
    );
    const list = await listModels({ kind: "direct", baseUrl: "http://gw:8080", key: "t" });
    expect(list.data).toEqual([]);
    expect(seen).toEqual(["http://gw:8080/v1/models", "Bearer t"]);
  });

  it("the proxy path is the same-origin one it always was", () => {
    expect(urlFor({ kind: "proxy" }, "/v1/chat/completions")).toBe(
      "/api/proxy/gateway/v1/chat/completions",
    );
  });
});
