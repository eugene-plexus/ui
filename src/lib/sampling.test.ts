import { describe, expect, it } from "vitest";

import { buildChatRequest } from "./completions";
import {
  EMPTY_SAMPLING,
  activeSamplingCount,
  normalizeSamplingDraft,
  parseSampling,
  withSystemPrompt,
} from "./sampling";
import type { ChatCompletionMessage } from "./types";

describe("parseSampling", () => {
  it("an untouched draft sends nothing at all", () => {
    const parsed = parseSampling(EMPTY_SAMPLING);
    expect(parsed).toEqual({ values: {} });
    expect(activeSamplingCount(EMPTY_SAMPLING)).toBe(0);
  });

  it("whitespace-only fields are still unset", () => {
    const parsed = parseSampling({
      ...EMPTY_SAMPLING,
      temperature: "  ",
      seed: "\t",
      stop: "\n\n",
    });
    expect(parsed).toEqual({ values: {} });
  });

  // The two falsy values that a truthiness check would drop -- the exact
  // shape of the gateway's own R3.4 bug, which must not be rebuilt here.
  it("seed 0 and temperature 0 are real values, parsed and kept", () => {
    const parsed = parseSampling({ ...EMPTY_SAMPLING, seed: "0", temperature: "0" });
    expect(parsed).toEqual({ values: { seed: 0, temperature: 0 } });
  });

  it("every field typed comes through with its request name", () => {
    const parsed = parseSampling({
      system: "Answer in French.",
      temperature: "0.7",
      maxTokens: "256",
      topP: "0.9",
      seed: "42",
      stop: "END\nSTOP",
    });
    expect(parsed).toEqual({
      values: {
        system: "Answer in French.",
        temperature: 0.7,
        maxTokens: 256,
        topP: 0.9,
        seed: 42,
        stop: ["END", "STOP"],
      },
    });
  });

  it("text that is not a number names the field", () => {
    const parsed = parseSampling({ ...EMPTY_SAMPLING, temperature: "warm" });
    expect(parsed).toEqual({ error: 'Temperature must be a number; "warm" is not.' });
  });

  it("a fractional token count or seed is refused, a fractional temperature is not", () => {
    expect(parseSampling({ ...EMPTY_SAMPLING, maxTokens: "1.5" })).toHaveProperty("error");
    expect(parseSampling({ ...EMPTY_SAMPLING, seed: "1.5" })).toHaveProperty("error");
    expect(parseSampling({ ...EMPTY_SAMPLING, temperature: "1.5" })).toEqual({
      values: { temperature: 1.5 },
    });
  });

  it("more than four stop sequences is the contract's cap, said before the 400", () => {
    const parsed = parseSampling({ ...EMPTY_SAMPLING, stop: "a\nb\nc\nd\ne" });
    expect(parsed).toEqual({ error: "Stop sequences: 5 given, and at most 4 are carried." });
  });

  it("blank stop lines do not count against the cap", () => {
    const parsed = parseSampling({ ...EMPTY_SAMPLING, stop: "a\n\n b \n" });
    expect(parsed).toEqual({ values: { stop: ["a", "b"] } });
  });

  it("a draft with a typo still lights the chip", () => {
    expect(activeSamplingCount({ ...EMPTY_SAMPLING, seed: "not-a-seed" })).toBe(1);
  });
});

describe("normalizeSamplingDraft", () => {
  it("tolerates junk from an older build", () => {
    expect(normalizeSamplingDraft(null)).toEqual(EMPTY_SAMPLING);
    expect(normalizeSamplingDraft("garbage")).toEqual(EMPTY_SAMPLING);
    expect(normalizeSamplingDraft({ seed: 7, unknown: "x" })).toEqual(EMPTY_SAMPLING);
    expect(normalizeSamplingDraft({ seed: "7" })).toEqual({ ...EMPTY_SAMPLING, seed: "7" });
  });
});

describe("withSystemPrompt", () => {
  const make = (content: string): ChatCompletionMessage => ({ role: "system", content });
  const history: ChatCompletionMessage[] = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ];

  it("prepends exactly one system message", () => {
    const wire = withSystemPrompt(history, "Be brief.", make);
    expect(wire.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
    expect(wire[0]?.content).toBe("Be brief.");
  });

  it("replaces an earlier system message rather than stacking a second", () => {
    const withOld: ChatCompletionMessage[] = [make("old"), ...history];
    const wire = withSystemPrompt(withOld, "new", make);
    expect(wire.filter((m) => m.role === "system")).toHaveLength(1);
    expect(wire[0]?.content).toBe("new");
  });

  it("no prompt means no system message, even a stale one", () => {
    const withOld: ChatCompletionMessage[] = [make("old"), ...history];
    expect(withSystemPrompt(withOld, undefined, make)).toEqual(history);
  });
});

describe("buildChatRequest carries the sampling fields", () => {
  const base = { model: "m", messages: [] };

  it("omits what was not given, so the request is unchanged without the panel", () => {
    expect(buildChatRequest(base, true)).toEqual({ model: "m", messages: [], stream: true });
  });

  it("seed 0 and temperature 0 ride the wire", () => {
    const body = buildChatRequest({ ...base, seed: 0, temperature: 0 }, true);
    expect(body.seed).toBe(0);
    expect(body.temperature).toBe(0);
  });

  it("top_p, max_tokens and stop use the wire's names", () => {
    const body = buildChatRequest(
      { ...base, topP: 0.9, maxTokens: 128, stop: ["END"], seed: 7 },
      false,
    );
    expect(body).toEqual({
      model: "m",
      messages: [],
      stream: false,
      top_p: 0.9,
      max_tokens: 128,
      stop: ["END"],
      seed: 7,
    });
  });

  it("an empty stop list is omitted, not sent as []", () => {
    const body = buildChatRequest({ ...base, stop: [] }, false);
    expect("stop" in body).toBe(false);
  });
});
