/**
 * The persisted conversation, as the playground has always stored it.
 *
 * Home's "Try it" card writes this and the playground reads it, so what
 * matters is the exact stored shape — `{ model, messages }` and nothing
 * else — and that a read tolerates what a browser can actually hand back.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  PLAYGROUND_STORAGE_KEY,
  parseTranscript,
  readPlaygroundTranscript,
  serializeTranscript,
  writePlaygroundTranscript,
} from "./playgroundTranscript";

beforeEach(() => {
  sessionStorage.clear();
});

describe("the stored shape", () => {
  it("is exactly { model, messages }, under the playground's own key", () => {
    writePlaygroundTranscript({
      model: "qwen3-14b",
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ],
    });
    const raw = sessionStorage.getItem(PLAYGROUND_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw!) as Record<string, unknown>;
    // The keys the playground's own `PersistedConversation` has, and no
    // third one that one side would drop.
    expect(Object.keys(stored).sort()).toEqual(["messages", "model"]);
    expect(stored.model).toBe("qwen3-14b");
    expect(stored.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
  });

  it("keeps a null model as null, which is what the playground writes before a pick", () => {
    expect(JSON.parse(serializeTranscript({ model: null, messages: [] }))).toEqual({
      model: null,
      messages: [],
    });
  });

  it("round-trips through storage", () => {
    const transcript = {
      model: "m",
      messages: [{ role: "user" as const, content: "x" }],
    };
    writePlaygroundTranscript(transcript);
    expect(readPlaygroundTranscript()).toEqual(transcript);
  });

  it("reads what the playground wrote before this helper existed", () => {
    // The literal string the pre-S1 page stored: `JSON.stringify({model, messages})`.
    sessionStorage.setItem(
      PLAYGROUND_STORAGE_KEY,
      JSON.stringify({ model: "llama", messages: [{ role: "user", content: "a" }] }),
    );
    expect(readPlaygroundTranscript()).toEqual({
      model: "llama",
      messages: [{ role: "user", content: "a" }],
    });
  });
});

describe("a tolerant read", () => {
  it("treats nothing stored as an empty conversation", () => {
    expect(readPlaygroundTranscript()).toEqual({ model: null, messages: [] });
  });

  it("treats a value that is not ours as empty rather than throwing", () => {
    expect(parseTranscript("not json")).toEqual({ model: null, messages: [] });
    expect(parseTranscript("42")).toEqual({ model: null, messages: [] });
    expect(parseTranscript("null")).toEqual({ model: null, messages: [] });
    expect(parseTranscript(JSON.stringify({ model: 7, messages: "x" }))).toEqual({
      model: null,
      messages: [],
    });
  });
});
