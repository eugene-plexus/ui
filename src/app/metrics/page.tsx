"use client";

/**
 * What each backend actually did.
 *
 * The five questions this page exists to answer, in the order they get
 * asked:
 *
 *   1. Which of my backends is faster for this model?
 *   2. Is anything failing?
 *   3. What is idle unload costing me?
 *   4. Is a later tier quietly serving everything?
 *   5. What did last night look like?
 *
 * Three restraints are deliberate and should survive edits.
 *
 * **"Unreported" is not "zero".** The CLI subscription backends report
 * no token counts, ever, so `tokensPerSecond` comes back null. Rendering
 * that as `0 tok/s` says "slow" where it means "unmeasured", and the
 * operator cannot recover the difference from the screen.
 *
 * **These numbers describe this box only.** Not a benchmark, and not a
 * ranking of hardware. Same line M3 locked for quant guidance: state
 * what happened here, never what is better in general.
 *
 * **A small sample says so.** Generation latency is long-tailed and a
 * first request against a cold backend can be twenty times a warm one,
 * so a median over two samples is nearly meaningless. The sample count
 * is shown next to every throughput figure rather than buried.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ApiError, api } from "@/lib/api";

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

export default function MetricsPage() {
  const [hours, setHours] = useState(24);
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [recent, setRecent] = useState<MetricRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const since = new Date(Date.now() - hours * 3600_000).toISOString();
      const [s, r] = await Promise.all([
        api.get<MetricsSummary>("gateway", `/v1/metrics?since=${encodeURIComponent(since)}`),
        api.get<{ requests: MetricRequest[] }>("gateway", "/v1/metrics/requests?limit=25"),
      ]);
      setSummary(s);
      setRecent(r.requests ?? []);
      setDisabled(false);
    } catch (e) {
      // 503 is the gateway saying metrics are switched off, which is a
      // different thing from an error and gets a different screen: one
      // has a fix on the Config page, the other does not.
      if (e instanceof ApiError && e.status === 503) {
        setDisabled(true);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="relative z-10 mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-ui text-xl font-semibold">Request metrics</h1>
          <p className="mt-1 text-xs text-[color:var(--muted)]">
            What each backend did on <em>this</em> machine. Useful for comparing your own backends
            against each other; not a benchmark of the hardware.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            aria-label="Time window"
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-1 text-xs"
          >
            {WINDOWS.map((w) => (
              <option key={w.hours} value={w.hours}>
                {w.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void load()}
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
          >
            Refresh
          </button>
          <Link
            href="/"
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
          >
            Back
          </Link>
        </div>
      </header>

      {loading && <p className="font-ui text-xs text-[color:var(--muted)]">Loading…</p>}

      {disabled && (
        <section className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-4">
          <h2 className="font-ui mb-2 text-sm font-semibold">Not recording</h2>
          <p className="text-xs leading-relaxed text-[color:var(--muted)]">
            This gateway is not retaining request metrics. Turn on{" "}
            <span className="font-mono">Retain request metrics</span> on the{" "}
            <Link href="/config" className="underline">
              Config page
            </Link>{" "}
            and restart the gateway. Recording starts from then on — nothing reconstructs traffic
            served while it was off.
          </p>
        </section>
      )}

      {error && (
        <p className="text-status-error font-ui text-xs" role="alert">
          {error}
        </p>
      )}

      {summary && !disabled && (
        <>
          {summary.rowsDropped > 0 && (
            <p
              className="font-ui mb-4 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-xs"
              role="status"
            >
              {summary.rowsDropped.toLocaleString()} measurement
              {summary.rowsDropped === 1 ? "" : "s"} were dropped because the recorder could not
              keep up, so these numbers are a sample rather than a complete record. Inference was
              not affected.
            </p>
          )}
          {summary.truncated && (
            <p className="font-ui mb-4 text-xs text-[color:var(--muted)]">
              Part of this window is older than the retention setting, so it is not included.
            </p>
          )}

          {summary.groups.length === 0 ? (
            <p className="font-ui text-xs text-[color:var(--muted)]">
              Nothing was served in this window. Send a message from the{" "}
              <Link href="/" className="underline">
                playground
              </Link>{" "}
              and come back.
            </p>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-[color:var(--border)] text-left">
                  <th className="py-2 pr-3 font-medium">Model</th>
                  <th className="py-2 pr-3 font-medium">Backend</th>
                  <th className="py-2 pr-3 text-right font-medium">Requests</th>
                  <th className="py-2 pr-3 text-right font-medium">Median</th>
                  <th className="py-2 pr-3 text-right font-medium">Slowest</th>
                  <th className="py-2 pr-3 text-right font-medium">Tokens/sec</th>
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
                  <tr key={groupKey(g)} className="border-b border-[color:var(--border)] align-top">
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
                      {g.node && <span className="text-[color:var(--muted)]"> @ {g.node}</span>}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">{g.requests}</td>
                    <td className="py-2 pr-3 text-right font-mono">{ms(g.latencyMs.p50)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{ms(g.latencyMs.max)}</td>
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
                          title="This backend does not report token counts — the CLI subscription backends never do. Not the same as zero."
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
          )}

          <p className="mt-3 text-[11px] text-[color:var(--muted)]">
            Tokens/sec is measured from the backend that actually answered, not from the whole
            request — so a failover does not make the backend that rescued it look slow. The number
            in brackets is how many requests the median is over.
          </p>
          <p className="mt-1 text-[11px] text-[color:var(--muted)]">
            <strong>Overhead</strong> is what Eugene Plexus itself costs: the gap between how long
            the backend said it took and how long the gateway saw it take. Compare it against the
            median to decide whether routing is worth worrying about — on a local install it usually
            is not, and this is where you can check that rather than take our word for it.
          </p>

          {recent && recent.length > 0 && (
            <section className="mt-8">
              <h2 className="font-ui mb-2 text-sm font-semibold">Recent requests</h2>
              <p className="mb-3 text-xs text-[color:var(--muted)]">
                The rows behind the numbers above, newest first. A request that tried more than one
                backend shows each attempt in the order it was tried, and one where there was a
                choice to make shows what the balancer saw when it made it — which is the answer to
                &ldquo;why did this go there and not to the other one&rdquo;.
              </p>
              <ul className="space-y-1">
                {recent.map((r, i) => (
                  <li
                    key={`${r.startedAt}-${i}`}
                    className="rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2 font-mono text-[11px]"
                  >
                    <span className="text-[color:var(--muted)]">
                      {new Date(r.startedAt).toLocaleTimeString()}
                    </span>{" "}
                    <span className={r.outcome === "error" ? "text-status-error" : ""}>
                      {r.outcome}
                    </span>{" "}
                    <span className="break-all">{r.requestedModel}</span>{" "}
                    <span className="text-[color:var(--muted)]">
                      {ms(r.totalMs)}
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
                    {r.tries.length > 1 && (
                      <div className="mt-1 pl-4 text-[color:var(--muted)]">
                        {r.tries.map((t, j) => (
                          <div key={j}>
                            {t.served ? "✓" : "✗"} {t.driver} {ms(t.elapsedMs)}
                            {t.backendMs != null &&
                              ` (${ms(t.backendMs)} backend, ${ms(
                                Math.max(0, t.elapsedMs - t.backendMs),
                              )} us)`}
                            {t.error && ` — ${t.error}`}
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

          <p className="mt-8 text-[11px] text-[color:var(--muted)]">
            Recorded on this machine, in a file beside the gateway&rsquo;s config. Never sent
            anywhere, and not part of the install&rsquo;s replicated log — a standby control root
            promoted later starts with no history, because the history described a different
            process.
          </p>
        </>
      )}
    </main>
  );
}
