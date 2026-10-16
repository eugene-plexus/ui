"use client";

import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  CircleCheck,
  Clock3,
  Layers3,
  Network,
  Server,
  ShieldAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { MetricDial } from "@/components/MetricDial";

import { capacityBackends, durationLabel, percentage } from "@/lib/gatewayDashboard";
import { compact, msLabel } from "@/lib/metricsCharts";
import type { RoutingTableView } from "@/lib/types";

export function DashboardSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mb-7 scroll-mt-4" aria-label={title}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-ui text-base font-semibold tracking-tight">{title}</h2>
        <p className="font-ui text-xs text-[color:var(--muted)]">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function GatewayCapacity({
  routing,
  error,
  readAt,
}: {
  routing: RoutingTableView | null;
  error: string | null;
  readAt: number | null;
}) {
  const backends = routing ? capacityBackends(routing) : [];
  const eligible = backends.filter((b) => b.eligible);
  const inFlight = backends.every((b) => b.in_flight != null)
    ? backends.reduce((n, b) => n + b.in_flight!, 0)
    : null;
  const slots = eligible.every((b) => b.parallel_slots != null)
    ? eligible.reduce((n, b) => n + b.parallel_slots!, 0)
    : null;
  const unreachable = routing?.unreachable_drivers ?? [];
  const unavailableModels =
    routing?.slots.filter((s) => !s.tiers.some((t) => t.backends.some((b) => b.eligible))) ?? [];
  const control = routing?.control_root;
  const controlDown = control && control.source !== "none" && !control.reachable;
  const age = routing && readAt ? Math.max(0, readAt - Date.parse(routing.refreshed_at)) : null;
  const attention = unreachable.length > 0 || unavailableModels.length > 0 || controlDown;
  return (
    <DashboardSection
      id="capacity"
      title="Backend capacity"
      description="Current snapshot · all models on this gateway"
    >
      {error || !routing ? (
        <div className="section-panel text-sm text-[color:var(--muted)]" role="status">
          Capacity unavailable{error ? `: ${error}` : ". Waiting for routing data."} Historical
          metrics remain available.
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)]">
          <div className="grid divide-y divide-[color:var(--border)] sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4">
            {[
              {
                label: "Routable backends",
                value: `${eligible.length} / ${backends.length}`,
                sub: "unique backends in routing",
                icon: Server,
              },
              {
                label: "In flight",
                value: inFlight == null ? "unreported" : compact(inFlight),
                sub: "requests outstanding here",
                icon: Activity,
              },
              {
                label: "Routing slots",
                value: slots == null ? "unreported" : compact(slots),
                sub: "eligible backends · includes defaults",
                icon: Layers3,
              },
              {
                label: "Routing status",
                value: attention
                  ? "Needs attention"
                  : backends.length
                    ? "Routes available"
                    : "No routes",
                sub: routing.load_balancing
                  ? `Placement: ${routing.load_balancing}`
                  : "Placement unreported",
                icon: attention ? ShieldAlert : CircleCheck,
              },
            ].map(({ label, value, sub, icon: Icon }) => (
              <div key={label} className="min-w-0 p-4 sm:border-r sm:border-[color:var(--border)]">
                <div className="font-ui mb-2 flex items-center gap-2 text-xs text-[color:var(--muted)]">
                  <Icon size={15} aria-hidden />
                  {label}
                </div>
                <p className="font-ui text-xl font-semibold tabular-nums">{value}</p>
                <p className="mt-1 text-xs break-words text-[color:var(--muted)]">{sub}</p>
              </div>
            ))}
          </div>
          {(attention || (age !== null && age > 120_000)) && (
            <div className="status-warn space-y-1 border-y px-4 py-3 text-sm" role="status">
              {unreachable.length > 0 && (
                <p>
                  <strong>
                    {unreachable.length} unreachable driver{unreachable.length === 1 ? "" : "s"}:
                  </strong>{" "}
                  <span className="break-all">{unreachable.join(", ")}</span>
                </p>
              )}
              {unavailableModels.length > 0 && (
                <p>
                  <strong>
                    {unavailableModels.length} model route
                    {unavailableModels.length === 1 ? "" : "s"} without an eligible backend.
                  </strong>{" "}
                  Sleeping runtimes may start on demand.
                </p>
              )}
              {controlDown && (
                <p>
                  <strong>Control root unavailable.</strong>{" "}
                  {control.error ?? "Routing is using its last known node list."}
                </p>
              )}
              {age !== null && age > 120_000 && (
                <p>
                  Discovery snapshot is {durationLabel(age)} old. Current counters do not confirm
                  fresh backend health.
                </p>
              )}
            </div>
          )}
          {backends.length > 0 && (
            <div className="grid gap-px bg-[color:var(--panel)] lg:grid-cols-2 xl:grid-cols-3">
              {backends.map((b) => {
                const load =
                  b.in_flight != null && b.parallel_slots != null
                    ? b.in_flight / b.parallel_slots
                    : null;
                return (
                  <div
                    key={JSON.stringify([b.node, b.driver])}
                    className="min-w-0 bg-[color:var(--panel)] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-ui text-sm font-semibold break-all">{b.driver}</p>
                        <p className="mt-1 text-xs break-all text-[color:var(--muted)]">
                          {b.node ?? "Node unreported"}
                          {b.runtime ? ` / ${b.runtime}` : ""}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${b.eligible ? "status-success" : "status-warn"}`}
                      >
                        {b.eligible ? "Routable" : (b.runtime_status ?? "Unavailable")}
                      </span>
                    </div>
                    <div className="my-2 flex items-center gap-4">
                      <div className="w-32 shrink-0">
                        <MetricDial
                          value={b.in_flight}
                          total={b.parallel_slots}
                          label={`${b.driver} occupied routing slots`}
                        />
                      </div>
                      <div className="text-xs text-[color:var(--muted)]">
                        <p className="font-ui text-2xl font-semibold text-[color:var(--foreground)] tabular-nums">
                          {b.in_flight ?? "—"}
                          <span className="text-sm font-normal text-[color:var(--muted)]">
                            {" "}
                            / {b.parallel_slots ?? "—"}
                          </span>
                        </p>
                        <p className="mt-1">occupied routing slots</p>
                        {!b.eligible && <p className="mt-1">Currently not routable</p>}
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2 text-xs text-[color:var(--muted)]">
                      <span>
                        {b.in_flight ?? "—"} in flight / {b.parallel_slots ?? "—"} slots
                        {load !== null && load >= 1 ? " · at or above slot count" : ""}
                      </span>
                      <span>
                        {b.models.length} model route{b.models.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    {!b.eligible && (
                      <p className="mt-2 text-xs break-words text-[color:var(--muted)]">
                        {b.ineligible_reason ?? "No eligibility reason reported."}
                        {b.start_on_demand ? " Starts on demand." : ""}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap justify-between gap-2 border-t border-[color:var(--border)] bg-[color:var(--panel-soft)] px-4 py-3 text-xs text-[color:var(--muted)]">
            <p>
              Slots are routing capacity, not GPU utilization. Discovery:{" "}
              {Number.isFinite(age) ? `${durationLabel(age!)} ago` : "unreported"}.
            </p>
            <Link href="/routing" className="inline-flex items-center gap-1 underline">
              Inspect routing <ArrowUpRight size={13} aria-hidden />
            </Link>
          </div>
        </div>
      )}
    </DashboardSection>
  );
}

interface Distribution {
  p50: number;
  p90: number;
  p99?: number;
  max: number;
}
export interface OperationalGroup {
  requests: number;
  errors: number;
  cascaded: number;
  swappedIn: number;
  latencyMs?: Distribution | null;
  routingMs?: Distribution | null;
  waitedMs?: Distribution | null;
  overheadMs?: Distribution | null;
  promptCache?: { requests: number; promptTokens: number; cachedTokens: number } | null;
  affinity?: { hit: number; new: number; moved: number; evicted?: number } | null;
  tierCounts?: Record<string, number>;
}

export function GatewayEfficiency({ total }: { total: OperationalGroup | undefined }) {
  const cache = total?.promptCache;
  const affinity = total?.affinity;
  const home = affinity ? affinity.hit + (affinity.evicted ?? 0) : 0;
  const returning = home + (affinity?.moved ?? 0);
  const tiers = Object.entries(total?.tierCounts ?? {}).sort(([a], [b]) => Number(a) - Number(b));
  const tierTotal = tiers.reduce((n, [, v]) => n + v, 0);
  return (
    <DashboardSection
      id="efficiency"
      title="Routing & efficiency"
      description="Selected window and model · gateway measurements"
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="section-panel">
          <h3 className="font-ui mb-4 flex items-center gap-2 text-sm font-semibold">
            <Clock3 size={16} aria-hidden />
            Latency breakdown
          </h3>
          <dl className="space-y-3 text-sm">
            {[
              ["Request p90", total?.latencyMs?.p90],
              ["Request p99", total?.latencyMs?.p99],
              ["Routing p50", total?.routingMs?.p50],
              ["Gateway overhead p50", total?.overheadMs?.p50],
              ["Wake wait p50", total?.waitedMs?.p50],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-2">
                <dt className="text-[color:var(--muted)]">{label}</dt>
                <dd className="font-mono tabular-nums">
                  {typeof value === "number" ? msLabel(value) : "unreported"}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-[color:var(--muted)]">
            Independent distributions; these medians do not add up to request latency.
          </p>
        </div>
        <div className="section-panel">
          <h3 className="font-ui mb-4 flex items-center gap-2 text-sm font-semibold">
            <Layers3 size={16} aria-hidden />
            Prompt cache & continuity
          </h3>
          <div className="mx-auto w-36">
            <MetricDial
              variant="segments"
              value={cache?.cachedTokens}
              total={cache?.promptTokens}
              label="Prompt cache reuse"
            />
          </div>
          <p className="mt-1 text-xs text-[color:var(--muted)]">
            prompt tokens reused
            {cache
              ? ` · ${compact(cache.requests)} reporting requests`
              : " · no cache measurements"}
          </p>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-[color:var(--muted)]">Returned to same replica</dt>
              <dd className="font-mono">{returning ? `${home}/${returning}` : "unreported"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[color:var(--muted)]">History evictions</dt>
              <dd className="font-mono">{affinity?.evicted ?? "unreported"}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-[color:var(--muted)]">
            Cache reuse covers reporting backends only.
          </p>
        </div>
        <div className="section-panel">
          <h3 className="font-ui mb-4 flex items-center gap-2 text-sm font-semibold">
            <Network size={16} aria-hidden />
            Serving tiers
          </h3>
          {tiers.length ? (
            <div className="space-y-3">
              {tiers.map(([tier, count]) => (
                <div key={tier}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span>Tier {tier}</span>
                    <span className="font-mono">
                      {compact(count)} · {percentage(count, tierTotal)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[color:var(--panel-soft)]">
                    <div
                      className="h-full bg-[color:var(--accent-left)]"
                      style={{ width: `${tierTotal ? (count / tierTotal) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[color:var(--muted)]">Tier distribution unreported.</p>
          )}
          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-[color:var(--muted)]">Requests with failover</dt>
              <dd className="font-mono">{total ? compact(total.cascaded) : "—"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[color:var(--muted)]">Cold starts</dt>
              <dd className="font-mono">{total ? compact(total.swappedIn) : "—"}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-[color:var(--muted)]">
            Later tiers show reliance on fallback backends.
          </p>
        </div>
      </div>
    </DashboardSection>
  );
}
