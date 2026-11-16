import type { RoutingBackendView, RoutingTableView } from "@/lib/types";

export interface CapacityBackend extends RoutingBackendView {
  models: string[];
}

// Routing counters belong to (node, driver), not to a model alias or tier.
export function capacityBackends(routing: RoutingTableView): CapacityBackend[] {
  const unique = new Map<string, CapacityBackend>();
  for (const slot of routing.slots ?? []) {
    for (const tier of slot.tiers) {
      for (const backend of tier.backends) {
        const key = JSON.stringify([backend.node ?? null, backend.driver]);
        const previous = unique.get(key);
        if (previous) {
          if (!previous.models.includes(slot.model)) previous.models.push(slot.model);
        } else unique.set(key, { ...backend, models: [slot.model] });
      }
    }
  }
  return [...unique.values()].sort(
    (a, b) => Number(a.eligible) - Number(b.eligible) || a.driver.localeCompare(b.driver),
  );
}

export function percentage(part: number, total: number): string {
  if (total <= 0) return "—";
  const value = (part / total) * 100;
  if (value > 0 && value < 0.1) return "<0.1%";
  if (value > 99.9 && value < 100) return ">99.9%";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

export function durationLabel(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** The slice of a `groupBy=backend` metrics group the wake cost reads. */
export interface WakeGroup {
  model?: string | null;
  node?: string | null;
  runtime?: string | null;
  swappedIn: number;
  /** Metrics v16: the woken requests' waits, summed. */
  waitedMsSum?: number | null;
  /** The woken requests' waits, as percentiles: a gateway older than v16. */
  waitedMs?: { p50: number } | null;
  source?: "raw" | "rollup" | null;
}

export interface WakeCostRow {
  model: string;
  /** Requests that had to start a model first. */
  starts: number;
  /** What those requests waited, summed, over the starts whose wait is known. */
  waitMs: number;
  /** Starts whose wait was not kept: hours rolled up before metrics v16. */
  unknownStarts: number;
  /** True when the wait is the starts times a median (a gateway older than v16). */
  estimated: boolean;
  meanWaitMs: number | null;
  /** The machines and runtimes that were started, for "keep loaded". */
  places: { node: string | null; runtime: string | null }[];
  /** About how much energy the waits drew, in watt-hours: each machine's wait
   * times its GPUs' mean power over the window. Null when no machine involved
   * reports power. */
  energyWh: number | null;
}

/**
 * Wake cost per model (row 38): how often a request had to start the model,
 * how long people waited, and about what it cost in energy. The biggest
 * offenders first: ranked by starts times wait (the wait summed), not by
 * starts alone, because ten one-second starts cost less than two thirty-second
 * ones.
 */
export function wakeCost(
  groups: WakeGroup[],
  powerWatts: Record<string, number | null | undefined> = {},
): WakeCostRow[] {
  const rows = new Map<
    string,
    WakeCostRow & { energy: number; energyKnown: boolean; places: WakeCostRow["places"] }
  >();
  for (const g of groups) {
    if (!g.swappedIn) continue;
    const model = g.model ?? "unknown model";
    let row = rows.get(model);
    if (!row) {
      row = {
        model,
        starts: 0,
        waitMs: 0,
        unknownStarts: 0,
        estimated: false,
        meanWaitMs: null,
        places: [],
        energyWh: null,
        energy: 0,
        energyKnown: false,
      };
      rows.set(model, row);
    }
    row.starts += g.swappedIn;
    let wait: number | null;
    if (g.waitedMsSum != null && (g.waitedMsSum > 0 || g.source !== "rollup")) {
      wait = g.waitedMsSum;
    } else if (g.waitedMsSum == null && g.waitedMs) {
      wait = g.waitedMs.p50 * g.swappedIn;
      row.estimated = true;
    } else {
      wait = null;
    }
    if (wait === null) row.unknownStarts += g.swappedIn;
    else {
      row.waitMs += wait;
      const watts = g.node ? powerWatts[g.node] : null;
      if (watts != null) {
        row.energy += (wait / 3_600_000) * watts;
        row.energyKnown = true;
      }
    }
    const node = g.node ?? null;
    const runtime = g.runtime ?? null;
    if (!row.places.some((p) => p.node === node && p.runtime === runtime))
      row.places.push({ node, runtime });
  }
  return [...rows.values()]
    .map(({ energy, energyKnown, ...row }) => {
      const timed = row.starts - row.unknownStarts;
      return {
        ...row,
        meanWaitMs: timed > 0 ? Math.round(row.waitMs / timed) : null,
        energyWh: energyKnown ? Math.round(energy * 100) / 100 : null,
      };
    })
    .sort((a, b) => b.waitMs - a.waitMs || b.starts - a.starts || a.model.localeCompare(b.model));
}
