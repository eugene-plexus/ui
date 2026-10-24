"use client";

/**
 * Hosts: what each machine's hardware did over time (host history,
 * specs `docs/design/host-history.md`, H5).
 *
 * Read in the Metrics page's order: the whole fleet first, one row per
 * card with its now-values and a line over the window, then one machine's
 * detail with tiles, charts and the same numbers as tables. Every machine
 * is read through `node:<name>`, so the fleet is one screen; a machine
 * that does not answer says so, with the age of the last reading this
 * page had from it.
 *
 * `null` is not 0 here either: a series a machine cannot read is "not
 * reported" with the machine's own reason, and a stretch with no samples
 * is a gap in the line.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { Suspense, useCallback, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { HourChart, type Series, StatTile } from "@/components/MetricsCharts";
import { ApiError, api, describeError } from "@/lib/api";
import {
  FLEET_METRICS,
  HOST_WINDOWS,
  type HostHistory,
  type HostMetric,
  type HostPoint,
  type HostSeries,
  bucketLabel,
  bucketWord,
  coverage,
  diskGroups,
  formatValue,
  gpuGroups,
  historyPath,
  hostSeries,
  latestText,
  ofTotal,
  pointsFrom,
} from "@/lib/hostHistory";
import { type TargetNode, useTargetNode } from "@/lib/nodeBudget";
import { parseSelection } from "@/lib/resourceTree";
import { clockTime, timeAgo } from "@/lib/relativeTime";
import { usePolling } from "@/lib/usePolling";
import { logsHref } from "@/lib/logs";

const POLL_MS = 15_000;
const LINE = "var(--accent-left)";
const LINE_SOFT = "color-mix(in oklab, var(--accent-right) 70%, var(--background))";

interface Reading {
  history: HostHistory | null;
  error: string | null;
  /** When `history` was read; kept across a failure, so "last reading" has an age. */
  readAt: number | null;
}

function keyOf(node: TargetNode): string {
  return node.name ?? "local";
}

