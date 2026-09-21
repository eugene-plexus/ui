/**
 * The persisted conversation, as the playground has always stored it.
 *
 * Home's "Try it" card writes this and the playground reads it, so what
 * matters is the exact stored shape — `{ model, messages }` and nothing
 * else — and that a read tolerates what a browser can actually hand back.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PLAYGROUND_STORAGE_KEY,
  parseTranscript,
  readPlaygroundTranscript,
  serializeTranscript,
  stripImageBytes,
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

describe("the storage fallback for image bytes", () => {
  afterEach(() => vi.restoreAllMocks());

  const withImage = {
    model: "m",
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "what is this" },
          { type: "image_url" as const, image_url: { url: "data:image/png;base64,AAAA" } },
        ],
      },
      { role: "assistant" as const, content: "a square" },
    ],
  };

  it("stripImageBytes empties the image URLs and touches nothing else", () => {
    const stripped = stripImageBytes(withImage.messages);
    expect(stripped[0]?.content).toEqual([
      { type: "text", text: "what is this" },
      { type: "image_url", image_url: { url: "data:," } },
    ]);
    expect(stripped[1]).toEqual(withImage.messages[1]);
    // The input is not mutated: the live transcript keeps its pixels.
    expect((withImage.messages[0]?.content as Array<{ image_url?: { url: string } }>)[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAAA" },
    });
  });

  it("a quota failure retries with the pixels stripped, so the words survive", () => {
    const real = sessionStorage.setItem.bind(sessionStorage);
    let threw = false;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      // Refuse the full write once — the quota's behaviour — and let
      // the stripped retry through.
      if (!threw && value.includes("base64,AAAA")) {
        threw = true;
        throw new DOMException("quota", "QuotaExceededError");
      }
      real(key, value);
    });
    writePlaygroundTranscript(withImage);
    expect(threw).toBe(true);
    const stored = readPlaygroundTranscript();
    expect(stored.messages[1]).toEqual({ role: "assistant", content: "a square" });
    expect(stored.messages[0]?.content).toEqual([
      { type: "text", text: "what is this" },
      { type: "image_url", image_url: { url: "data:," } },
    ]);
  });

  it("when even the stripped write throws, the failure stays silent as before", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(() => writePlaygroundTranscript(withImage)).not.toThrow();
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
