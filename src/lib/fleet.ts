/**
 * Every machine together (row 38), from each machine's host history.
 *
 * Each agent records its own machine (`GET /v1/node/history`); the console
 * reads them all through `node:<name>` and adds them up here. The rule from
 * the Hosts page holds: a reading a machine cannot make is `null`, never 0,
 * and a total over machines that report says how many did.
 */

import type { HostHistory, HostMetric, HostSeries } from "@/lib/hostHistory";

/** What the fleet view reads from each machine. */
export const FLEET_VIEW_METRICS: HostMetric[] = [
  "gpuMemoryUsed",
  "gpuMemoryTotal",
  "gpuUtilization",
  "gpuTemperature",
  "gpuPower",
  "diskFree",
  "diskTotal",
  "runtimesRunning",
];

export interface FleetRow {
  gpus: number;
  memoryUsed: number | null;
  memoryTotal: number | null;
  /** The GPUs' utilization now, averaged over the cards that report it. */
  utilization: number | null;
  /** The hottest card now, and the hottest reading in the window. */
  temperature: number | null;
  peakTemperature: number | null;
  /** The cards' draw now, summed, and their mean draw over the window. */
  power: number | null;
  meanPower: number | null;
  /** The fullest volume that holds models or engines. */
  fullestDisk: { volume: string; usedPercent: number } | null;
  runtimes: number | null;
}

function of(history: HostHistory, metric: HostMetric): HostSeries[] {
  return history.series.filter((s) => s.metric === metric && !s.unavailable);
}

function latest(series: HostSeries[]): number[] {
  return series.map((s) => s.latest).filter((v): v is number => typeof v === "number");
}

function sum(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
}

function meanOf(values: (number | null)[]): number | null {
  const finite = values.filter((v): v is number => v !== null);
  return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null;
}

export function fleetRow(history: HostHistory): FleetRow {
  const used = of(history, "gpuMemoryUsed");
  const temps = of(history, "gpuTemperature");
  const power = of(history, "gpuPower");
  const utilization = latest(of(history, "gpuUtilization"));
  const peaks = temps.flatMap((s) => s.max).filter((v): v is number => v !== null);
  const meanPower = power.map((s) => meanOf(s.mean)).filter((v): v is number => v !== null);
  const free = new Map(of(history, "diskFree").map((s) => [s.volume ?? s.key, s.latest]));
  let fullest: FleetRow["fullestDisk"] = null;
  for (const total of of(history, "diskTotal")) {
    const volume = total.volume ?? total.key;
    const left = free.get(volume);
    if (typeof total.latest !== "number" || total.latest <= 0 || typeof left !== "number") continue;
    const usedPercent = 100 * (1 - left / total.latest);
    if (!fullest || usedPercent > fullest.usedPercent) fullest = { volume, usedPercent };
  }
  const runtimes = latest(of(history, "runtimesRunning"));
  return {
    gpus: used.length,
    memoryUsed: sum(latest(used)),
    memoryTotal: sum(latest(of(history, "gpuMemoryTotal"))),
    utilization: utilization.length ? meanOf(utilization) : null,
    temperature: latest(temps).length ? Math.max(...latest(temps)) : null,
    peakTemperature: peaks.length ? Math.max(...peaks) : null,
    power: sum(latest(power)),
    meanPower: meanPower.length ? meanPower.reduce((a, b) => a + b, 0) : null,
    fullestDisk: fullest,
    runtimes: runtimes.length ? runtimes[0]! : null,
  };
}

export interface FleetTotals {
  machines: number;
  answering: number;
  gpus: number;
  memoryUsed: number | null;
  memoryTotal: number | null;
  utilization: number | null;
  power: number | null;
}

/** The machines added up. Utilization is weighted by each machine's cards. */
export function fleetTotals(rows: (FleetRow | null)[]): FleetTotals {
  const answering = rows.filter((r): r is FleetRow => r !== null);
  let weighted = 0;
  let cards = 0;
  for (const r of answering) {
    if (r.utilization !== null && r.gpus > 0) {
      weighted += r.utilization * r.gpus;
      cards += r.gpus;
    }
  }
  const total = (pick: (r: FleetRow) => number | null) =>
    sum(answering.map(pick).filter((v): v is number => v !== null));
  return {
    machines: rows.length,
    answering: answering.length,
    gpus: answering.reduce((n, r) => n + r.gpus, 0),
    memoryUsed: total((r) => r.memoryUsed),
    memoryTotal: total((r) => r.memoryTotal),
    utilization: cards ? weighted / cards : null,
    power: total((r) => r.power),
  };
}
