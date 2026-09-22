import { describe, expect, it } from "vitest";

import { formatTimestamp, relativeAge, timeUntil } from "./relativeTime";

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

describe("timeUntil", () => {
  it("counts down in words and says when the moment has passed", () => {
    const at = (s: number) => new Date(NOW + s * 1000).toISOString();
    expect(timeUntil(at(45), NOW)).toBe("in 45 s");
    expect(timeUntil(at(12 * 60), NOW)).toBe("in 12 min");
    expect(timeUntil(at(80 * 60), NOW)).toBe("in 1 h 20 min");
    expect(timeUntil(at(3 * 86_400), NOW)).toBe("in 3 days");
    expect(timeUntil(at(-5), NOW)).toBe("already passed");
    expect(timeUntil("not a date", NOW)).toBeNull();
  });
});

describe("formatTimestamp", () => {
  it("drops the date for today and keeps it for any other day", () => {
    const today = new Date(NOW - 3600_000).toISOString();
    const lastWeek = new Date(NOW - 6 * 86_400_000).toISOString();
    const clock = new Date(today).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(formatTimestamp(today, NOW)).toBe(clock);
    const earlier = formatTimestamp(lastWeek, NOW)!;
    expect(earlier).not.toBe(
      new Date(lastWeek).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    );
    expect(earlier).toContain(String(new Date(lastWeek).getDate()));
    expect(formatTimestamp(null, NOW)).toBeNull();
  });
});
