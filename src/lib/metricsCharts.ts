/**
 * Chart-ready shapes for the metrics dashboard — the pure half.
 *
 * Everything here is a transform from what `GET /v1/metrics` returns to
 * what an SVG renders, kept out of the components so the rules can be
 * tested without a DOM. Two rules are load-bearing and must survive
 * edits:
 *
 * **A missing hour is not a slow hour.** An hour with no bucket has
 * `requests: 0` — nothing was served, and zero is the truth — but its
 * latency, TTFT and decode rate are `null`, because "nothing to
 * measure" and "measured at zero" are different facts. A line chart
 * breaks at a null; a bar chart draws no bar. Interpolating across the
 * gap would draw a latency no request ever had.
 *
 * **Percentiles arrive computed and are never combined here.** Each
 * point's p50 is the server's, over that bucket's raw rows. Averaging
 * two buckets' p50s, or "rolling up" client-side, produces a number
 * with a percentile's name and no percentile's meaning — the exact
 * error the `groupBy` parameter exists to prevent.
 */

/** The slice of MetricsGroup a chart consumes. Declared structurally so
 * the generated type (whose fields are optional) assigns to it. */
export interface ChartGroup {
  bucketStart?: string | null;
  requests: number;
  errors: number;
  cascaded: number;
  swappedIn: number;
  latencyMs?: { p50: number; p90: number; max: number } | null;
  ttftMs?: { p50: number; p90: number; max: number } | null;
  tokensPerSecond?: { p50: number; p90?: number; samples: number } | null;
  decodeTokensPerSecond?: { p50: number; p90?: number; samples: number } | null;
  waitedMs?: { p50: number; p90: number; max: number } | null;
}

export interface HourPoint {
  /** Bucket start, ISO-8601 Z, hour resolution. */
  t: string;
  requests: number;
  errors: number;
  latencyP50: number | null;
  latencyP90: number | null;
  ttftP50: number | null;
  decodeP50: number | null;
}

function floorHour(iso: string): number {
  const d = new Date(iso);
  d.setUTCMinutes(0, 0, 0);
  return d.getTime();
}

function hourIso(t: number): string {
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
}

const HOUR = 3600_000;

/**
 * One point per hour across the whole window, gaps filled explicitly.
 *
 * Filled rather than left sparse because a bar chart over only the
 * hours that had traffic compresses the quiet stretch out of the
 * picture — "what did last night look like" answered without the
 * night in it. Bounded at 21 days so a malformed window cannot
 * allocate an unbounded array.
 */
export function hourlyPoints(
  groups: ChartGroup[],
  windowStart: string,
  windowEnd: string,
): HourPoint[] {
  const start = floorHour(windowStart);
  const end = floorHour(windowEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const hours = Math.min(Math.floor((end - start) / HOUR) + 1, 21 * 24);

  const byBucket = new Map<string, ChartGroup>();
  for (const g of groups) {
    if (g.bucketStart) byBucket.set(hourIso(floorHour(g.bucketStart)), g);
  }

  const out: HourPoint[] = [];
  for (let i = 0; i < hours; i++) {
    const t = hourIso(start + i * HOUR);
    const g = byBucket.get(t);
    out.push({
      t,
      requests: g?.requests ?? 0,
      errors: g?.errors ?? 0,
      latencyP50: g?.latencyMs?.p50 ?? null,
      latencyP90: g?.latencyMs?.p90 ?? null,
      ttftP50: g?.ttftMs?.p50 ?? null,
      decodeP50: g?.decodeTokensPerSecond?.p50 ?? null,
    });
  }
  return out;
}

/** The headline numbers, from the one `groupBy=total` group over the
 * whole window. Null fields stay null — a tile renders "unreported",
 * never 0, for the same reason the table does. */
export interface Tiles {
  requests: number;
  errors: number;
  cascaded: number;
  swappedIn: number;
  latencyP50: number | null;
  /** Null when nothing in the window streamed. TTFT is a latency, so
   * like the latency columns it carries no sample count — the caption
   * says "streamed requests" instead, because a count of ALL requests
   * beside it would claim more evidence than the number has. */
  ttftP50: number | null;
  decodeP50: number | null;
  decodeSamples: number;
}

export function tilesFrom(groups: ChartGroup[]): Tiles | null {
  const g = groups[0];
  if (!g) return null;
  return {
    requests: g.requests,
    errors: g.errors,
    cascaded: g.cascaded,
    swappedIn: g.swappedIn,
    latencyP50: g.latencyMs?.p50 ?? null,
    ttftP50: g.ttftMs?.p50 ?? null,
    decodeP50: g.decodeTokensPerSecond?.p50 ?? null,
    decodeSamples: g.decodeTokensPerSecond?.samples ?? 0,
  };
}

/**
 * Clean y-axis ticks: 0, a midpoint and a rounded top at or above the
 * max, stepped 1/2/5×10^n. Rounded because axis values exist to be
 * read, and 1,847 is a number nobody compares against.
 */
export function niceMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const exp = Math.floor(Math.log10(max));
  const base = Math.pow(10, exp);
  for (const m of [1, 2, 5, 10]) {
    if (m * base >= max) return m * base;
  }
  return 10 * base;
}

/** 1284 -> "1,284"; 12900 -> "12.9K"; 4200000 -> "4.2M". */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString("en-US");
}

/** Milliseconds for an axis or tile, readable across four orders of
 * magnitude. Mirrors the page's `ms()` (a wake is seconds, a cached
 * answer is milliseconds). */
export function msLabel(value: number): string {
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)} s`;
  return `${Math.round(value / 60_000)} min`;
}

/** Hour label for the x axis and tooltips: local time, day named only
 * when the window spans more than one. */
export function hourLabel(iso: string, spanHours: number): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (spanHours <= 24) return time;
  return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}
