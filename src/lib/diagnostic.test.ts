/**
 * The diagnostic's pure half.
 *
 * What is worth pinning is each place a wrong answer would be quiet: a
 * base URL guessed with the gateway's loopback host instead of the
 * page's, a `curl` line whose body is not what was sent, an attachment
 * that decodes to mojibake and gets inlined anyway, a report that
 * summarizes a network failure as if it had a status.
 */

import { describe, expect, it } from "vitest";

import type { RequestReport } from "./completions";
import {
  asciiJson,
  baseUrlHints,
  buildCurl,
  checkAttachment,
  displayBaseUrl,
  explainFailure,
  guessGatewayBaseUrl,
  inlineAttachments,
  normalizeBaseUrl,
  parseToolDefinitions,
  shellQuote,
  summarizeReport,
} from "./diagnostic";

const LAN_PAGE = { protocol: "http:", hostname: "192.168.16.75" };
const LOCAL_PAGE = { protocol: "http:", hostname: "127.0.0.1" };

describe("normalizeBaseUrl / displayBaseUrl", () => {
  it("accepts the /v1 form OpenAI clients are configured with, and strips it", () => {
    expect(normalizeBaseUrl("http://h:8080/v1")).toBe("http://h:8080");
    expect(normalizeBaseUrl("http://h:8080/v1/")).toBe("http://h:8080");
    expect(normalizeBaseUrl("  http://h:8080/  ")).toBe("http://h:8080");
    expect(normalizeBaseUrl("http://h:8080")).toBe("http://h:8080");
  });
  it("shows the /v1 form, which is what a harness wants pasted", () => {
    expect(displayBaseUrl("http://h:8080")).toBe("http://h:8080/v1");
    expect(displayBaseUrl("")).toBe("");
  });
});

describe("guessGatewayBaseUrl", () => {
  const topology = [
    { kind: "control", url: "http://127.0.0.1:8083/" },
    { kind: "gateway", url: "http://127.0.0.1:8080/" },
  ];
  it("uses the page's host and the topology's port, never the topology's loopback host", () => {
    expect(guessGatewayBaseUrl(topology, LAN_PAGE)).toBe("http://192.168.16.75:8080");
  });
  it("prefers advertiseUrl when the install already has one", () => {
    const adv = [
      { kind: "gateway", url: "http://127.0.0.1:8080/", advertiseUrl: "http://10.0.0.5:8080/" },
    ];
    expect(guessGatewayBaseUrl(adv, LAN_PAGE)).toBe("http://10.0.0.5:8080");
  });
  it("is null when no gateway is declared here", () => {
    expect(
      guessGatewayBaseUrl([{ kind: "library", url: "http://127.0.0.1:8082/" }], LAN_PAGE),
    ).toBeNull();
  });
});

describe("baseUrlHints", () => {
  it("says nothing about a plain LAN address from a LAN page", () => {
    expect(baseUrlHints("http://192.168.16.252:8280/v1", LAN_PAGE)).toEqual([]);
  });
  it("warns when a LAN page is pointed at loopback", () => {
    const hints = baseUrlHints("http://127.0.0.1:8080", LAN_PAGE);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatch(/loopback/);
    expect(hints[0]).toMatch(/192\.168\.16\.75/);
  });
  it("does not warn about loopback from a loopback page", () => {
    expect(baseUrlHints("http://127.0.0.1:8080", LOCAL_PAGE)).toEqual([]);
  });
  it("warns about mixed content", () => {
    const hints = baseUrlHints("http://gw:8080", { protocol: "https:", hostname: "ui.tail.net" });
    expect(hints.some((h) => /mixed content/.test(h))).toBe(true);
  });
  it("says when the text is not a URL at all", () => {
    // What people paste from a harness config with the scheme left off.
    expect(baseUrlHints("192.168.1.20:8080", LAN_PAGE)[0]).toMatch(/not a URL/);
  });
});

describe("buildCurl", () => {
  it("replays the exact body, quoted for a shell, with the key as a variable the shell expands", () => {
    const body = '{"model":"m","messages":[{"role":"user","content":"it\'s"}]}';
    const line = buildCurl("http://h:8080/v1/chat/completions", body, null);
    expect(line).toBe(
      "curl -sN 'http://h:8080/v1/chat/completions' " +
        '-H "Authorization: Bearer $EUGENE_PLEXUS_TOKEN" ' +
        "-H 'Content-Type: application/json' " +
        '-d \'{"model":"m","messages":[{"role":"user","content":"it\'\\\'\'s"}]}\'',
    );
  });
  it("includes the key only when asked", () => {
    expect(buildCurl("http://h/v1/models", null, "abc.def")).toBe(
      "curl -sN 'http://h/v1/models' -H 'Authorization: Bearer abc.def'",
    );
  });
  it("escapes non-ASCII in the body, so a Windows shell cannot mangle it", () => {
    // The first run's failure: `-3°C` in an assistant turn, copied out of
    // the page and replayed from Git Bash, reached the gateway as one
    // byte and failed to parse. Same JSON value, pure ASCII.
    const line = buildCurl("http://h/v1/chat/completions", '{"a":"-3°C ✓"}', null);
    // Doubled backslashes: the literal six characters `\u00b0`, not the sign.
    expect(line).toContain('-d \'{"a":"-3\\u00b0C \\u2713"}\'');
    expect(asciiJson('{"a":"-3°C"}')).toBe('{"a":"-3\\u00b0C"}');
    expect(JSON.parse(asciiJson('{"a":"-3°C ✓"}'))).toEqual({ a: "-3°C ✓" });
  });
  it("shellQuote survives a single quote", () => {
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
  });
});

