"use client";

/**
 * What each backend actually did.
 *
 * The questions this page exists to answer, in the order they get
 * asked:
 *
 *   1. How fast does it feel — first token, and decode speed?
 *   2. Which of my backends is faster for this model?
 *   3. Is anything failing?
 *   4. What is idle unload costing me?
 *   5. Is a later tier quietly serving everything?
 *   6. What did last night look like?
 *
 * Three restraints are deliberate and should survive edits.
 *
 * **"Unreported" is not "zero".** A backend that did not report token
 * counts leaves `tokensPerSecond` null. Rendering that as `0 tok/s` says
 * "slow" where it means "unmeasured", and the operator cannot recover
 * the difference from the screen. The same rule covers `ttftMs` and
 * `decodeTokensPerSecond` (null when nothing streamed) and every chart
 * point (a missing hour breaks the line rather than drawing a zero).
 *
 * **These numbers describe this box only.** Not a benchmark, and not a
 * ranking of hardware. Same line M3 locked for quant guidance: state
 * what happened here, never what is better in general.
 *
 * **A small sample says so.** Generation latency is long-tailed and a
 * first request against a cold backend can be twenty times a warm one,
 * so a median over two samples is nearly meaningless. The sample count
 * is shown next to every throughput figure rather than buried.
 *
 * Two numbers are deliberately different and both shown: `Tokens/sec`
 * is the whole serving attempt (prefill included), `Decode` is tokens
 * over the time after the first streamed event. The gap between them IS
 * the prefill cost — collapsing them into one number was the defect.
 *
 * The overview charts read `groupBy=total`, because percentiles cannot
 * be recombined client-side: the install-wide p50 is the server's to
 * compute over raw rows, never a merge of per-backend p50s.
 */

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { HourChart, StatTile } from "@/components/MetricsCharts";
import { CopyButton } from "@/components/CopyButton";
import { ApiError, api, describeError } from "@/lib/api";
import { compact, hourlyPoints, msLabel, tilesFrom } from "@/lib/metricsCharts";
import type { ClientUsageSummary } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";
import { formatTimestamp } from "@/lib/relativeTime";

interface Percentiles {
  p50: number;
  p90: number;
  p99?: number;
  max: number;
}

interface Throughput {
  p50: number;
  p90?: number;
  samples: number;
}

interface MetricsGroup {
  bucketStart?: string;
  model?: string;
  driver?: string;
  runtime?: string | null;
  node?: string | null;
  backend?: string | null;
  requests: number;
  errors: number;
  cascaded: number;
  swappedIn: number;
  latencyMs: Percentiles;
  tokensPerSecond?: Throughput | null;
  /** Time to first token over streamed serving attempts; null when
   * nothing in the group streamed. */
  ttftMs?: Percentiles | null;
  /** Tokens over the time AFTER the first streamed event — prefill
   * excluded. Its samples can be fewer than tokensPerSecond's. */
  decodeTokensPerSecond?: Throughput | null;
  waitedMs?: Percentiles | null;
  routingMs?: Percentiles | null;
  overheadMs?: Percentiles | null;
  tierCounts?: Record<string, number>;
}

interface MetricsSummary {
  windowStart: string;
  windowEnd: string;
  gatewayStartedAt: string;
  rowsDropped: number;
  truncated?: boolean;
  groups: MetricsGroup[];
}

interface MetricAttempt {
  retryDisposition?: "safe" | "terminal" | "indeterminate" | null;
  usageKnown?: boolean;
  driver: string;
  runtime?: string | null;
  backend?: string | null;
  elapsedMs: number;
  served: boolean;
  error?: string | null;
  /** The driver's own measurement of its backend call. `elapsedMs`
   * minus this is what the control plane itself cost. Null when the
   * backend did not report one. */
  backendMs?: number | null;
  /** Time to this attempt's first streamed event. Null for
   * non-streamed attempts — the response arrived whole. */
  firstMs?: number | null;
}

/** One backend the balancer considered. The inputs to the decision, not
 * a score - there is no score, least-busy is a sort. */
