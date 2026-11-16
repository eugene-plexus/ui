"use client";

/**
 * The administrator's dashboards (row 38, `specs/docs/design/rows/row-38.md`).
 *
 * Three questions, in the order an administrator asks them:
 *
 *   1. How are the machines doing, all of them together?
 *   2. What does waking models cost the people who wait?
 *   3. Is each SLO met, and how much error budget is left?
 *
 * The data leads; the settings behind it (rules, SLO targets, the webhook)
 * are on the Alerts page. Machines are read from each one's host history
 * through this console's proxy, the wake cost from the gateway's hourly
 * metrics (rollups past retention included), and the SLOs from the control
 * root, which evaluates them for alerts too, so this page and an alert never
 * disagree.
 */

import Link from "next/link";
import { Gauge, HardDrive, LayoutDashboard, Target, Timer } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { DashboardSection, WakeCost } from "@/components/GatewayOperations";
import { MetricDial } from "@/components/MetricDial";
import { StatTile } from "@/components/MetricsCharts";
import { api, ApiError, describeError } from "@/lib/api";
import { sloLine, type AlertsView, type SloStatus } from "@/lib/alerts";
import { fleetRow, fleetTotals, FLEET_VIEW_METRICS, type FleetRow } from "@/lib/fleet";
import type { WakeGroup } from "@/lib/gatewayDashboard";
import { formatBytes, historyPath, type HostHistory } from "@/lib/hostHistory";
import { msLabel } from "@/lib/metricsCharts";
import { useTargetNode } from "@/lib/nodeBudget";
import { inOperationsMode } from "@/lib/operations";
import { clockTime } from "@/lib/relativeTime";
import { usePolling } from "@/lib/usePolling";

const WINDOWS: { label: string; hours: number }[] = [
  { label: "Last 24 hours", hours: 24 },
  { label: "Last 7 days", hours: 24 * 7 },
  { label: "Last 30 days", hours: 24 * 30 },
  { label: "Last 90 days", hours: 24 * 90 },
];

const POLL_MS = 60_000;

interface MachineRead {
  key: string;
  label: string;
  row: FleetRow | null;
  error: string | null;
}

const percent = (v: number | null) => (v === null ? null : `${v.toFixed(0)}%`);

