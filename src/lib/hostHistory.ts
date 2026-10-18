/**
 * Host history, chart-ready — the pure half of the Hosts page.
 *
 * Each agent records its own machine and answers `GET /v1/node/history`
 * (specs `docs/design/host-history.md`); the console reads every machine
 * through `node:<name>`. Two rules carry over from the gateway's charts
 * (`metricsCharts.ts`) and must survive edits:
 *
 * **`null` is not 0.** A bucket with no reading is a gap and draws no ink;
 * a series the machine cannot read arrives with `unavailable` and is shown
 * as "not reported" with that reason, never as a flat zero.
 *
 * **The agent's buckets are used as they come.** It already rolled them up
 * (min, mean and max per bucket); nothing here re-averages them.
 */

import type { components as AgentComponents } from "@/generated/agent";

import type { TimeLabel } from "@/lib/metricsCharts";

export type HostHistory = AgentComponents["schemas"]["HostHistory"];
export type HostSeries = AgentComponents["schemas"]["HostSeries"];
export type HostMetric = AgentComponents["schemas"]["HostMetric"];
export type HostUnit = AgentComponents["schemas"]["HostUnit"];

/** The gateway page's windows, plus the two this page needs. */
export const HOST_WINDOWS: { label: string; hours: number }[] = [
  { label: "Last hour", hours: 1 },
  { label: "Last 6 hours", hours: 6 },
  { label: "Last 24 hours", hours: 24 },
  { label: "Last 7 days", hours: 24 * 7 },
  { label: "Last 30 days", hours: 24 * 30 },
];

/** What a fleet row draws, and nothing else: the row reads every machine. */
export const FLEET_METRICS: HostMetric[] = [
  "gpuMemoryUsed",
  "gpuMemoryTotal",
  "gpuMemoryEugene",
  "gpuUtilization",
  "gpuTemperature",
];

export function historyPath(hours: number, now: number, metrics?: HostMetric[]): string {
  const from = new Date(now - hours * 3600_000).toISOString();
  const to = new Date(now).toISOString();
  const params = new URLSearchParams({ from, to });
  for (const m of metrics ?? []) params.append("metric", m);
  return `/v1/node/history?${params.toString()}`;
}

/** One bucket, every series' mean keyed by `HostSeries.key`. */
export interface HostPoint {
  t: string;
  samples: number;
  expected: number;
  values: Record<string, number | null>;
}

export function pointsFrom(history: HostHistory): HostPoint[] {
  return history.buckets.map((b, i) => {
    const values: Record<string, number | null> = {};
    for (const s of history.series) values[s.key] = s.mean[i] ?? null;
    return { t: b.start, samples: b.samples, expected: b.expectedSamples, values };
  });
}

/** How the window's samples add up: every bucket's samples against what
 * the interval would have produced, and how many stretches had none. */
export interface Coverage {
  samples: number;
  expected: number;
  gaps: number;
}

export function coverage(history: HostHistory, now: number = Date.now()): Coverage {
  let samples = 0;
  let expected = 0;
  let gaps = 0;
  let inGap = false;
  for (const b of history.buckets) {
    // The bucket being filled now is not missing anything yet.
    if (Date.parse(b.start) + history.stepSeconds * 1000 > now) continue;
    samples += b.samples;
    expected += b.expectedSamples;
    if (b.samples === 0 && !inGap) gaps += 1;
    inGap = b.samples === 0;
  }
  return { samples, expected, gaps };
}

/** The bucket's name: seconds while buckets are seconds apart, the day
 * once the window is longer than one. */
export function bucketLabel(stepSeconds: number): TimeLabel {
  return (iso, span) => {
    const d = new Date(iso);
    const windowSeconds = span * stepSeconds;
    const time = d.toLocaleTimeString(
      undefined,
      stepSeconds < 60
        ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
        : { hour: "2-digit", minute: "2-digit" },
    );
    if (windowSeconds <= 86_400) return time;
    return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  };
}

/** What one bucket is, for a chart's label. */
export function bucketWord(stepSeconds: number): string {
  if (stepSeconds >= 3600) return "hour";
  if (stepSeconds >= 60) return "minute";
  return `${stepSeconds} s`;
}

/** Every series of one card, by metric. */
export interface GpuGroup {
  /** `gpu:<kind>:<index>` */
  id: string;
  name: string;
  index: number | null;
  series: Partial<Record<HostMetric, HostSeries>>;
}

export function gpuGroups(history: HostHistory): GpuGroup[] {
  const groups = new Map<string, GpuGroup>();
  for (const s of history.series) {
    if (!s.key.startsWith("gpu:")) continue;
    const id = s.key.split(":").slice(0, 3).join(":");
    const group = groups.get(id) ?? {
      id,
      name: s.deviceName ?? `GPU ${s.deviceIndex ?? ""}`.trim(),
      index: s.deviceIndex ?? null,
      series: {},
    };
    group.series[s.metric] = s;
    groups.set(id, group);
  }
  return [...groups.values()];
}

export interface DiskGroup {
  volume: string;
  holds: string[];
  free?: HostSeries;
  total?: HostSeries;
}

export function diskGroups(history: HostHistory): DiskGroup[] {
  const groups = new Map<string, DiskGroup>();
  for (const s of history.series) {
    if (s.metric !== "diskFree" && s.metric !== "diskTotal") continue;
    const volume = s.volume ?? s.key;
    const group = groups.get(volume) ?? { volume, holds: s.holds ?? [] };
    if (s.metric === "diskFree") group.free = s;
    else group.total = s;
    groups.set(volume, group);
  }
  return [...groups.values()];
}

/** A series that belongs to the machine rather than a card or a volume. */
export function hostSeries(history: HostHistory, metric: HostMetric): HostSeries | undefined {
  return history.series.find((s) => s.metric === metric && !s.deviceKind && !s.volume);
}

/** `24.1 GiB`, `512 MiB`: binary, as VRAM is quoted. */
export function formatBytes(count: number): string {
  const gib = count / 1024 ** 3;
  if (gib >= 100) return `${gib.toFixed(0)} GiB`;
  if (gib >= 1) return `${gib.toFixed(1)} GiB`;
  return `${Math.round(count / 1024 ** 2)} MiB`;
}

export function formatValue(unit: HostUnit, value: number): string {
  switch (unit) {
    case "bytes":
      return formatBytes(value);
    case "percent":
      return `${value < 10 ? value.toFixed(1) : Math.round(value)}%`;
    case "celsius":
      return `${Math.round(value)} °C`;
    case "watts":
      return `${Math.round(value)} W`;
    case "count":
      return String(Math.round(value));
  }
}

/** The newest reading of a series, formatted, or null when there is none. */
export function latestText(series: HostSeries | undefined): string | null {
  if (!series || series.latest === undefined || series.latest === null) return null;
  return formatValue(series.unit, series.latest);
}

/** `used of total` where the machine reports both, else whichever it has. */
export function ofTotal(
  used: HostSeries | undefined,
  total: HostSeries | undefined,
): string | null {
  const u = latestText(used);
  const t = latestText(total);
  if (u && t) return `${u} of ${t}`;
  return u ?? t;
}
