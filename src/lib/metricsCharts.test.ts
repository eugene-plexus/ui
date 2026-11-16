/**
 * The chart-data rules, tested without a DOM.
 *
 * The two that matter: a missing hour is `requests: 0` but `latency:
 * null` — zero served is a fact, zero milliseconds is an invention —
 * and a null breaks a line into two runs rather than being interpolated
 * across, because a value between two measurements is a latency no
 * request ever had.
 */

import { describe, expect, it } from "vitest";

import { segments } from "@/components/MetricsCharts";
import {
  compact,
  dailyPoints,
  hourlyPoints,
  niceMax,
  tilesFrom,
  totalsFromHours,
} from "./metricsCharts";

const g = (bucketStart: string, over: Record<string, unknown> = {}) => ({
  bucketStart,
  requests: 5,
  errors: 1,
  cascaded: 0,
  swappedIn: 0,
  latencyMs: { p50: 700, p90: 1200, max: 3000 },
  ttftMs: { p50: 150, p90: 300, max: 600 },
  decodeTokensPerSecond: { p50: 42.5, samples: 4 },
  ...over,
});

describe("hourlyPoints", () => {
  it("fills a missing hour with zero requests and NULL measurements", () => {
    const points = hourlyPoints(
      [g("2026-09-21T10:00:00Z"), g("2026-09-21T12:00:00Z")],
      "2026-09-21T10:00:00Z",
      "2026-09-21T12:59:00Z",
    );
    expect(points).toHaveLength(3);
    const gap = points[1]!;
    expect(gap.t).toBe("2026-09-21T11:00:00Z");
    // Nothing served is a true zero; nothing measured is not a zero.
    expect(gap.requests).toBe(0);
    expect(gap.errors).toBe(0);
    expect(gap.latencyP50).toBeNull();
    expect(gap.ttftP50).toBeNull();
    expect(gap.decodeP50).toBeNull();
  });

  it("spans the whole window even when one hour has data", () => {
    const points = hourlyPoints(
      [g("2026-09-21T03:00:00Z")],
      "2026-09-20T23:30:00Z",
      "2026-09-21T05:10:00Z",
    );
    // 23:00 through 05:00 inclusive — the quiet night stays in the
    // picture rather than being compressed out of it.
    expect(points).toHaveLength(7);
    expect(points[0]!.t).toBe("2026-09-20T23:00:00Z");
    expect(points[4]!.requests).toBe(5);
  });

  it("answers empty for a nonsense window rather than allocating", () => {
    expect(hourlyPoints([], "not a date", "2026-09-21T05:00:00Z")).toEqual([]);
    expect(hourlyPoints([], "2026-09-21T05:00:00Z", "2026-09-21T01:00:00Z")).toEqual([]);
  });
});

describe("segments", () => {
  it("breaks a line at a null instead of interpolating across it", () => {
    const points = hourlyPoints(
      [g("2026-09-21T10:00:00Z"), g("2026-09-21T12:00:00Z")],
      "2026-09-21T10:00:00Z",
      "2026-09-21T12:59:00Z",
    );
    const runs = segments(points, (p) => p.latencyP50, 1200);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toHaveLength(1);
    expect(runs[1]).toHaveLength(1);
  });
});

describe("tilesFrom", () => {
  it("keeps null decode and TTFT null — unreported, never zero", () => {
    const tiles = tilesFrom([
      g("", { ttftMs: null, decodeTokensPerSecond: null, bucketStart: undefined }),
    ]);
    expect(tiles).not.toBeNull();
    expect(tiles!.requests).toBe(5);
    expect(tiles!.ttftP50).toBeNull();
    expect(tiles!.decodeP50).toBeNull();
  });

  it("answers null for an empty window", () => {
    expect(tilesFrom([])).toBeNull();
  });
});

describe("axis helpers", () => {
  it("rounds the axis top to a clean 1/2/5 step", () => {
    expect(niceMax(7)).toBe(10);
    expect(niceMax(42)).toBe(50);
    expect(niceMax(180)).toBe(200);
    expect(niceMax(1000)).toBe(1000);
    expect(niceMax(0)).toBe(1);
  });

  it("compacts large values and commas small ones", () => {
    expect(compact(1284)).toBe("1,284");
    expect(compact(12900)).toBe("12.9K");
    expect(compact(4_200_000)).toBe("4.2M");
  });
});

describe("dailyPoints (row 38)", () => {
  it("adds the hours of a day, rollups and raw alike, and weights their means", () => {
    const day = new Date(2026, 9, 1, 0, 0, 0).getTime();
    const at = (h: number) => new Date(day + h * 3600_000).toISOString();
    const points = dailyPoints(
      [
        {
          bucketStart: at(1),
          requests: 3,
          errors: 1,
          cascaded: 0,
          swappedIn: 1,
          latencyMeanMs: 1000,
          source: "rollup",
        },
        {
          bucketStart: at(5),
          requests: 1,
          errors: 0,
          cascaded: 1,
          swappedIn: 0,
          latencyMeanMs: 5000,
          source: "rollup",
        },
        {
          bucketStart: at(30),
          requests: 2,
          errors: 0,
          cascaded: 0,
          swappedIn: 0,
          latencyMs: { p50: 9, p90: 9, max: 9 },
          source: "raw",
        },
      ],
      at(0),
      at(47),
    );
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ requests: 4, errors: 1, cascaded: 1, swappedIn: 1 });
    // (3 * 1000 + 1 * 5000) / 4: weighted by requests, never an average of means.
    expect(points[0]!.latencyMean).toBe(2000);
    // A raw hour from a gateway older than v16 has no mean: the day says none.
    expect(points[1]).toMatchObject({ requests: 2, latencyMean: null, latencyP50: null });
  });

  it("totals a long window from its hours", () => {
    expect(
      totalsFromHours([
        { requests: 3, errors: 1, cascaded: 0, swappedIn: 2, latencyMeanMs: 1000 },
        { requests: 1, errors: 0, cascaded: 1, swappedIn: 0, latencyMeanMs: 5000 },
      ]),
    ).toEqual({ requests: 4, errors: 1, cascaded: 1, swappedIn: 2, latencyMean: 2000 });
  });
});
