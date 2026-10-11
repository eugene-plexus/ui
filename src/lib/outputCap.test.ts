import { describe, expect, it } from "vitest";

import { lengthStopWords } from "./outputCap";

describe("a length stop names the setting that made it (2026-10-10)", () => {
  it("says which cap, and where to change it", () => {
    expect(lengthStopWords({ tokens: 4096, source: "install" })).toEqual({
      badge: "hit the install's cap (4,096)",
      title: expect.stringContaining("Default max output tokens (Settings, gateway)"),
    });
    expect(lengthStopWords({ tokens: 2000, source: "profile" }).title).toContain(
      "Maximum output tokens on this model's default Library profile",
    );
    expect(lengthStopWords({ tokens: 512, source: "request" }).title).toContain(
      "this request's max_tokens, 512",
    );
  });

  it("blames no setting when the gateway did not say one", () => {
    const words = lengthStopWords(null);
    expect(words.badge).toBe("hit a length limit");
    expect(words.title).not.toContain("max_tokens");
  });
});
