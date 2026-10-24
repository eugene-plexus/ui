"use client";

import { useCallback, useState } from "react";
import { api, describeError } from "@/lib/api";
import {
  measurementTarget,
  revokeFinishedKey,
  type ServingMeasurement,
  type ServingMeasurementList,
  type ServingMeasurementPreflight,
  type ServingMeasurementRequest,
  type ServingWorkload,
} from "@/lib/servingMeasurements";
import { servingSentence } from "@/lib/servingSentence";
import { formatDuration } from "@/lib/tasks";
import { usePolling } from "@/lib/usePolling";

export function ServingMeasurements({
  runtime,
  node,
  slots,
  openId,
}: {
  runtime: string;
  node: string | null;
  slots: number;
  openId?: string | null;
}) {
  const target = measurementTarget(node);
  const [jobs, setJobs] = useState<ServingMeasurement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [workload, setWorkload] = useState<ServingWorkload>("agents");
  const [people, setPeople] = useState(Math.min(256, slots * 4));
  const [seconds, setSeconds] = useState(300);
  const [full, setFull] = useState(false);
  const [seed, setSeed] = useState(0);
  const [ttft, setTtft] = useState(1000);
  const [ratio, setRatio] = useState(2 / 3);
  const [check, setCheck] = useState<ServingMeasurementPreflight | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const result = await api.get<ServingMeasurementList>(target, "/v1/serving-measurements");
      setJobs(await Promise.all(result.measurements.map((j) => revokeFinishedKey(j, target))));
    } catch (e) {
      setError(describeError(e));
    }
  }, [target]);
  usePolling(load, 3000);
  const own = jobs.filter((j) => j.runtime === runtime);
  const expanded = opened || own.some((j) => j.id === openId);
  const latest = own.find((j) => j.state === "completed");
  const active = own.find((j) => j.state === "running");
  const request: ServingMeasurementRequest = {
    runtime,
    workload,
    maxPeople: people,
    windowSeconds: full ? 3600 : seconds,
    full,
    seed,
    ttftThresholdMs: ttft,
    speedRatioThreshold: ratio,
    stopReplicas: consent ? (check?.otherReplicas ?? []) : [],
  };
  const invalidate = () => {
    setCheck(null);
    setConsent(false);
  };
  async function review() {
    setBusy(true);
    setError(null);
    try {
      setCheck(
        await api.post<ServingMeasurementPreflight>(
          target,
          "/v1/serving-measurements/preflight",
          request,
        ),
      );
      setConsent(false);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    setBusy(true);
    setError(null);
    try {
      await api.post<ServingMeasurement>(target, "/v1/serving-measurements", request);
      setCheck(null);
      await load();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }
  async function cancel(job: ServingMeasurement) {
    setBusy(true);
    setError(null);
    try {
      await api.post(target, `/v1/serving-measurements/${encodeURIComponent(job.id)}/cancel`, {});
      await load();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }
  const comparison = latest
    ? jobs.find(
        (j) =>
          j.state === "completed" &&
          j.node === latest.node &&
          j.model === latest.model &&
          j.drafting.type !== latest.drafting.type &&
          (j.drafting.type === "off" || latest.drafting.type === "off"),
      )
    : null;
  return (
    <div className="mt-3 space-y-2 text-sm">
      {latest && (
        <p>
          {latest.current ? (
            <>
              {servingSentence(latest.knee, latest.request.workload)} Measured{" "}
              {new Date(latest.finishedAt ?? latest.startedAt).toLocaleDateString()}.
            </>
          ) : (
            <>Measured before a change: {latest.staleBecause.join(" ")} Measure again.</>
          )}
        </p>
      )}
      <button type="button" onClick={() => setOpened(!opened)} className="underline">
        Measure people served
      </button>
      {error && <p role="alert">{error}</p>}
      {active && (
        <p>
          {active.detail}{" "}
          <button type="button" disabled={busy} onClick={() => void cancel(active)}>
            Cancel measurement
          </button>
        </p>
      )}
      {expanded && (
        <section aria-label={`Measure ${runtime}`} className="space-y-3 rounded border p-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void review();
            }}
            onChange={invalidate}
            className="flex flex-wrap gap-3"
          >
            <label>
              Workload
              <select
                aria-label="Workload"
                value={workload}
                onChange={(e) => {
                  const value = e.target.value as ServingWorkload;
                  setWorkload(value);
                  setSeconds(value === "streams" ? 120 : 300);
                }}
              >
                <option value="agents">Agent sessions</option>
                <option value="chat">Chat sessions</option>
                <option value="streams">Continuous streams</option>
              </select>
            </label>
            <label>
              Up to people
              <input
                aria-label="Up to people"
                type="number"
                min={1}
                max={256}
                required
                value={people}
                onChange={(e) => setPeople(Number(e.target.value))}
              />
            </label>
            <label>
              Seconds per level
              <input
                aria-label="Seconds per level"
                type="number"
                min={10}
                max={3600}
                required
                disabled={full}
                value={full ? 3600 : seconds}
                onChange={(e) => setSeconds(Number(e.target.value))}
              />
            </label>
            <label>
              <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />
              Full hour per level
            </label>
            <details>
              <summary>Expert settings</summary>
              <label>
                First token ceiling (ms)
                <input
                  aria-label="First token ceiling (ms)"
                  type="number"
                  min={Number.MIN_VALUE}
                  step="any"
                  required
                  value={ttft}
                  onChange={(e) => setTtft(Number(e.target.value))}
                />
              </label>
              <label>
                Minimum speed fraction
                <input
                  aria-label="Minimum speed fraction"
                  type="number"
                  min={Number.MIN_VALUE}
                  max={1}
                  step="any"
                  required
                  value={ratio}
                  onChange={(e) => setRatio(Number(e.target.value))}
                />
              </label>
              <label>
                Seed
                <input
                  aria-label="Seed"
                  type="number"
                  step={1}
                  required
                  value={seed}
                  onChange={(e) => setSeed(Number(e.target.value))}
                />
              </label>
            </details>
            <button disabled={busy || !!active} type="submit">
              Review measurement
            </button>
          </form>
          {check && (
            <div className="space-y-2">
              <p>
                The GPU is busy for about{" "}
                {check.estimateSeconds == null
                  ? "an unknown time"
                  : formatDuration(check.estimateSeconds)}
                . People using this model get slower answers meanwhile. Requests still running at
                each level’s end add time.
              </p>
              {check.otherRuntimes.length > 0 && (
                <p>
                  Other models sharing this machine:{" "}
                  {check.otherRuntimes.map((r) => `${r.model} (${r.runtime})`).join(", ")}.
                </p>
              )}
              {check.otherReplicas.length > 0 && (
                <label>
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  Stop these other copies, then start them again when measurement ends:{" "}
                  {check.otherReplicas.map((r) => `${r.runtime} on ${r.node}`).join(", ")}
                </label>
              )}
              {check.problems.map((p) => (
                <p key={p} role="alert">
                  {p}
                </p>
              ))}
              <button
                type="button"
                disabled={
                  busy ||
                  !!active ||
                  check.problems.length > 0 ||
                  (check.otherReplicas.length > 0 && !consent)
                }
                onClick={() => void start()}
              >
                Start measurement
              </button>
            </div>
          )}
          {comparison && latest && (
            <div className="grid grid-cols-2 gap-3" aria-label="Drafting comparison">
              {[latest, comparison].map((j) => (
                <div key={j.id}>
                  <p>Drafting: {j.drafting.type ?? "unknown"}</p>
                  <p>{j.drafting.model}</p>
                  <p>
                    Accepted:{" "}
                    {j.drafting.acceptance == null
                      ? "unknown"
                      : `${Math.round(j.drafting.acceptance * 100)}%`}
                  </p>
                  <p>{servingSentence(j.knee, j.request.workload)}</p>
                  {!j.current && <p>{j.staleBecause.join(" ")}</p>}
                </div>
              ))}
            </div>
          )}
          {own.slice(0, 20).map((job) => (
            <details key={job.id} open={job.state === "running" || undefined}>
              <summary>
                {job.state}: {job.detail}
              </summary>
              <p>{servingSentence(job.knee, job.request.workload)}</p>
              <p>
                {job.request.workload}, up to {job.request.maxPeople} people,{" "}
                {job.request.windowSeconds} s per level, first token ceiling{" "}
                {job.request.ttftThresholdMs} ms, speed fraction {job.request.speedRatioThreshold},
                seed {job.request.seed}.
              </p>
              {job.keyLive && (
                <p>
                  Measurement key is still live.{" "}
                  <button disabled={busy} onClick={() => void cancel(job)}>
                    Revoke measurement key
                  </button>
                </p>
              )}
              {job.restarts.map((r) => (
                <p key={`${r.node}/${r.runtime}`}>
                  {r.runtime} on {r.node}: {r.state}. {r.detail}
                </p>
              ))}
              <Curve job={job} />
              <table>
                <caption>Measured levels. The capacity limit is marked.</caption>
                <thead>
                  <tr>
                    <th>People</th>
                    <th>tok/s each</th>
                    <th>First token</th>
                    <th>Requests / errors</th>
                    <th>Prompt reuse</th>
                    <th>Others’ use</th>
                    <th>GPU watts</th>
                    <th>Loop delay</th>
                  </tr>
                </thead>
                <tbody>
                  {job.levels.map((l) => (
                    <tr key={l.people}>
                      <td>
                        {l.people}
                        {job.knee?.people === l.people
                          ? job.knee.found
                            ? " ← limit"
                            : " ← largest tested"
                          : ""}
                      </td>
                      <td>{l.tokensPerSecondEachP50?.toFixed(1) ?? "unknown"}</td>
                      <td>
                        {l.ttftP50Ms == null ? "unknown" : `${(l.ttftP50Ms / 1000).toFixed(2)} s`}
                      </td>
                      <td>
                        {l.requests} / {l.errors}
                        {Object.keys(l.errorCauses).length > 0 &&
                          `: ${Object.keys(l.errorCauses).join("; ")}`}
                      </td>
                      <td>
                        {l.promptReuse == null ? "unknown" : `${Math.round(l.promptReuse * 100)}%`}
                      </td>
                      <td>{l.foreignRequests ?? "unknown"}</td>
                      <td>{l.watts?.toFixed(0) ?? "unknown"}</td>
                      <td>
                        {l.loopLagMaxMs.toFixed(1)} ms
                        {l.loopLagged ? " — load generator delayed" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}

function Curve({ job }: { job: ServingMeasurement }) {
  const levels = job.levels.filter((l) => l.tokensPerSecondEachP50 != null);
  if (!levels.length) return null;
  const maximum = Math.max(1, ...levels.map((l) => l.tokensPerSecondEachP50 ?? 0));
  const x = (people: number) => 30 + (people / Math.max(...levels.map((l) => l.people))) * 300;
  const y = (speed: number) => 140 - (speed / maximum) * 110;
  return (
    <svg
      viewBox="0 0 360 175"
      role="img"
      aria-label="People served and tokens per second each"
      className="max-w-lg"
    >
      <path d="M30 20V140H340" fill="none" stroke="currentColor" />
      <polyline
        points={levels.map((l) => `${x(l.people)},${y(l.tokensPerSecondEachP50 ?? 0)}`).join(" ")}
        fill="none"
        stroke="currentColor"
      />
      {levels.map((l) => (
        <circle
          key={l.people}
          cx={x(l.people)}
          cy={y(l.tokensPerSecondEachP50 ?? 0)}
          r={job.knee?.people === l.people ? 6 : 3}
          fill="currentColor"
        >
          <title>
            {l.people} people: {l.tokensPerSecondEachP50?.toFixed(1)} tok/s each
          </title>
        </circle>
      ))}
      <text x="100" y="165" fill="currentColor">
        People →
      </text>
      <text x="32" y="15" fill="currentColor">
        tok/s each ↑
      </text>
    </svg>
  );
}