export default function DashboardsPage() {
  const picker = useTargetNode();
  const [hours, setHours] = useState(24 * 7);
  const [machines, setMachines] = useState<MachineRead[] | null>(null);
  const [wake, setWake] = useState<WakeGroup[] | null>(null);
  const [wakeError, setWakeError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<AlertsView | null>(null);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [readAt, setReadAt] = useState<number | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!picker.loaded) return;
    const mine = ++seq.current;
    const now = Date.now();
    const since = encodeURIComponent(new Date(now - hours * 3600_000).toISOString());
    const [reads, metrics, root] = await Promise.all([
      Promise.all(
        picker.nodes.map(async (node): Promise<MachineRead> => {
          const key = node.name ?? "local";
          try {
            const h = await api.get<HostHistory>(
              node.target,
              historyPath(hours, now, FLEET_VIEW_METRICS),
            );
            return { key, label: node.label, row: fleetRow(h), error: null };
          } catch (e) {
            return { key, label: node.label, row: null, error: describeError(e) };
          }
        }),
      ),
      api
        .get<{ groups: WakeGroup[] }>(
          "gateway",
          `/v1/metrics?groupBy=backend&bucket=hour&since=${since}`,
        )
        .then((m) => ({ ok: true as const, groups: m.groups }))
        .catch((e: unknown) => ({ ok: false as const, error: e })),
      api
        .get<AlertsView>("control", "/v1/alerts")
        .then((a) => ({ ok: true as const, view: a }))
        .catch((e: unknown) => ({ ok: false as const, error: e })),
    ]);
    if (mine !== seq.current) return;
    setMachines(reads);
    if (metrics.ok) {
      setWake(metrics.groups);
      setWakeError(null);
    } else {
      setWakeError(
        metrics.error instanceof ApiError && metrics.error.status === 503
          ? "The gateway does not keep request metrics. Turn them on in Settings."
          : describeError(metrics.error),
      );
    }
    if (root.ok) {
      setAlerts(root.view);
      setAlertsError(null);
    } else setAlertsError(describeError(root.error));
    setReadAt(now);
  }, [picker.loaded, picker.nodes, hours]);

  usePolling(load, POLL_MS);

  const totals = useMemo(() => fleetTotals((machines ?? []).map((m) => m.row)), [machines]);
  const powerWatts = useMemo(
    () =>
      Object.fromEntries(
        (machines ?? []).map((m) => [m.key, m.row?.meanPower ?? null] as const),
      ) as Record<string, number | null>,
    [machines],
  );
  const owner = !inOperationsMode();

  return (
    <AppShell
      controls={
        <>
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            aria-label="Time window"
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-1 text-sm"
          >
            {WINDOWS.map((w) => (
              <option key={w.hours} value={w.hours}>
                {w.label}
              </option>
            ))}
          </select>
          {readAt !== null && (
            <span className="font-ui text-sm text-[color:var(--muted)]">
              as of {clockTime(readAt)}
            </span>
          )}
        </>
      }
    >
      <main
        data-testid="dashboards-scroll"
        className="relative z-10 min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
          <header className="mb-6 border-b border-[color:var(--border)] pb-5">
            <p className="font-ui mb-2 flex items-center gap-2 text-xs font-semibold tracking-widest text-[color:var(--accent-left)]">
              <LayoutDashboard size={15} aria-hidden />
              DASHBOARDS
            </p>
            <h1 className="font-ui text-3xl font-semibold tracking-tight">
              Machines, wake cost and SLOs.
            </h1>
            <p className="mt-2 text-sm text-[color:var(--muted)]">
              Every machine together, what starting models made people wait, and how each target
              stands.{" "}
              <Link href="/alerts" className="underline">
                Alerts
              </Link>{" "}
              holds the rules and where they are sent.
            </p>
          </header>

          <DashboardSection
            id="fleet"
            title="Machines together"
            description="Now, and the hottest reading in the window · from each machine's host history"
          >
            {machines === null ? (
              <p className="font-ui text-sm text-[color:var(--muted)]">Loading…</p>
            ) : (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <StatTile
                    label="Machines answering"
                    value={`${totals.answering} of ${totals.machines}`}
                    sub={`${totals.gpus} GPU${totals.gpus === 1 ? "" : "s"} reporting`}
                  />
                  <div className="section-panel flex flex-col items-center justify-center">
                    <div className="w-28">
                      <MetricDial
                        value={totals.memoryUsed}
                        total={totals.memoryTotal}
                        label="GPU memory in use, every machine"
                      />
                    </div>
                    <p className="font-ui mt-1 text-xs text-[color:var(--muted)]">
                      {totals.memoryUsed !== null && totals.memoryTotal !== null
                        ? `${formatBytes(totals.memoryUsed)} of ${formatBytes(totals.memoryTotal)} GPU memory`
                        : "GPU memory not reported"}
                    </p>
                  </div>
                  <StatTile
                    label="GPU utilization"
                    value={percent(totals.utilization)}
                    sub="now, every card"
                  />
                  <StatTile
                    label="GPU power"
                    value={totals.power === null ? null : `${totals.power.toFixed(0)} W`}
                    sub="now, every card"
                  />
                </div>
                <FleetTable machines={machines} />
              </>
            )}
          </DashboardSection>

          <DashboardSection
            id="wake"
            title="Wake cost"
            description="Requests that had to start a model first · the costliest first · energy is an estimate"
          >
            <p className="mb-3 text-sm text-[color:var(--muted)]">
              <Timer
                size={14}
                aria-hidden
                className="mr-1 inline text-[color:var(--accent-right)]"
              />
              Each start makes someone wait. A model started often, or slowly, is worth keeping
              loaded.
            </p>
            {wakeError ? (
              <p className="text-status-error font-ui text-sm" role="alert">
                Wake cost not read: {wakeError}
              </p>
            ) : wake === null ? (
              <p className="font-ui text-sm text-[color:var(--muted)]">Loading…</p>
            ) : (
              <WakeCost groups={wake} powerWatts={powerWatts} />
            )}
          </DashboardSection>

          <DashboardSection
            id="slos"
            title="SLOs"
            description="Rolling windows · success from hourly totals · first token from the requests kept whole"
          >
            {alertsError ? (
              <p className="text-status-error font-ui text-sm" role="alert">
                SLOs not read: {alertsError}
              </p>
            ) : alerts === null ? (
              <p className="font-ui text-sm text-[color:var(--muted)]">Loading…</p>
            ) : alerts.slos.length === 0 ? (
              <p className="text-sm text-[color:var(--muted)]">
                No SLO targets are set.{" "}
                {owner ? (
                  <Link href="/alerts#slos" className="underline">
                    Set one on the Alerts page
                  </Link>
                ) : (
                  "The owner sets them."
                )}
              </p>
            ) : (
              <SloTable slos={alerts.slos} />
            )}
          </DashboardSection>
        </div>
      </main>
    </AppShell>
  );
}