interface MetricCandidate {
  driver: string;
  tier: number;
  eligible: boolean;
  reason?: string | null;
  inFlight?: number | null;
  slots?: number | null;
}

interface MetricRequest {
  requestId?: string | null;
  elapsedMs?: number | null;
  clientKeyId?: string | null;
  clientKeyName?: string | null;
  startedAt: string;
  requestedModel: string;
  servedModel?: string | null;
  attempts: number;
  tier?: number;
  totalMs: number;
  waitedMs?: number;
  swappedIn?: boolean;
  streamed?: boolean;
  promptTokens?: number | null;
  completionTokens?: number | null;
  outcome: "served" | "error";
  tries: MetricAttempt[];
  routingMs?: number | null;
  refreshed?: boolean;
  strategy?: string | null;
  candidates?: MetricCandidate[];
}

const WINDOWS: { label: string; hours: number }[] = [
  { label: "Last hour", hours: 1 },
  { label: "Last 24 hours", hours: 24 },
  { label: "Last 7 days", hours: 24 * 7 },
];

const POLL_MS = 15_000;

/** Milliseconds as something readable at a glance across four orders of
 * magnitude — a wake is seconds, a cached answer is milliseconds. */
function ms(value: number): string {
  if (value < 1000) return `${value} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)} s`;
  return `${Math.round(value / 60_000)} min`;
}

function groupKey(g: MetricsGroup): string {
  return [g.bucketStart, g.model, g.driver, g.runtime, g.node].join("|");
}

/** The series colors. Marks wear these; text never does. The p90
 * companion is the SAME hue washed toward the background — a lightness
 * step, not a second identity — and errors live in their own chart, in
 * the status color, because editorial's status-red against its green
 * accent fails red-green colorblind separation inside one chart
 * (measured), and position separates what hue cannot. */
const SERIES = "var(--accent-left)";
const SERIES_SOFT = "color-mix(in oklab, var(--accent-left) 45%, var(--background))";
const SERIES_ERROR = "var(--status-error-fg)";

