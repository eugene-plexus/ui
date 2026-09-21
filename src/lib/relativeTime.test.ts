import { describe, expect, it } from "vitest";

import { relativeAge } from "./relativeTime";

const NOW = Date.parse("2026-09-21T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("relativeAge", () => {
  it("names the day at day scale and rolls up honestly", () => {
    expect(relativeAge(daysAgo(0), NOW)).toBe("today");
    expect(relativeAge(daysAgo(1), NOW)).toBe("yesterday");
    expect(relativeAge(daysAgo(10), NOW)).toBe("10 days ago");
    expect(relativeAge(daysAgo(45), NOW)).toBe("a month ago");
    expect(relativeAge(daysAgo(200), NOW)).toBe("6 months ago");
    expect(relativeAge(daysAgo(400), NOW)).toBe("a year ago");
    expect(relativeAge(daysAgo(900), NOW)).toBe("2 years ago");
  });

  it("answers null for nothing, junk, and a clock from the future", () => {
    expect(relativeAge(undefined, NOW)).toBeNull();
    expect(relativeAge(null, NOW)).toBeNull();
    expect(relativeAge("not a date", NOW)).toBeNull();
    // A publisher's clock ahead of ours must not render "-1 days ago".
    expect(relativeAge(daysAgo(-2), NOW)).toBeNull();
  });
});