function FleetTable({ machines }: { machines: MachineRead[] }) {
  return (
    <div className="section-panel overflow-x-auto">
      <table aria-label="Every machine" className="font-ui w-full text-left text-sm">
        <thead className="text-xs text-[color:var(--muted)]">
          <tr>
            <th className="py-2 pr-3 font-medium">Machine</th>
            <th className="py-2 pr-3 font-medium">GPU memory</th>
            <th className="py-2 pr-3 font-medium">Utilization</th>
            <th className="py-2 pr-3 font-medium">Temperature</th>
            <th className="py-2 pr-3 font-medium">Power</th>
            <th className="py-2 pr-3 font-medium">Fullest disk</th>
            <th className="py-2 font-medium">Running</th>
          </tr>
        </thead>
        <tbody>
          {machines.map((m) => (
            <tr key={m.key} className="border-t border-[color:var(--border)]">
              <td className="py-2 pr-3">
                <Link
                  href={
                    m.key === "local"
                      ? "/hosts"
                      : `/hosts?sel=${encodeURIComponent(`agent:${m.key}`)}`
                  }
                  className="inline-flex items-center gap-1.5 underline"
                >
                  <HardDrive size={14} aria-hidden className="text-[color:var(--accent-left)]" />
                  {m.label}
                </Link>
              </td>
              {m.row === null ? (
                <td colSpan={6} className="text-status-error py-2 text-xs">
                  Not answering: {m.error ?? "no reason given"}
                </td>
              ) : (
                <>
                  <td className="py-2 pr-3 font-mono tabular-nums">
                    {m.row.memoryUsed !== null && m.row.memoryTotal !== null
                      ? `${formatBytes(m.row.memoryUsed)} / ${formatBytes(m.row.memoryTotal)}`
                      : "not reported"}
                  </td>
                  <td className="py-2 pr-3 font-mono tabular-nums">
                    {percent(m.row.utilization) ?? "not reported"}
                  </td>
                  <td className="py-2 pr-3 font-mono tabular-nums">
                    {m.row.temperature === null
                      ? "not reported"
                      : `${m.row.temperature.toFixed(0)} °C`}
                    {m.row.peakTemperature !== null && (
                      <span className="text-xs text-[color:var(--muted)]">
                        {" "}
                        · peak {m.row.peakTemperature.toFixed(0)} °C
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 font-mono tabular-nums">
                    {m.row.power === null ? "not reported" : `${m.row.power.toFixed(0)} W`}
                  </td>
                  <td className="py-2 pr-3 font-mono tabular-nums">
                    {m.row.fullestDisk
                      ? `${m.row.fullestDisk.usedPercent.toFixed(0)}% · ${m.row.fullestDisk.volume}`
                      : "not reported"}
                  </td>
                  <td className="py-2 font-mono tabular-nums">
                    {m.row.runtimes === null
                      ? "—"
                      : `${m.row.runtimes} model${m.row.runtimes === 1 ? "" : "s"}`}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATE_TONE: Record<SloStatus["state"], string> = {
  met: "text-[color:var(--status-success-fg)]",
  "at-risk": "text-[color:var(--status-warn-fg)]",
  missed: "text-status-error",
  "no-data": "text-[color:var(--muted)]",
};

function SloTable({ slos }: { slos: SloStatus[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {slos.map((slo) => (
        <article key={slo.id} aria-label={`SLO ${slo.name ?? slo.id}`} className="section-panel">
          <h3
            className={`font-ui mb-2 flex items-center gap-2 text-sm font-semibold ${STATE_TONE[slo.state]}`}
          >
            <Target size={15} aria-hidden />
            {sloLine(slo)}
          </h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-[color:var(--muted)]">For</dt>
            <dd>
              {slo.clientKeyId
                ? `key ${slo.clientKeyName ?? slo.clientKeyId}`
                : (slo.model ?? "every model")}
            </dd>
            <dt className="text-[color:var(--muted)]">Target</dt>
            <dd className="font-mono">
              {slo.successPercent}% served over {slo.windowDays} days
            </dd>
            <dt className="text-[color:var(--muted)]">Measured</dt>
            <dd className="font-mono">
              {slo.measuredPercent === null || slo.measuredPercent === undefined
                ? "no requests"
                : `${slo.measuredPercent.toFixed(2)}% · ${slo.failures} failed of ${slo.requests}`}
            </dd>
            <dt className="text-[color:var(--muted)]">Error budget left</dt>
            <dd>
              {slo.budgetLeftPercent === null || slo.budgetLeftPercent === undefined ? (
                "—"
              ) : (
                <span className="flex items-center gap-2">
                  <span className="h-2 w-24 overflow-hidden rounded-full bg-[color:var(--panel-soft)]">
                    <span
                      className="block h-full bg-[color:var(--accent-left)]"
                      style={{ width: `${Math.max(0, Math.min(100, slo.budgetLeftPercent))}%` }}
                    />
                  </span>
                  <span className="font-mono">{slo.budgetLeftPercent.toFixed(0)}%</span>
                </span>
              )}
            </dd>
            <dt className="text-[color:var(--muted)]">Burn rate, last hour</dt>
            <dd className="font-mono">
              {slo.burnRate === null || slo.burnRate === undefined
                ? "no requests"
                : `${slo.burnRate.toFixed(1)}×`}
            </dd>
            {slo.firstToken && (
              <>
                <dt className="text-[color:var(--muted)]">
                  First token, {slo.firstToken.percentile}%
                </dt>
                <dd className="font-mono">
                  {slo.firstToken.measuredSeconds === null ||
                  slo.firstToken.measuredSeconds === undefined
                    ? "nothing streamed"
                    : `${msLabel(slo.firstToken.measuredSeconds * 1000)} (target ${msLabel(slo.firstToken.targetSeconds * 1000)})`}
                  <span className="block text-xs text-[color:var(--muted)]">
                    over the last {slo.firstToken.keptDays.toFixed(0)} days kept whole
                  </span>
                </dd>
              </>
            )}
          </dl>
          {slo.coveredDays !== undefined && slo.coveredDays < slo.windowDays - 0.5 && (
            <p className="mt-2 text-xs text-[color:var(--muted)]">
              <Gauge size={12} aria-hidden className="mr-1 inline" />
              The gateway&apos;s records reach back {slo.coveredDays.toFixed(1)} of {slo.windowDays}{" "}
              days.
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