export default function HostsPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const searchParams = useSearchParams();
  const selection = parseSelection(searchParams.get("sel"));
  const picker = useTargetNode();
  const [hours, setHours] = useState(1);
  const [chosen, setChosen] = useState<string | null>(null);
  const [fleet, setFleet] = useState<Record<string, Reading>>({});
  const [detail, setDetail] = useState<Reading>({ history: null, error: null, readAt: null });
  const [loaded, setLoaded] = useState(false);
  const seq = useRef(0);

  // A machine chosen in the tree is that machine; otherwise the one picked
  // in the fleet table, else this one.
  const treeNode =
    selection?.type === "agent"
      ? picker.nodes.find((n) => (selection.node ? n.name === selection.node : n.local))
      : undefined;
  const machines = treeNode ? [treeNode] : picker.nodes;
  const detailNode =
    treeNode ??
    picker.nodes.find((n) => keyOf(n) === chosen) ??
    picker.nodes.find((n) => n.local) ??
    null;
  const detailKey = detailNode ? keyOf(detailNode) : null;

  const load = useCallback(async () => {
    if (!picker.loaded) return;
    const mine = ++seq.current;
    const now = Date.now();
    const reads = await Promise.all(
      machines.map(async (node) => {
        try {
          const h = await api.get<HostHistory>(node.target, historyPath(hours, now, FLEET_METRICS));
          return [keyOf(node), { history: h, error: null }] as const;
        } catch (e) {
          return [keyOf(node), { history: null, error: describeError(e) }] as const;
        }
      }),
    );
    let full: Reading | null = null;
    if (detailNode) {
      try {
        const h = await api.get<HostHistory>(detailNode.target, historyPath(hours, now));
        full = { history: h, error: null, readAt: now };
      } catch (e) {
        full = {
          history: null,
          error:
            e instanceof ApiError && e.status === 404
              ? "This machine's agent is older than host history; update it to record its hardware."
              : describeError(e),
          readAt: null,
        };
      }
    }
    if (mine !== seq.current) return;
    setFleet((previous) => {
      const next: Record<string, Reading> = {};
      for (const [key, read] of reads) {
        const before = previous[key];
        next[key] = read.history
          ? { history: read.history, error: null, readAt: now }
          : { history: before?.history ?? null, error: read.error, readAt: before?.readAt ?? null };
      }
      return next;
    });
    if (full) setDetail(full);
    setLoaded(true);
    // `machines` and `detailNode` are derived from these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker.loaded, picker.nodes, hours, detailKey, treeNode?.name]);

  usePolling(load, POLL_MS);

  const exportJson = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            readAt: new Date().toISOString(),
            windowHours: hours,
            fleet,
            detail: { machine: detailNode?.label ?? null, ...detail },
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `hosts-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

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
            {HOST_WINDOWS.map((w) => (
              <option key={w.hours} value={w.hours}>
                {w.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!loaded}
            onClick={exportJson}
            className="font-ui inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-sm disabled:opacity-50"
          >
            <Download aria-hidden className="h-4 w-4" />
            Export JSON
          </button>
        </>
      }
    >
      {/* The shell is h-dvh with overflow hidden, so the page owns its
          scroll, as Metrics does. */}
      <main data-testid="hosts-scroll" className="relative z-10 min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          {!treeNode && (
            <FleetTable
              machines={machines}
              fleet={fleet}
              loaded={loaded}
              chosen={detailKey}
              onChoose={setChosen}
            />
          )}
          {detailNode && <MachineDetail node={detailNode} reading={detail} loaded={loaded} />}
        </div>
      </main>
    </AppShell>
  );
}

// --------------------------------------------------------------------------- //
// The fleet
// --------------------------------------------------------------------------- //

function Sparkline({ values, label }: { values: (number | null)[]; label: string }) {
  const W = 96;
  const H = 24;
  const finite = values.filter((v): v is number => v !== null);
  if (finite.length === 0) return null;
  const max = Math.max(...finite, 1e-9);
  const runs: string[][] = [];
  let run: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    const x = values.length === 1 ? W / 2 : (i / (values.length - 1)) * W;
    run.push(`${x.toFixed(1)},${(H - 2 - (v / max) * (H - 4)).toFixed(1)}`);
  });
  if (run.length) runs.push(run);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}>
      {runs.map((r, i) =>
        r.length === 1 ? (
          <circle key={i} cx={r[0]!.split(",")[0]} cy={r[0]!.split(",")[1]} r={1.5} fill={LINE} />
        ) : (
          <polyline key={i} points={r.join(" ")} fill="none" stroke={LINE} strokeWidth={1.5} />
        ),
      )}
    </svg>
  );
}

function NowCell({ series, label }: { series: HostSeries | undefined; label: string }) {
  if (!series) return <td className="py-2 pr-3 text-[color:var(--muted)]">—</td>;
  if (series.unavailable) {
    return (
      <td className="py-2 pr-3 text-xs text-[color:var(--muted)]" title={series.unavailable}>
        not reported
      </td>
    );
  }
  return (
    <td className="py-2 pr-3">
      <div className="flex items-center gap-2">
        <span className="w-16 tabular-nums">{latestText(series) ?? "—"}</span>
        <Sparkline values={series.mean} label={`${label} over the window`} />
      </div>
    </td>
  );
}

function FleetTable({
  machines,
  fleet,
  loaded,
  chosen,
  onChoose,
}: {
  machines: TargetNode[];
  fleet: Record<string, Reading>;
  loaded: boolean;
  chosen: string | null;
  onChoose: (key: string) => void;
}) {
  return (
    <section aria-labelledby="fleet-heading" className="section-panel min-w-0 overflow-x-auto">
      <h2 id="fleet-heading" className="font-ui mb-3 text-base font-semibold">
        Machines
      </h2>
      {!loaded ? (
        <p className="text-sm text-[color:var(--muted)]">Reading every machine…</p>
      ) : (
        <table aria-labelledby="fleet-heading" className="w-full text-left text-sm">
          <thead className="text-xs text-[color:var(--muted)]">
            <tr>
              <th className="py-1 pr-3 font-medium">Machine</th>
              <th className="py-1 pr-3 font-medium">GPU</th>
              <th className="py-1 pr-3 font-medium">Memory used</th>
              <th className="py-1 pr-3 font-medium">Held by Eugene</th>
              <th className="py-1 pr-3 font-medium">Utilization</th>
              <th className="py-1 pr-3 font-medium">Temperature</th>
              <th className="py-1 pr-3 font-medium">Power</th>
              <th className="py-1 pr-3 font-medium">Last reading</th>
            </tr>
          </thead>
          <tbody>
            {machines.map((node) => {
              const key = keyOf(node);
              const reading = fleet[key];
              const history = reading?.history ?? null;
              const gpus = history ? gpuGroups(history) : [];
              const name = (
                <button
                  type="button"
                  onClick={() => onChoose(key)}
                  aria-pressed={chosen === key}
                  className={`text-left underline-offset-2 hover:underline ${
                    chosen === key ? "font-semibold" : ""
                  }`}
                >
                  {node.label}
                </button>
              );
              const age = history?.latestAt ? timeAgo(history.latestAt) : null;
              if (reading?.error) {
                return (
                  <tr key={key} className="border-t border-[color:var(--border)] align-top">
                    <td className="py-2 pr-3">{name}</td>
                    <td colSpan={6} className="text-status-error py-2 pr-3 text-xs">
                      Not answering: {reading.error}{" "}
                      <Link
                        href={logsHref({ q: node.name ?? undefined })}
                        className="underline"
                        data-testid="hosts-silent-logs"
                      >
                        Logs →
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-xs text-[color:var(--muted)]">
                      {age ? `last reading ${age}` : "no reading yet"}
                    </td>
                  </tr>
                );
              }
              if (!history) {
                return (
                  <tr key={key} className="border-t border-[color:var(--border)]">
                    <td className="py-2 pr-3">{name}</td>
                    <td colSpan={7} className="py-2 pr-3 text-xs text-[color:var(--muted)]">
                      Reading…
                    </td>
                  </tr>
                );
              }
              if (gpus.length === 0) {
                return (
                  <tr key={key} className="border-t border-[color:var(--border)]">
                    <td className="py-2 pr-3">{name}</td>
                    <td colSpan={6} className="py-2 pr-3 text-xs text-[color:var(--muted)]">
                      {history.enabled
                        ? "No GPU on this machine; its CPU, memory and disks are below when you pick it."
                        : "Not recording."}
                    </td>
                    <td className="py-2 pr-3 text-xs text-[color:var(--muted)]">{age ?? "—"}</td>
                  </tr>
                );
              }
              return gpus.map((gpu, i) => (
                <tr key={`${key}|${gpu.id}`} className="border-t border-[color:var(--border)]">
                  <td className="py-2 pr-3">{i === 0 ? name : null}</td>
                  <td className="py-2 pr-3">{gpu.name}</td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums">
                        {ofTotal(gpu.series.gpuMemoryUsed, gpu.series.gpuMemoryTotal) ??
                          "not reported"}
                      </span>
                    </div>
                  </td>
                  <td
                    className="py-2 pr-3 tabular-nums"
                    title={gpu.series.gpuMemoryEugene?.unavailable ?? undefined}
                  >
                    {gpu.series.gpuMemoryEugene?.unavailable
                      ? "not reported"
                      : (latestText(gpu.series.gpuMemoryEugene) ?? "—")}
                  </td>
                  <NowCell series={gpu.series.gpuUtilization} label={`${gpu.name} utilization`} />
                  <NowCell series={gpu.series.gpuTemperature} label={`${gpu.name} temperature`} />
                  <NowCell series={gpu.series.gpuPower} label={`${gpu.name} power`} />
                  <td className="py-2 pr-3 text-xs text-[color:var(--muted)]">
                    {i === 0 ? (age ?? "—") : null}
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

// --------------------------------------------------------------------------- //
// One machine
// --------------------------------------------------------------------------- //

function chartOf(
  history: HostHistory,
  points: HostPoint[],
  title: string,
  lines: { series: HostSeries | undefined; name: string; soft?: boolean }[],
  caption?: string,
) {
  const present = lines.filter(
    (l): l is { series: HostSeries; name: string; soft?: boolean } =>
      !!l.series && !l.series.unavailable,
  );
  if (present.length === 0) return null;
  const unit = present[0]!.series.unit;
  const series: Series<HostPoint>[] = present.map((l) => ({
    name: l.name,
    value: (p) => p.values[l.series.key] ?? null,
    color: l.soft ? LINE_SOFT : LINE,
  }));
  return (
    <HourChart<HostPoint>
      key={title}
      title={title}
      caption={caption}
      points={points}
      series={series}
      kind="lines"
      format={(v) => formatValue(unit, v)}
      timeLabel={bucketLabel(history.stepSeconds)}
      per={bucketWord(history.stepSeconds)}
    />
  );
}

function SeriesTile({
  label,
  series,
  total,
}: {
  label: string;
  series: HostSeries | undefined;
  total?: HostSeries;
}) {
  if (!series) return null;
  const value = series.unavailable ? null : latestText(series);
  const totalText = total && !total.unavailable ? latestText(total) : null;
  return (
    <StatTile
      label={label}
      value={value}
      sub={series.unavailable ?? (totalText ? `of ${totalText}` : undefined)}
    />
  );
}

function MachineDetail({
  node,
  reading,
  loaded,
}: {
  node: TargetNode;
  reading: Reading;
  loaded: boolean;
}) {
  const history = reading.history;
  const points = useMemo(() => (history ? pointsFrom(history) : []), [history]);
  const settingsHref = node.local
    ? "/config?tab=agent&sel=agent#hostHistoryEnabled"
    : `/config?tab=${encodeURIComponent(`node:${node.name}`)}&sel=${encodeURIComponent(
        `agent:${node.name}`,
      )}#hostHistoryEnabled`;

  if (!loaded) return null;
  if (!history) {
    return (
      <section className="section-panel">
        <h2 className="font-ui mb-2 text-base font-semibold">{node.label}</h2>
        <p className="text-status-error text-sm">
          {reading.error ?? "This machine has not answered yet."}{" "}
          <Link href={logsHref({ q: node.name ?? undefined })} className="underline">
            Logs →
          </Link>
        </p>
      </section>
    );
  }

  const gpus = gpuGroups(history);
  const disks = diskGroups(history);
  const cover = coverage(history);
  const unreported = history.series.filter((s) => s.unavailable);
  const metric = (m: HostMetric) => hostSeries(history, m);

  return (
    <section aria-labelledby="machine-heading" className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="machine-heading" className="font-ui text-base font-semibold">
          {node.label}
        </h2>
        <span className="text-xs text-[color:var(--muted)]">
          {history.latestAt
            ? `newest reading ${clockTime(history.latestAt)}, one every ${history.sampleSeconds} s`
            : "nothing recorded yet"}
          {cover.expected > 0 &&
            ` · ${cover.samples.toLocaleString()} of ${cover.expected.toLocaleString()} expected readings in this window`}
          {cover.gaps > 0 && ` · ${cover.gaps} gap${cover.gaps === 1 ? "" : "s"}`}
          {history.truncated && " · the start of this window is older than what is kept"}
        </span>
      </header>

      {!history.enabled && (
        <p className="rounded-[var(--radius)] border border-[color:var(--border)] p-3 text-sm">
          Recording is off on this machine; what was recorded is still shown.{" "}
          <Link href={settingsHref} className="underline">
            Turn it on in Settings
          </Link>
          .
        </p>
      )}

      {gpus.map((gpu) => (
        <div key={gpu.id} className="flex min-w-0 flex-col gap-3">
          <h3 className="font-ui text-sm font-semibold">{gpu.name}</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <SeriesTile
              label="Memory used"
              series={gpu.series.gpuMemoryUsed}
              total={gpu.series.gpuMemoryTotal}
            />
            <SeriesTile label="Held by Eugene" series={gpu.series.gpuMemoryEugene} />
            <SeriesTile label="Utilization" series={gpu.series.gpuUtilization} />
            <SeriesTile label="Temperature" series={gpu.series.gpuTemperature} />
            <SeriesTile label="Power" series={gpu.series.gpuPower} />
          </div>
          <div className="grid min-w-0 gap-3 lg:grid-cols-2">
            {chartOf(
              history,
              points,
              "GPU memory",
              [
                { series: gpu.series.gpuMemoryUsed, name: "Used" },
                { series: gpu.series.gpuMemoryEugene, name: "Held by Eugene", soft: true },
              ],
              latestText(gpu.series.gpuMemoryTotal)
                ? `of ${latestText(gpu.series.gpuMemoryTotal)}`
                : undefined,
            )}
            {chartOf(history, points, "GPU utilization", [
              { series: gpu.series.gpuUtilization, name: "Utilization" },
            ])}
            {chartOf(history, points, "GPU temperature", [
              { series: gpu.series.gpuTemperature, name: "Temperature" },
            ])}
            {chartOf(history, points, "GPU power", [
              { series: gpu.series.gpuPower, name: "Power" },
            ])}
          </div>
        </div>
      ))}

      <div className="flex min-w-0 flex-col gap-3">
        <h3 className="font-ui text-sm font-semibold">This machine</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SeriesTile label="CPU" series={metric("cpuUtilization")} />
          <SeriesTile label="RAM used" series={metric("ramUsed")} total={metric("ramTotal")} />
          <SeriesTile label="Swap used" series={metric("swapUsed")} total={metric("swapTotal")} />
          <SeriesTile label="Runtimes running" series={metric("runtimesRunning")} />
        </div>
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          {chartOf(history, points, "CPU", [{ series: metric("cpuUtilization"), name: "CPU" }])}
          {chartOf(
            history,
            points,
            "RAM used",
            [{ series: metric("ramUsed"), name: "RAM used" }],
            latestText(metric("ramTotal")) ? `of ${latestText(metric("ramTotal"))}` : undefined,
          )}
          {chartOf(history, points, "Swap used", [
            { series: metric("swapUsed"), name: "Swap used" },
          ])}
          {chartOf(history, points, "Runtimes", [
            { series: metric("runtimesRunning"), name: "Running" },
            { series: metric("runtimesLoading"), name: "Loading", soft: true },
          ])}
        </div>
      </div>

      {disks.length > 0 && (
        <div className="flex min-w-0 flex-col gap-3">
          <h3 className="font-ui text-sm font-semibold">Disks</h3>
          <div className="grid min-w-0 gap-3 lg:grid-cols-2">
            {disks.map((disk) =>
              disk.free?.unavailable ? (
                <p key={disk.volume} className="section-panel text-sm">
                  <span className="font-semibold">{disk.volume}</span>{" "}
                  <span className="text-[color:var(--muted)]">
                    not reported: {disk.free.unavailable}
                  </span>
                </p>
              ) : (
                chartOf(
                  history,
                  points,
                  `Free on ${disk.volume}`,
                  [{ series: disk.free, name: "Free" }],
                  [
                    latestText(disk.total) ? `of ${latestText(disk.total)}` : null,
                    disk.holds.length ? `holds ${disk.holds.join("; ")}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined,
                )
              ),
            )}
          </div>
        </div>
      )}

      {unreported.length > 0 && (
        <details className="section-panel text-sm">
          <summary className="font-ui cursor-pointer">
            Not reported on this machine ({unreported.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {unreported.map((s) => (
              <li key={s.key}>
                <span className="font-medium">{s.label}</span>
                <span className="text-[color:var(--muted)]">: {s.unavailable}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
