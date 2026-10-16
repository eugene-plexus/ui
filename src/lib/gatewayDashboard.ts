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