describe("attachments", () => {
  it("inlines text and files with a fence naming each file and its size", () => {
    const out = inlineAttachments("Read this.", [
      { name: "notes.md", size: 12, text: "hello\nworld\n" },
    ]);
    expect(out).toBe(
      "Read this.\n\n--- attached: notes.md (12 bytes) ---\nhello\nworld\n--- end notes.md ---",
    );
  });
  it("sends the files alone when there is no typed text", () => {
    expect(inlineAttachments("   ", [{ name: "a.txt", size: 1, text: "x" }])).toBe(
      "--- attached: a.txt (1 bytes) ---\nx\n--- end a.txt ---",
    );
  });
  it("refuses binary and oversized files, naming the file", () => {
    expect(checkAttachment("img.png", 100, "\u0089PNG\uFFFD")).toMatch(
      /img\.png is not a text file/,
    );
    expect(checkAttachment("big.log", 2_000_000, "x")).toMatch(/big\.log is 1\.9 MB/);
    expect(checkAttachment("ok.txt", 5, "hello")).toBeNull();
  });
});

describe("parseToolDefinitions", () => {
  it("accepts the example and refuses the two common mistakes", () => {
    expect(parseToolDefinitions('[{"type":"function","function":{"name":"f"}}]')).toEqual({
      tools: [{ type: "function", function: { name: "f" } }],
    });
    expect(parseToolDefinitions('{"type":"function"}')).toEqual({
      error: "Tools must be a JSON array of tool definitions.",
    });
    expect(parseToolDefinitions('[{"type":"function","function":{}}]')).toEqual({
      error: 'Tool 1: "function.name" is required.',
    });
    expect(parseToolDefinitions("[")).toMatchObject({
      error: expect.stringMatching(/not valid JSON/),
    });
  });
});

function report(overrides: Partial<RequestReport>): RequestReport {
  return {
    mode: "direct",
    url: "http://127.0.0.1:8080/v1/chat/completions",
    reproduceUrl: "http://127.0.0.1:8080/v1/chat/completions",
    method: "POST",
    body: "{}",
    status: null,
    error: null,
    elapsedMs: null,
    firstFrameMs: null,
    frames: 0,
    contentDeltas: 0,
    toolCallDeltas: 0,
    finishReason: null,
    model: null,
    streamed: true,
    truncatedBy: null,
    at: "2026-09-13T00:00:00Z",
    ...overrides,
  };
}

describe("summarizeReport", () => {
  it("names the path, the status, the clock and the shape of the answer", () => {
    const line = summarizeReport(
      report({
        status: 200,
        elapsedMs: 1234,
        firstFrameMs: 110,
        frames: 79,
        finishReason: "stop",
        routing: { driver: "ollama-qwen" },
      }),
    );
    expect(line).toBe(
      "direct · HTTP 200 · 1.23s · first frame 0.11s · 79 frames · finish stop · driver ollama-qwen",
    );
  });
  it("does not invent a status for a network failure", () => {
    const line = summarizeReport(report({ error: "Failed to fetch", elapsedMs: 5 }));
    expect(line).toMatch(/^direct · no response/);
    expect(line).not.toMatch(/HTTP/);
    expect(line).toMatch(/Failed to fetch/);
  });
});

describe("explainFailure", () => {
  it("names the key for a 401 and the wrong process for a 404", () => {
    expect(explainFailure(report({ status: 401, error: "Invalid token" }), LAN_PAGE)[0]).toMatch(
      /refused the key/,
    );
    expect(explainFailure(report({ status: 404, error: "Not Found" }), LAN_PAGE)[0]).toMatch(
      /not a gateway/,
    );
  });
  it("names corsAllowedOrigins for a 403 and an old gateway for a 405", () => {
    expect(explainFailure(report({ status: 403 }), LAN_PAGE)[0]).toMatch(/corsAllowedOrigins/);
    expect(explainFailure(report({ status: 405 }), LAN_PAGE)[0]).toMatch(/does not speak CORS/);
  });
  it("lists the candidates for a network failure, loopback first when that is the shape", () => {
    const out = explainFailure(report({ error: "Failed to fetch" }), LAN_PAGE);
    expect(out[0]).toMatch(/loopback/);
    expect(out.some((s) => /corsEnabled/.test(s))).toBe(true);
    expect(out.at(-1)).toMatch(/curl -i -X OPTIONS/);
  });
  it("says nothing extra for a success", () => {
    expect(explainFailure(report({ status: 200 }), LAN_PAGE)).toEqual([]);
  });
});
