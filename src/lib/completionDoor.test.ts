import { describe, expect, it } from "vitest";

import {
  EMPTY_COMPLETION_DRAFT,
  answerFromBody,
  buildCompletionBody,
  readCompletionStream,
  suffixWarning,
} from "./completionDoor";
import { newDoorReport } from "./doorRequest";

const draft = {
  ...EMPTY_COMPLETION_DRAFT,
  prompt: "p",
  suffix: "",
  maxTokens: "",
  temperature: "",
};

describe("buildCompletionBody", () => {
  it("sends only what was typed, and asks for usage on a stream", () => {
    expect(buildCompletionBody("m", { ...draft, stream: false })).toEqual({
      body: { model: "m", prompt: "p", stream: false },
    });
    expect(buildCompletionBody("m", { ...draft, stream: true })).toEqual({
      body: { model: "m", prompt: "p", stream: true, stream_options: { include_usage: true } },
    });
  });

  it("carries the suffix and the numbers, zero temperature included", () => {
    const built = buildCompletionBody("m", {
      ...draft,
      suffix: "tail",
      maxTokens: "16",
      temperature: "0",
      stream: false,
    });
    expect(built).toEqual({
      body: {
        model: "m",
        prompt: "p",
        suffix: "tail",
        max_tokens: 16,
        temperature: 0,
        stream: false,
      },
    });
  });

  it("names the field that cannot be sent", () => {
    expect(buildCompletionBody("m", { ...draft, prompt: "" })).toEqual({
      error: "Type a prompt to continue.",
    });
    expect(buildCompletionBody("m", { ...draft, maxTokens: "0" })).toMatchObject({
      error: /Max tokens/,
    });
    expect(buildCompletionBody("m", { ...draft, maxTokens: "1.5" })).toMatchObject({
      error: /Max tokens/,
    });
    expect(buildCompletionBody("m", { ...draft, temperature: "3" })).toMatchObject({
      error: /Temperature/,
    });
  });
});

describe("suffixWarning", () => {
  it("warns only for an explicit false, and only with a suffix", () => {
    expect(suffixWarning("tail", false)).toMatch(/cannot fill in the middle/);
    expect(suffixWarning("tail", undefined)).toBeNull();
    expect(suffixWarning("tail", true)).toBeNull();
    expect(suffixWarning("", false)).toBeNull();
  });
});

describe("answerFromBody", () => {
  it("reads OpenAI's text_completion", () => {
    expect(
      answerFromBody({
        model: "coder",
        choices: [{ text: " a + b", finish_reason: "length" }],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
        x_eugene_plexus: { driver: "d" },
      }),
    ).toEqual({
      text: " a + b",
      finishReason: "length",
      model: "coder",
      usage: { prompt_tokens: 3, completion_tokens: 4 },
      routing: { driver: "d" },
      truncatedBy: null,
    });
  });
});

function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

function report() {
  return newDoorReport({ kind: "proxy" }, "/v1/completions", { kind: "json", body: {} }, null);
}

describe("readCompletionStream", () => {
  it("joins frames split across reads, and takes usage and routing off the last", async () => {
    const frames = [
      `data: ${JSON.stringify({ choices: [{ text: " a" }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ text: " + b", finish_reason: "stop" }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [], usage: { completion_tokens: 2 }, x_eugene_plexus: { driver: "d" } })}\n\n`,
      "data: [DONE]\n\n",
    ].join("");
    // Cut mid-frame, where a network read would.
    const pieces: string[] = [];
    const answer = await readCompletionStream(
      streamOf([frames.slice(0, 17), frames.slice(17, 60), frames.slice(60)]),
      report(),
      performance.now(),
      (p) => pieces.push(p),
    );
    expect(pieces).toEqual([" a", " + b"]);
    expect(answer).toMatchObject({
      text: " a + b",
      finishReason: "stop",
      usage: { completion_tokens: 2 },
      routing: { driver: "d" },
      truncatedBy: null,
    });
  });

  it("is cut short, keeping the text, when the stream closes without [DONE]", async () => {
    const answer = await readCompletionStream(
      streamOf([`data: ${JSON.stringify({ choices: [{ text: " half" }] })}\n\n`]),
      report(),
      performance.now(),
      () => {},
    );
    expect(answer.text).toBe(" half");
    expect(answer.truncatedBy).toMatch(/closed before it finished/);
  });

  it("reports the gateway's error frame as the reason it was cut short", async () => {
    const answer = await readCompletionStream(
      streamOf([
        `data: ${JSON.stringify({ choices: [{ text: " x" }] })}\n\n`,
        `data: ${JSON.stringify({ error: { message: "the backend went away" } })}\n\n`,
        "data: [DONE]\n\n",
      ]),
      report(),
      performance.now(),
      () => {},
    );
    expect(answer.truncatedBy).toBe("the backend went away");
    expect(answer.text).toBe(" x");
  });

  it("stamps the first byte of output on the report", async () => {
    const r = report();
    await readCompletionStream(
      streamOf([`data: ${JSON.stringify({ choices: [{ text: "a" }] })}\n\n`, "data: [DONE]\n\n"]),
      r,
      performance.now(),
      () => {},
    );
    expect(r.firstByteMs).not.toBeNull();
  });
});
