/**
 * The join behind the Inference screen: what the gateway routes to,
 * which runtime each driver follows, and which node the control root
 * places each on.
 *
 * Kept apart from the page so it can be tested against the bodies the
 * live install actually returns, rather than against fixtures invented
 * to match the code -- the recurring failure this project records.
 */

import type {
  ComponentPlacementList,
  DriversInfo,
  RoutingTableView,
  RuntimeList,
  RuntimePlacementList,
} from "./types";

/** One thing that can answer a request, as this screen shows it. */
export interface Row {
  key: string;
  node: string | null;
  driver: string | null;
  model: string | null;
  backend: string | null;
  url: string | null;
  runtime: string | null;
  engine: string | null;
  runtimeStatus: string | null;
  stopReason: string | null;
  reachable: boolean | null;
  eligible: boolean | null;
  ineligibleReason: string | null;
  inFlight: number | null;
  idleSeconds: number | null;
  error: string | null;
}

export type Sources = {
  drivers: DriversInfo | null;
  routing: RoutingTableView | null;
  placement: ComponentPlacementList | null;
  runtimes: RuntimePlacementList | null;
  localRuntimes: RuntimeList | null;
};

/**
 * The join. Rows are the gateway's drivers; a driver that follows a
 * runtime picks up that runtime's node, engine and state; a runtime the
 * gateway has no driver for yet (a companion still starting) is still a
 * row, from the control root's side. Placement — which node — comes
 * from the control root, which is the only party that knows.
 */
export function buildRows(sources: Sources, localName: string | null): Row[] {
  const nodeOfDriver = new Map<string, string>();
  for (const c of sources.placement?.components ?? []) {
    if (c.kind === "inference-driver") nodeOfDriver.set(c.name, c.node);
  }

  const routingByDriver = new Map<
    string,
    NonNullable<RoutingTableView["slots"]>[number]["tiers"][number]["backends"][number]
  >();
  for (const slot of sources.routing?.slots ?? []) {
    for (const tier of slot.tiers ?? []) {
      for (const backend of tier.backends ?? []) {
        if (backend.driver && !routingByDriver.has(backend.driver)) {
          routingByDriver.set(backend.driver, backend);
        }
      }
    }
  }

  type RuntimeInfo = {
    node: string | null;
    name: string;
    status: string | null;
    engine: string | null;
    model: string | null;
  };
  const runtimes: RuntimeInfo[] = sources.runtimes
    ? (sources.runtimes.runtimes ?? []).map((r) => ({
        node: r.node,
        name: r.name,
        status: r.status ?? null,
        engine: r.engine ?? null,
        model: r.modelAlias ?? null,
      }))
    : (sources.localRuntimes?.runtimes ?? []).map((r) => ({
        node: localName,
        name: r.name,
        status: r.status ?? null,
        engine: r.engine ?? null,
        model: r.modelAlias ?? null,
      }));
  const runtimeByName = new Map(runtimes.map((r) => [r.name, r]));

  const rows: Row[] = [];
  const seenRuntimes = new Set<string>();

  for (const d of sources.drivers?.drivers ?? []) {
    const routing = routingByDriver.get(d.name);
    const runtimeName = d.runtime ?? routing?.runtime ?? null;
    const runtime = runtimeName ? (runtimeByName.get(runtimeName) ?? null) : null;
    if (runtimeName) seenRuntimes.add(runtimeName);
    rows.push({
      key: `driver:${d.name}`,
      node: nodeOfDriver.get(d.name) ?? runtime?.node ?? routing?.node ?? null,
      driver: d.name,
      model: d.modelId ?? runtime?.model ?? null,
      backend: d.backend ?? null,
      url: d.url ?? null,
      runtime: runtimeName,
      engine: runtime?.engine ?? null,
      runtimeStatus: runtime?.status ?? routing?.runtime_status ?? null,
      stopReason: routing?.stop_reason ?? null,
      reachable: d.reachable,
      eligible: routing?.eligible ?? null,
      ineligibleReason: routing?.ineligible_reason ?? null,
      inFlight: routing?.in_flight ?? null,
      idleSeconds: routing?.idle_seconds ?? null,
      error: d.error ?? null,
    });
  }

  // Drivers the control root places but the gateway never mentioned:
  // declared, and the gateway either cannot see the node or has not
  // refreshed. Shown, because "declared and not routable" is the row
  // an operator is looking for when a model is missing from the list.
  for (const c of sources.placement?.components ?? []) {
    if (c.kind !== "inference-driver") continue;
    if (rows.some((r) => r.driver === c.name)) continue;
    rows.push({
      key: `placed:${c.node}/${c.name}`,
      node: c.node,
      driver: c.name,
      model: null,
      backend: null,
      url: c.url ?? null,
      runtime: null,
      engine: null,
      runtimeStatus: null,
      stopReason: null,
      reachable: null,
      eligible: null,
      ineligibleReason: null,
      inFlight: null,
      idleSeconds: null,
      error: c.status && c.status !== "running" ? `driver ${c.status}` : null,
    });
  }

  for (const r of runtimes) {
    if (seenRuntimes.has(r.name)) continue;
    rows.push({
      key: `runtime:${r.node ?? ""}/${r.name}`,
      node: r.node,
      driver: null,
      model: r.model,
      backend: null,
      url: null,
      runtime: r.name,
      engine: r.engine,
      runtimeStatus: r.status,
      stopReason: null,
      reachable: null,
      eligible: null,
      ineligibleReason: null,
      inFlight: null,
      idleSeconds: null,
      error: null,
    });
  }

  return rows.sort((a, b) => (a.model ?? a.driver ?? "").localeCompare(b.model ?? b.driver ?? ""));
}