export default function MetricsPage() {
  const [hours, setHours] = useState(24);
  const [model, setModel] = useState<string>("");
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [totals, setTotals] = useState<MetricsSummary | null>(null);
  const [hourly, setHourly] = useState<MetricsSummary | null>(null);
  const [clientUsage, setClientUsage] = useState<ClientUsageSummary | null>(null);
  const [recent, setRecent] = useState<MetricRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const since = encodeURIComponent(new Date(Date.now() - hours * 3600_000).toISOString());
      const scoped = model ? `&model=${encodeURIComponent(model)}` : "";
      const modelOnly = model ? `model=${encodeURIComponent(model)}&` : "";
      // `since` stays the LAST query parameter on the /v1/metrics reads:
      // the window test parses it off the URL tail.
      const [s, t, h, r, c] = await Promise.all([
        api.get<MetricsSummary>("gateway", `/v1/metrics?${modelOnly}since=${since}`),
        api.get<MetricsSummary>("gateway", `/v1/metrics?groupBy=total${scoped}&since=${since}`),
        api.get<MetricsSummary>(
          "gateway",
          `/v1/metrics?groupBy=total&bucket=hour${scoped}&since=${since}`,
        ),
        api.get<{ requests: MetricRequest[] }>(
          "gateway",
          `/v1/metrics/requests?${modelOnly}limit=25`,
        ),
        api.get<ClientUsageSummary>("gateway", `/v1/metrics/clients?since=${since}`),
      ]);
      setSummary(s);
      setTotals(t);
      setHourly(h);
      setClientUsage(c);
      setRecent(r.requests ?? []);
      setDisabled(false);
    } catch (e) {
      // 503 is the gateway saying metrics are switched off, which is a
      // different thing from an error and gets a different screen: one
      // has a fix on the Config page, the other does not.
      if (e instanceof ApiError && e.status === 503) {
        setDisabled(true);
      } else {
        // The gateway's own sentence when it wrote one. `e.message` is
        // the status line ("HTTP 500 …"), which says a read failed and
        // not why.
        setError(describeError(e));
      }
    } finally {
      setLoading(false);
    }
  }, [hours, model]);

  // Poll rather than refresh-only, and keep the previous render while a
  // refetch is in flight — no skeleton, no layout jump.
  usePolling(load, POLL_MS);

  const tiles = useMemo(() => (totals ? tilesFrom(totals.groups) : null), [totals]);
  const points = useMemo(
    () => (hourly ? hourlyPoints(hourly.groups, hourly.windowStart, hourly.windowEnd) : []),
    [hourly],
  );
  const models = useMemo(() => {
    const names = new Set<string>();
    for (const g of summary?.groups ?? []) if (g.model) names.add(g.model);
    if (model) names.add(model);
    return [...names].sort();
  }, [summary, model]);
  const anyStreamed = points.some((p) => p.ttftP50 !== null);
  const anyDecode = points.some((p) => p.decodeP50 !== null);

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
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            aria-label="Model"
            className="font-ui max-w-48 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-1 text-sm"
          >
            <option value="">All models</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void load()}
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
          >
            Refresh
          </button>
        </>
      }
    >
      {/* The shell is h-dvh with overflow hidden, so the page owns its
          scroll. Without this the dashboard renders below the fold with
          no way to reach it — found by Troy on the live install, whose
          copy/paste grabbed rows no scrollbar could. */}
      <main data-testid="metrics-scroll" className="relative z-10 min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <p className="mb-6 text-sm text-[color:var(--muted)]">
            What each backend did on <em>this</em> machine. Useful for comparing your own backends
            against each other; not a benchmark of the hardware.
          </p>

          {loading && <p className="font-ui text-sm text-[color:var(--muted)]">Loading…</p>}

          {disabled && (
            <section className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-4">
              <h2 className="font-ui mb-2 text-base font-semibold">Not recording</h2>
              <p className="text-sm leading-relaxed text-[color:var(--muted)]">
                This gateway is not retaining request metrics. Turn on{" "}
                <span className="font-mono">Retain request metrics</span> on the{" "}
                <Link href="/config?sel=gateway" className="underline">
                  Config page
                </Link>{" "}
                and restart the gateway. Recording starts from then on — nothing reconstructs
                traffic served while it was off.
              </p>
            </section>
          )}

          {error && (
            <p className="text-status-error font-ui text-sm" role="alert">
              {error}
            </p>
          )}

          {summary && !disabled && (
            <>
              {summary.rowsDropped > 0 && (
                <p
                  className="font-ui mb-4 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm"
                  role="status"
                >
                  {summary.rowsDropped.toLocaleString()} measurement
                  {summary.rowsDropped === 1 ? "" : "s"} were dropped because the recorder could not
                  keep up, so these numbers are a sample rather than a complete record. Inference
                  was not affected.
                </p>
              )}
              {summary.truncated && (
                <p className="font-ui mb-4 text-sm text-[color:var(--muted)]">
                  Part of this window is older than the retention setting, so it is not included.
                </p>
              )}

              {tiles && tiles.requests > 0 && (
                <section
                  aria-label="Window at a glance"
                  className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
                >
                  <StatTile label="Requests" value={compact(tiles.requests)} />
                  <StatTile
                    label="Failed"
                    value={compact(tiles.errors)}
                    sub={
                      tiles.requests > 0
                        ? `${((tiles.errors / tiles.requests) * 100).toFixed(1)}% of requests`
                        : undefined
                    }
                    tone="error"
                  />
                  <StatTile
                    label="Failed over"
                    value={compact(tiles.cascaded)}
                    sub="tried more than one backend"
                  />
                  <StatTile
                    label="Median latency"
                    value={tiles.latencyP50 !== null ? ms(tiles.latencyP50) : null}
                    sub="whole request"
                  />
                  <StatTile
                    label="First token"
                    value={tiles.ttftP50 !== null ? ms(tiles.ttftP50) : null}
                    sub="median, streamed requests"
                  />
                  <StatTile
                    label="Decode speed"
                    value={tiles.decodeP50 !== null ? `${tiles.decodeP50.toFixed(1)} tok/s` : null}
                    sub={
                      tiles.decodeP50 !== null
                        ? `median over ${tiles.decodeSamples} streamed request${
                            tiles.decodeSamples === 1 ? "" : "s"
                          }`
                        : "needs streamed requests with token counts"
                    }
                  />
                </section>
              )}

              {points.length > 1 && tiles && tiles.requests > 0 && (
                <section aria-label="History" className="mb-8 grid gap-x-8 gap-y-6 lg:grid-cols-2">
                  <HourChart
                    title="Requests"
                    points={points}
                    kind="bars"
                    format={(v) => compact(Math.round(v))}
                    series={[{ name: "Requests", value: (p) => p.requests, color: SERIES }]}
                  />
                  <HourChart
                    title="Failed"
                    caption="requests no backend served"
                    points={points}
                    kind="bars"
                    format={(v) => compact(Math.round(v))}
                    series={[{ name: "Failed", value: (p) => p.errors, color: SERIES_ERROR }]}
                  />
                  <HourChart
                    title="Latency"
                    caption="whole request, per hour"
                    points={points}
                    kind="lines"
                    format={(v) => msLabel(v)}
                    series={[
                      { name: "p50", value: (p) => p.latencyP50, color: SERIES },
                      { name: "p90", value: (p) => p.latencyP90, color: SERIES_SOFT },
                    ]}
                  />
                  {anyDecode ? (
                    <HourChart
                      title="Decode speed"
                      caption="tokens per second after the first token"
                      points={points}
                      kind="lines"
                      format={(v) => `${v.toFixed(1)} tok/s`}
                      axisFormat={(v) => `${Math.round(v)}`}
                      series={[{ name: "tok/s (p50)", value: (p) => p.decodeP50, color: SERIES }]}
                    />
                  ) : anyStreamed ? (
                    <HourChart
                      title="First token"
                      caption="median, streamed requests"
                      points={points}
                      kind="lines"
                      format={(v) => msLabel(v)}
                      series={[{ name: "TTFT (p50)", value: (p) => p.ttftP50, color: SERIES }]}
                    />
                  ) : null}
                  {anyDecode && anyStreamed && (
                    <HourChart
                      title="First token"
                      caption="median, streamed requests"
                      points={points}
                      kind="lines"
                      format={(v) => msLabel(v)}
                      series={[{ name: "TTFT (p50)", value: (p) => p.ttftP50, color: SERIES }]}
                    />
                  )}
                </section>
              )}

              {summary.groups.length === 0 ? (
                <p className="font-ui text-sm text-[color:var(--muted)]">
                  Nothing was served in this window. Send a message from the{" "}
                  <Link href="/playground" className="underline">
                    playground
                  </Link>{" "}
                  and come back.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-[color:var(--border)] text-left">
                        <th className="py-2 pr-3 font-medium">Model</th>
                        <th className="py-2 pr-3 font-medium">Backend</th>
                        <th className="py-2 pr-3 text-right font-medium">Requests</th>
                        <th className="py-2 pr-3 text-right font-medium">Median</th>
                        <th className="py-2 pr-3 text-right font-medium">Slowest</th>
                        <th
                          className="py-2 pr-3 text-right font-medium"
                          title="Time to the first streamed token, median. Includes the hop to the driver, so on a local engine it is mostly prompt processing."
                        >
                          First token
                        </th>
                        <th
                          className="py-2 pr-3 text-right font-medium"
                          title="Tokens per second AFTER the first token — prefill excluded. The number people mean by tok/s."
                        >
                          Decode
                        </th>
                        <th
                          className="py-2 pr-3 text-right font-medium"
                          title="Tokens per second over the whole serving attempt, prefill included. Lower than Decode on long prompts — the gap is the prefill cost."
                        >
                          Tokens/sec
                        </th>
                        <th
                          className="py-2 pr-3 text-right font-medium"
                          title="Time spent deciding where to send the request: resolving the model, picking a backend, and any routing-table refresh."
                        >
                          Routing
                        </th>
                        <th
                          className="py-2 pr-3 text-right font-medium"
                          title="What Eugene Plexus itself cost: the local hop to the driver plus the driver's own work. Measured rather than assumed."
                        >
                          Overhead
                        </th>
                        <th className="py-2 pr-3 text-right font-medium">Failed</th>
                        <th className="py-2 pr-3 text-right font-medium">Failed over</th>
                        <th className="py-2 text-right font-medium">Woken</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.groups.map((g) => (
                        <tr
                          key={groupKey(g)}
                          className="border-b border-[color:var(--border)] align-top"
                        >
                          <td className="py-2 pr-3 font-mono break-all">{g.model ?? "—"}</td>
                          <td className="py-2 pr-3">
                            <span className="font-mono">{g.driver ?? "—"}</span>
                            {/* By runtime NAME, so two replicas of one model stay
                          distinguishable — the case balancing exists for.
                          Absent for hosted and CLI backends, which have no
                          runtime of ours. */}
                            {g.runtime && (
                              <span className="text-[color:var(--muted)]"> · {g.runtime}</span>
                            )}
                            {g.node && (
                              <span className="text-[color:var(--muted)]"> @ {g.node}</span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono">{g.requests}</td>
                          <td className="py-2 pr-3 text-right font-mono">{ms(g.latencyMs.p50)}</td>
                          <td className="py-2 pr-3 text-right font-mono">{ms(g.latencyMs.max)}</td>
                          <td className="py-2 pr-3 text-right font-mono">
                            {g.ttftMs ? (
                              ms(g.ttftMs.p50)
                            ) : (
                              <span
                                className="text-[color:var(--muted)]"
                                title="Nothing in this group streamed, so there was no first token to time."
                              >
                                &mdash;
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono">
                            {g.decodeTokensPerSecond ? (
                              <>
                                {g.decodeTokensPerSecond.p50.toFixed(1)}
                                <span
                                  className="text-[color:var(--muted)]"
                                  title={`Median over ${g.decodeTokensPerSecond.samples} streamed request(s) with token counts`}
                                >
                                  {" "}
                                  ({g.decodeTokensPerSecond.samples})
                                </span>
                              </>
                            ) : (
                              <span
                                className="text-[color:var(--muted)]"
                                title="Needs streamed requests that reported token counts and decoded for at least 250 ms. Not the same as zero."
                              >
                                &mdash;
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono">
                            {g.tokensPerSecond ? (
                              <>
                                {g.tokensPerSecond.p50.toFixed(1)}
                                <span
                                  className="text-[color:var(--muted)]"
                                  title={`Median over ${g.tokensPerSecond.samples} request(s) that reported token counts`}
                                >
                                  {" "}
                                  ({g.tokensPerSecond.samples})
                                </span>
                              </>
                            ) : (
                              <span
                                className="text-[color:var(--muted)]"
                                title="This backend did not report token counts for these requests, so the rate cannot be computed. Not the same as zero."
                              >
                                unreported
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono">
                            {g.routingMs ? (
                              ms(g.routingMs.p50)
                            ) : (
                              <span className="text-[color:var(--muted)]">&mdash;</span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono">
                            {g.overheadMs ? (
                              ms(g.overheadMs.p50)
                            ) : (
                              <span
                                className="text-[color:var(--muted)]"
                                title="This backend does not report how long its own call took, so the split cannot be computed. Not the same as no overhead."
                              >
                                unreported
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono">
                            {g.errors > 0 ? (
                              <span className="text-status-error">{g.errors}</span>
                            ) : (
                              <span className="text-[color:var(--muted)]">0</span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono">
                            {g.cascaded > 0 ? (
                              g.cascaded
                            ) : (
                              <span className="text-[color:var(--muted)]">0</span>
                            )}
                          </td>
                          <td className="py-2 text-right font-mono">
                            {g.swappedIn > 0 ? (
                              <>
                                {g.swappedIn}
                                {g.waitedMs && (
                                  <span className="text-[color:var(--muted)]">
                                    {" "}
                                    ({ms(g.waitedMs.p50)})
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-[color:var(--muted)]">0</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="mt-3 text-[0.6875rem] text-[color:var(--muted)]">
                <strong>Decode</strong> is tokens per second after the first token — the number
                people mean when they compare speeds — and <strong>Tokens/sec</strong> is the whole
                serving attempt, prefill included. Both are measured from the backend that actually
                answered, not from the whole request, so a failover does not make the backend that
                rescued it look slow. The number in brackets is how many requests the median is
                over.
              </p>
              <p className="mt-1 text-[0.6875rem] text-[color:var(--muted)]">
                <strong>First token</strong> includes the hop to the driver, so on a local engine it
                is mostly prompt processing — but it is not a pure prefill measurement, and no
                prompt-tokens-per-second is derived from it on purpose. The{" "}
                <Link href="/library" className="underline">
                  benchmark
                </Link>{" "}
                is the instrument for real curves.
              </p>
              <p className="mt-1 text-[0.6875rem] text-[color:var(--muted)]">
                <strong>Overhead</strong> is what Eugene Plexus itself costs: the gap between how
                long the backend said it took and how long the gateway saw it take. Compare it
                against the median to decide whether routing is worth worrying about — on a local
                install it usually is not, and this is where you can check that rather than take our
                word for it.
              </p>

              {clientUsage && (
                <section className="mt-8 overflow-x-auto" aria-label="Usage by client key">
                  <h2 className="font-ui mb-2 text-base font-semibold">Usage by client key</h2>
                  <p className="mb-2 text-sm text-[color:var(--muted)]">
                    This gateway, within the selected window and retained request history — all
                    models, whatever the filter above says. Tokens are reported usage only; failed
                    attempts may consume unreported tokens. Requests with incomplete usage are
                    counted below. This is not a billing total.
                  </p>
                  {clientUsage.truncated && (
                    <p role="status" className="status-warn text-sm">
                      Older per-key history has expired; these totals cover retained requests only.
                    </p>
                  )}
                  {clientUsage.rowsDropped > 0 && (
                    <p role="status" className="status-warn text-sm">
                      Some measurements were dropped. Per-key totals are incomplete.
                    </p>
                  )}
                  {clientUsage.clients?.length ? (
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr>
                          {[
                            "Key",
                            "Requests",
                            "Served",
                            "Failed",
                            "Attempts",
                            "Prompt tokens",
                            "Completion tokens",
                            "Incomplete usage",
                          ].map((heading) => (
                            <th className="p-2" key={heading}>
                              {heading}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {clientUsage.clients.map((c) => (
                          <tr key={c.clientKeyId} className="border-t border-[color:var(--border)]">
                            <td className="p-2">
                              {c.clientKeyName}
                              <code className="block text-[0.625rem] text-[color:var(--muted)]">
                                {c.clientKeyId}
                              </code>
                            </td>
                            {[
                              c.requests,
                              c.served,
                              c.failed,
                              c.attempts,
                              c.promptTokens,
                              c.completionTokens,
                              c.incompleteUsageRequests,
                            ].map((n, i) => (
                              <td key={i} className="p-2">
                                {n.toLocaleString()}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-sm text-[color:var(--muted)]">
                      No retained client-key requests in this window. Operator requests and older
                      unattributed history are excluded.
                    </p>
                  )}
                </section>
              )}

              {recent && recent.length > 0 && (
                <section className="mt-8">
                  <h2 className="font-ui mb-2 text-base font-semibold">Recent requests</h2>
                  <p className="mb-3 text-sm text-[color:var(--muted)]">
                    The rows behind the numbers above, newest first. A request that tried more than
                    one backend shows each attempt in the order it was tried, and one where there
                    was a choice to make shows what the balancer saw when it made it — which is the
                    answer to &ldquo;why did this go there and not to the other one&rdquo;.
                  </p>
                  <ul className="space-y-1">
                    {recent.map((r, i) => (
                      <li
                        key={`${r.startedAt}-${i}`}
                        className="rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2 font-mono text-[0.6875rem]"
                      >
                        <span className="text-[color:var(--muted)]">
                          <span title={new Date(r.startedAt).toLocaleString()}>
                            {formatTimestamp(r.startedAt)}
                          </span>
                        </span>{" "}
                        <span className={r.outcome === "error" ? "text-status-error" : ""}>
                          {r.outcome}
                        </span>{" "}
                        {r.clientKeyId && (
                          <span title={r.clientKeyId} className="mr-2">
                            {r.clientKeyName ?? r.clientKeyId}
                          </span>
                        )}
                        <span className="break-all">{r.requestedModel}</span>{" "}
                        <span className="text-[color:var(--muted)]">
                          {ms(r.elapsedMs ?? r.totalMs)}
                          {r.completionTokens != null && ` · ${r.completionTokens} tok`}
                          {r.streamed && " · streamed"}
                          {r.swappedIn && ` · woken after ${ms(r.waitedMs ?? 0)}`}
                          {r.tier != null && r.tier > 1 && ` · tier ${r.tier}`}
                          {/* A refresh is the surprising cost: HTTP to the agent
                          and to every driver, inside this request. Called out
                          rather than left to be inferred from the number. */}
                          {r.routingMs != null &&
                            ` · ${ms(r.routingMs)} routing${r.refreshed ? " (refreshed)" : ""}`}
                        </span>
                        {/* The id is what a log search or a bug report
                            needs, and it is too long to retype. */}
                        {r.requestId && (
                          <div className="flex items-center gap-1 break-all text-[color:var(--muted)]">
                            <span>Request {r.requestId}</span>
                            <CopyButton
                              text={r.requestId}
                              label="Copy request ID"
                              title="Copy request ID"
                              iconOnly
                              className="shrink-0"
                            />
                          </div>
                        )}
                        {r.tries.length > 0 && (
                          <div className="mt-1 pl-4 text-[color:var(--muted)]">
                            {r.tries.map((t, j) => (
                              <div key={j}>
                                {t.served ? "✓" : "✗"} {t.driver} {ms(t.elapsedMs)}
                                {t.firstMs != null && ` · first token ${ms(t.firstMs)}`}
                                {t.backendMs != null &&
                                  ` (${ms(t.backendMs)} backend, ${ms(
                                    Math.max(0, t.elapsedMs - t.backendMs),
                                  )} us)`}
                                {t.error && ` — ${t.error}`}
                                {t.retryDisposition &&
                                  ` · ${
                                    t.retryDisposition === "indeterminate"
                                      ? "outcome unknown; not replayed"
                                      : t.retryDisposition === "safe"
                                        ? "safe to retry before output"
                                        : "request refused"
                                  }`}
                                {t.usageKnown !== true && " · usage unknown (not zero cost)"}
                              </div>
                            ))}
                          </div>
                        )}
                        {r.candidates && r.candidates.length > 0 && (
                          <div className="mt-1 pl-4 text-[color:var(--muted)]">
                            considered{r.strategy ? ` (${r.strategy})` : ""}:{" "}
                            {r.candidates.map((c, j) => (
                              <span key={j}>
                                {j > 0 && ", "}
                                <span className={c.eligible ? "" : "opacity-60"}>
                                  {c.driver}
                                  {c.tier > 1 && ` t${c.tier}`}
                                  {c.eligible
                                    ? c.inFlight != null && ` ${c.inFlight}/${c.slots ?? 1}`
                                    : ` — ${c.reason ?? "not eligible"}`}
                                </span>
                              </span>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <p className="mt-8 text-[0.6875rem] text-[color:var(--muted)]">
                Recorded on this machine, in a file beside the gateway&rsquo;s config. Never sent
                anywhere, and not part of the install&rsquo;s replicated log — a standby control
                root promoted later starts with no history, because the history described a
                different process.
              </p>
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}
