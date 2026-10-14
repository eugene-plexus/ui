/**
 * What the wait says, from what the backend said.
 *
 * The progress fixtures follow llama.cpp b11215's own frames, as the
 * gateway renames them: `processed` counts the cached tokens too, so it
 * runs from `cached_tokens` to `prompt_tokens`.
 */

import { describe, expect, it } from "vitest";

import type { Model } from "./types";
import {
  STILL_WORKING_AFTER_SECONDS,
  describeWork,
  isAsleep,
  roughly,
  saysStillWorking,
} from "./workingState";

function read(processed: number, elapsed_ms: number, cached_tokens = 0, prompt_tokens = 3694) {
  return {
    stage: "prompt" as const,
    prompt_tokens,
    cached_tokens,
    processed_tokens: processed,
    elapsed_ms,
  };
}

describe("reading the prompt", () => {
  it("says how far, as a share of what is left to read", () => {
    const line = describeWork({ progress: read(1792, 4000) });
    expect(line.headline).toBe("Reading your message: 48%");
    expect(line.fraction).toBeCloseTo(1792 / 3694);
    expect(line.detail).toMatch(/^1,792 of 3,694 tokens · about \d+ s left$/);
  });

  it("works out the time left from the rate so far", () => {
    // 1,792 tokens in 4 s is 448 a second; 1,902 left is about 4 s, said as 5.
    expect(describeWork({ progress: read(1792, 4000) }).detail).toContain("about 5 s left");
    // A 27B on the processor: 256 tokens in 20 s, 3,438 left, about 4.5 min.
    expect(describeWork({ progress: read(256, 20_000) }).detail).toContain("about 4 min left");
  });

  it("says no time left before there is a rate to trust", () => {
    expect(describeWork({ progress: read(0, 0) }).detail).toBe("0 of 3,694 tokens");
    expect(describeWork({ progress: read(256, 286) }).detail).toBe("256 of 3,694 tokens");
  });

  it("counts only what is not already cached, and says the rest was read", () => {
    // A follow-up turn: most of the conversation is in the backend's cache.
    const line = describeWork({ progress: read(3400, 2000, 3000, 3694) });
    expect(line.headline).toBe("Reading your message: 57%");
    expect(line.detail).toMatch(
      /^400 of 694 tokens · about \d+ s left · the rest was already read$/,
    );
  });

  it("says when it has finished reading", () => {
    const line = describeWork({ progress: read(3694, 8920) });
    expect(line.headline).toBe("Read your message. Starting to answer");
    expect(line.detail).toBeNull();
  });

  it("never reads past the whole or behind the cache", () => {
    expect(describeWork({ progress: read(9999, 1000) }).fraction).toBe(1);
    expect(describeWork({ progress: read(10, 1000, 500) }).headline).toBe(
      "Reading your message: 0%",
    );
  });
});

describe("everything else a backend says", () => {
  it("names the tool an agent is running", () => {
    expect(describeWork({ progress: { stage: "tool", tool: "Read" } }).headline).toBe(
      "Using a tool: Read",
    );
    expect(describeWork({ progress: { stage: "tool" } }).headline).toBe("Using a tool");
  });

  it("says a hosted service has the message", () => {
    expect(describeWork({ progress: { stage: "working" } }).headline).toBe(
      "The model has your message and is working on it",
    );
  });

  it("says thinking over working, and a tool over thinking", () => {
    const working = { stage: "working" as const };
    expect(describeWork({ thinking: true, progress: working }).headline).toBe("Thinking");
    expect(
      describeWork({ thinking: true, progress: { stage: "tool", tool: "Bash" } }).headline,
    ).toBe("Using a tool: Bash");
  });

  it("says how many tokens it has written, where the backend counts them (2026-10-10)", () => {
    const count = {
      stage: "generating" as const,
      generated_tokens: 1234,
      tokens_per_second: 83.14,
    };
    expect(describeWork({ thinking: true, progress: count })).toEqual({
      headline: "Thinking",
      detail: "1,234 tokens · 83.1 tok/s",
      fraction: null,
    });
    expect(describeWork({ progress: { stage: "generating", generated_tokens: 9 } })).toEqual({
      headline: "Writing",
      detail: "9 tokens",
      fraction: null,
    });
    // No count, nothing said about one.
    expect(describeWork({ thinking: true, progress: { stage: "generating" } }).detail).toBeNull();
  });

  it("says a sleeping model is being started, and otherwise only that it is waiting", () => {
    expect(describeWork({ starting: true }).headline).toBe(
      "Starting the model. It was asleep, so it loads first",
    );
    expect(describeWork({}).headline).toBe("Waiting for the model");
    // Once the backend says anything, that wins over the guess.
    expect(describeWork({ starting: true, progress: { stage: "working" } }).headline).not.toMatch(
      /Starting/,
    );
  });
});

describe("the still-working sentence", () => {
  const late = STILL_WORKING_AFTER_SECONDS;

  it("comes only after the threshold, where nothing else is happening on screen", () => {
    expect(saysStillWorking({}, late - 1)).toBe(false);
    expect(saysStillWorking({}, late)).toBe(true);
    expect(saysStillWorking({ progress: { stage: "working" } }, late)).toBe(true);
    expect(saysStillWorking({ starting: true }, late)).toBe(true);
  });

  it("is not said while reading, thinking or running a tool, which say what they are doing", () => {
    expect(saysStillWorking({ progress: read(100, 5000) }, late * 10)).toBe(false);
    expect(saysStillWorking({ thinking: true }, late * 10)).toBe(false);
    expect(saysStillWorking({ progress: { stage: "tool", tool: "Read" } }, late * 10)).toBe(false);
    expect(
      saysStillWorking({ progress: { stage: "generating", generated_tokens: 5 } }, late * 10),
    ).toBe(false);
  });
});

describe("roughly", () => {
  it("rounds to what a person reads as an estimate", () => {
    expect(roughly(1)).toBe("about 5 s");
    expect(roughly(23)).toBe("about 25 s");
    expect(roughly(130)).toBe("about 2 min");
  });
});

describe("isAsleep", () => {
  const model = (info: Model["x_eugene_plexus"]): Model => ({
    id: "m",
    object: "model",
    x_eugene_plexus: info,
  });

  it("is a model that starts on demand with nothing ready", () => {
    expect(isAsleep(model({ on_demand: true, ready_backends: 0 }))).toBe(true);
    expect(isAsleep(model({ on_demand: true, ready_backends: 1 }))).toBe(false);
    expect(isAsleep(model({ ready_backends: 0 }))).toBe(false);
    expect(isAsleep(undefined)).toBe(false);
  });
});
