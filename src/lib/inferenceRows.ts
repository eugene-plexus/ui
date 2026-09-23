/**
 * The join behind the Inference screen: what the gateway routes to,
 * which runtime each driver follows, and which node the control root
 * places each on.
 *
 * Kept apart from the page so it can be tested against the bodies the
 * live install actually returns, rather than against fixtures invented
 * to match the code -- the recurring failure this project records.
 */

import type { NodeFacts } from "./issues";
import type {
  ComponentPlacementList,
  ComputeDevice,
  DriversInfo,
  RoutingTableView,
  Runtime,
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
  // **A driver's NAME is unique per machine, not per install** (R1.6).
  // The Library names a runtime after its model and the agent adds
  // "-driver", so one model launched on two machines is two `qwen-driver`s.
  // Keyed by bare name, the second overwrote the first: both rows landed
  // under one machine with one state, the other machine said it served
  // nothing, and Stop on what looked like machine A's copy stopped B's.
  // So every map here is keyed by (node, name) or by (name, url), and a
  // bare name is trusted only when exactly one thing carries it.
  const placedDrivers = (sources.placement?.components ?? []).filter(
    (c) => c.kind === "inference-driver",
  );

  type Backend = NonNullable<
    RoutingTableView["slots"]
  >[number]["tiers"][number]["backends"][number];
  const routingByDriverUrl = new Map<string, Backend>();
  const routingByName = new Map<string, Backend[]>();
  for (const slot of sources.routing?.slots ?? []) {
    for (const tier of slot.tiers ?? []) {
      for (const backend of tier.backends ?? []) {
        if (!backend.driver) continue;
        const byUrl = `${backend.driver}@${backend.url ?? ""}`;
        if (!routingByDriverUrl.has(byUrl)) routingByDriverUrl.set(byUrl, backend);
        const named = routingByName.get(backend.driver) ?? [];
        if (!named.some((b) => b.node === backend.node && b.url === backend.url)) {
          named.push(backend);
        }
        routingByName.set(backend.driver, named);
      }
    }
  }
  const routingFor = (name: string, url: string | undefined): Backend | undefined => {
    const exact = routingByDriverUrl.get(`${name}@${url ?? ""}`);
    if (exact) return exact;
    const named = routingByName.get(name) ?? [];
    return named.length === 1 ? named[0] : undefined;
  };
  const placedNodeFor = (name: string, url: string | undefined): string | null => {
    const named = placedDrivers.filter((c) => c.name === name);
    if (named.length === 1) return named[0]!.node;
    return named.find((c) => url !== undefined && c.url === url)?.node ?? null;
  };

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
  const onNode = (node: string | null, name: string) => `${node ?? ""}/${name}`;
  const runtimeByNode = new Map(runtimes.map((r) => [onNode(r.node, r.name), r]));
  const runtimeFor = (node: string | null, name: string): (typeof runtimes)[number] | null => {
    const exact = runtimeByNode.get(onNode(node, name));
    if (exact) return exact;
    const named = runtimes.filter((r) => r.name === name);
    return named.length === 1 ? named[0]! : null;
  };

  const rows: Row[] = [];
  const seenRuntimes = new Set<string>();

  for (const d of sources.drivers?.drivers ?? []) {
    const routing = routingFor(d.name, d.url);
    const runtimeName = d.runtime ?? routing?.runtime ?? null;
    // Which machine: the gateway's own view of this backend first (it
    // is keyed by node since R1.6), then the control root's placement.
    const placedNode = routing?.node ?? placedNodeFor(d.name, d.url);
    const runtime = runtimeName ? runtimeFor(placedNode, runtimeName) : null;
    const node = placedNode ?? runtime?.node ?? null;
    if (runtimeName) seenRuntimes.add(onNode(runtime?.node ?? node, runtimeName));
    rows.push({
      key: `driver:${onNode(node, d.name)}@${d.url ?? ""}`,
      node,
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
  for (const c of placedDrivers) {
    if (rows.some((r) => r.driver === c.name && r.node === c.node)) continue;
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
    if (seenRuntimes.has(onNode(r.node, r.name))) continue;
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

/**
 * What a node knows about its own runtimes that the control root does
 * not.
 *
 * `RuntimePlacement` — the root's union view, which is what the rows
 * above are built from — is `{node, name, modelAlias, status, url,
 * engine}`. It carries no `flags`, no `lastRestart` and no `localPath`,
 * so neither of the Inference screen's two honest states can be answered
 * from it: whether a model declared no offload, how long it has been
 * loading, and which share the bytes are crossing all live on the node's
 * own `GET /v1/runtimes`. The devices come from the same node's
 * `GET /v1/node`.
 *
 * Those four reads per node are exactly what the Issues poll already
 * makes, which is why this takes `NodeFacts` rather than fetching: a
 * second poll would double the traffic to every machine in the install
 * to render two lines.
 */
export interface NodeDetail {
  /** Null when that node did not answer, which is not the same as a
   * machine with no accelerator — `describeCompute` says nothing at all
   * for the first and something definite for the second. */
  devices: ComputeDevice[] | null;
  runtimes: Map<string, Runtime>;
}

/** Per-node detail, keyed the way `Row.node` is: the install name, or
 * null for the local node on a host that has never enrolled. */
export function nodeDetails(
  facts: Pick<NodeFacts, "name" | "identity" | "runtimes">[],
): Map<string | null, NodeDetail> {
  const out = new Map<string | null, NodeDetail>();
  for (const node of facts) {
    out.set(node.name, {
      devices: node.identity?.devices ?? null,
      runtimes: new Map((node.runtimes?.runtimes ?? []).map((r) => [r.name, r])),
    });
  }
  return out;
}

/** The node's own record of a row's runtime, when both are known. */
export function runtimeOf(
  row: Pick<Row, "node" | "runtime">,
  details: Map<string | null, NodeDetail>,
): Runtime | null {
  if (!row.runtime) return null;
  return details.get(row.node)?.runtimes.get(row.runtime) ?? null;
}
