"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";

import { api, describeError } from "@/lib/api";
import { composeSpec } from "@/lib/launchSpec";
import type { TargetNode } from "@/lib/nodeBudget";
import type { Benchmark, BenchmarkList, LibraryModel, ModelProfile } from "@/lib/types";

const button = "rounded border border-[color:var(--border)] px-2 py-1 text-xs disabled:opacity-40";

export function ProfileBenchmark({
  model,
  profile,
  node,
}: {
  model: LibraryModel;
  profile: ModelProfile;
  node: TargetNode | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button type="button" className={button} aria-expanded={open} onClick={() => setOpen(!open)}>
        Benchmark
      </button>
      {open && (
        <BenchmarkPanel
          key={`${node?.target}:${profile.id}`}
          model={model}
          profile={profile}
          node={node}
        />
      )}
    </div>
  );
}

export function BenchmarkPanel({
  model,
  profile,
  node,
}: {
  model: LibraryModel;
  profile: ModelProfile;
  node: TargetNode | null;
}) {
  const id = useId();
  const [jobs, setJobs] = useState<Benchmark[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tokens, setTokens] = useState(128);
  const [repetitions, setRepetitions] = useState(3);
  const [refresh, setRefresh] = useState(0);
  const target = node?.target;
  useEffect(() => {
    if (!target) return;
    let alive = true;
    let reading = false;
    const load = async () => {
      if (reading || document.hidden) return;
      reading = true;
      try {
        const list = await api.get<BenchmarkList>(target, "/v1/benchmarks");
        if (alive) {
          setJobs(list.benchmarks ?? []);
          setReadError(null);
        }
      } catch (e) {
        if (alive) setReadError(describeError(e));
      } finally {
        reading = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 2000);
    document.addEventListener("visibilitychange", load);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [target, refresh]);
  const active = jobs.some((j) => j.state === "running");
  const context = profile.flags?.contextSize;
  const valid =
    Number.isInteger(tokens) &&
    tokens >= 16 &&
    tokens <= 256 &&
    tokens < Number(context) &&
    Number.isInteger(repetitions) &&
    repetitions >= 1 &&
    repetitions <= 5;
  const supported =
    profile.engine === "llama_cpp" &&
    typeof context === "number" &&
    context >= 256 &&
    context <= 262144 &&
    (!profile.flags?.parallelSlots || profile.flags.parallelSlots === 1);
  const history = jobs.filter(
    (j) => j.request.modelId === model.id && j.request.profileId === profile.id,
  );

  async function start() {
    if (!target || !valid || !supported || busy) return;
    setBusy(true);
    setError(null);
    try {
      const job = await api.post<Benchmark>(target, "/v1/benchmarks", {
        modelId: model.id,
        profileId: profile.id,
        profileName: profile.name,
        runtime: composeSpec(model, profile),
        tokens,
        repetitions,
      });
      setJobs((previous) => [job, ...previous.filter((j) => j.id !== job.id)]);
      setRefresh((n) => n + 1);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }
  async function cancel(job: Benchmark) {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.post<Benchmark>(
        target,
        `/v1/benchmarks/${encodeURIComponent(job.id)}/cancel`,
        {},
      );
      setJobs((previous) => previous.map((j) => (j.id === updated.id ? updated : j)));
      setRefresh((n) => n + 1);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label={`Benchmark ${profile.name}`}
      className="mt-2 space-y-3 rounded border border-[color:var(--border)] p-3 text-xs"
    >
      <p>
        Measure decode speed as context fills on{" "}
        <strong>{node?.label ?? "the selected machine"}</strong> using this saved profile.
      </p>
      <p className="text-[color:var(--muted)]">
        Stop this machine’s models in{" "}
        <Link href="/inference" className="underline">
          Inference
        </Link>{" "}
        first and close other GPU workloads. Nothing is stopped automatically. Runs continue when
        you leave this page; cancel here. Maximum 15 minutes.
      </p>
      <p className="text-[color:var(--muted)]">
        One sequence, three context depths. This measures token evaluation, excluding tokenization,
        sampling and parallel serving. Fit estimates remain separate.
      </p>
      {!supported && (
        <p>
          Use a llama.cpp profile with one parallel slot and an explicit context size from 256 to
          262144 tokens.
        </p>
      )}
      <p className="text-[color:var(--muted)]">
        Unset settings use this llama-bench build’s defaults. Set GPU layers explicitly to compare
        offload settings; the server’s automatic placement is not reproduced by this instrument.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor={`${id}-tokens`}>
          Generated tokens per sample
          <input
            id={`${id}-tokens`}
            disabled={!target || busy}
            type="number"
            min={16}
            max={256}
            step={1}
            value={tokens}
            onChange={(e) => setTokens(Number(e.target.value))}
            className="ml-2 w-20 rounded border p-1"
          />
        </label>
        <label htmlFor={`${id}-repetitions`}>
          Repetitions
          <input
            id={`${id}-repetitions`}
            disabled={!target || busy}
            type="number"
            min={1}
            max={5}
            step={1}
            value={repetitions}
            onChange={(e) => setRepetitions(Number(e.target.value))}
            className="ml-2 w-14 rounded border p-1"
          />
        </label>
        <button
          type="button"
          className={button}
          disabled={!target || !supported || !valid || busy || active || !!readError}
          onClick={() => void start()}
        >
          Start benchmark
        </button>
      </div>
      {supported && tokens < Number(context) && (
        <p>
          Depths: 0, {Math.floor((Number(context) - tokens) / 2).toLocaleString()},{" "}
          {(Number(context) - tokens).toLocaleString()} tokens. The remaining context holds the
          generated tokens.
        </p>
      )}
      {active && (
        <p>
          A benchmark is running on this machine. New model starts are refused until it finishes or
          is cancelled.
        </p>
      )}
      {readError && <p role="alert">Could not read benchmarks on this machine: {readError}</p>}
      {error && <p role="alert">{error}</p>}
      {history.length === 0 && !readError && (
        <p className="text-[color:var(--muted)]">
          No recorded benchmarks for this profile on this machine.
        </p>
      )}
      {history.map((job) => (
        <article key={job.id} className="space-y-2 border-t border-[color:var(--border)] pt-3">
          <p>
            <strong>{job.state}</strong> · {job.node} · {new Date(job.startedAt).toLocaleString()}
          </p>
          <p role={job.state === "running" ? "status" : undefined}>{job.detail}</p>
          {job.state === "running" && (
            <div className="flex items-center gap-3">
              <progress aria-label="Benchmark progress" value={job.progress} max={1} />
              <span>{Math.round(job.progress * 100)}%</span>
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => void cancel(job)}
              >
                Cancel benchmark
              </button>
            </div>
          )}
          {job.points.length > 0 && <BenchmarkResults job={job} />}
          <details>
            <summary className="cursor-pointer">Recorded settings and samples</summary>
            <p className="mt-2">
              Snapshot of “{job.request.profileName}” at run time. Later profile edits do not change
              this result.
            </p>
            <p>
              llama.cpp {job.engineVersion ?? "version unknown"} · {job.request.tokens ?? 128}{" "}
              generated tokens · {job.request.repetitions ?? 3} repetitions
            </p>
            <p className="break-all">
              Model: {job.localPath} · {job.modelSizeBytes?.toLocaleString()} bytes · modified{" "}
              {job.modelModifiedAt ?? "unknown"}
            </p>
            <pre className="mt-2 overflow-x-auto text-[10px] break-all whitespace-pre-wrap">
              {JSON.stringify(
                {
                  flags: job.request.runtime.flags,
                  env: job.request.runtime.env,
                  hardware: job.hardware,
                  command: job.command,
                  samples: job.points.map((p) => ({ depth: p.depth, tokensPerSecond: p.samples })),
                },
                null,
                2,
              )}
            </pre>
          </details>
        </article>
      ))}
      <p className="text-[color:var(--muted)]">
        The machine keeps its latest 20 benchmark records across all profiles.
      </p>
    </section>
  );
}

export function BenchmarkResults({ job }: { job: Benchmark }) {
  const points = [...job.points].sort((a, b) => a.depth - b.depth);
  const baseline = points.find((p) => p.depth === 0)?.tokensPerSecond;
  const maxDepth = Math.max(1, ...job.depths);
  const maxSpeed = Math.max(1, ...points.map((p) => p.tokensPerSecond)) * 1.1;
  const x = (depth: number) => 50 + (depth / maxDepth) * 380;
  const y = (speed: number) => 170 - (speed / maxSpeed) * 140;
  return (
    <div>
      <svg
        fill="currentColor"
        viewBox="0 0 460 210"
        role="img"
        aria-label="Decode speed by context depth; exact values in the table below"
        className="w-full max-w-xl text-[color:var(--foreground)]"
      >
        <path d="M50 20 V170 H440" fill="none" stroke="currentColor" />
        <text x="8" y="14" fontSize="11">
          tokens/s
        </text>
        <text x="180" y="205" fontSize="11">
          Context depth (tokens)
        </text>
        <text x="5" y="35" fontSize="10">
          {maxSpeed.toFixed(0)}
        </text>
        <text x="32" y="174" fontSize="10">
          0
        </text>
        <polyline
          points={points.map((p) => `${x(p.depth)},${y(p.tokensPerSecond)}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        {points.map((p) => (
          <g key={p.depth}>
            <circle cx={x(p.depth)} cy={y(p.tokensPerSecond)} r="4" fill="currentColor" />
            <text x={x(p.depth)} y="188" textAnchor="middle" fontSize="10">
              {p.depth.toLocaleString()}
            </text>
          </g>
        ))}
      </svg>
      <div className="overflow-x-auto">
        <table className="w-full text-left tabular-nums">
          <caption className="text-left">
            {job.state === "completed" ? "Measured decode speed" : "Partial results"}
          </caption>
          <thead>
            <tr>
              {[
                "Context depth",
                "Mean tokens/s",
                "Std. deviation",
                "Samples",
                "Vs. empty context",
              ].map((h) => (
                <th key={h} scope="col" className="p-1">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.depth}>
                <th scope="row" className="p-1">
                  {p.depth.toLocaleString()}
                </th>
                <td className="p-1">{p.tokensPerSecond.toFixed(1)}</td>
                <td className="p-1">{p.standardDeviation.toFixed(1)}</td>
                <td className="p-1">{p.samples.length}</td>
                <td className="p-1">
                  {baseline ? `${Math.round((p.tokensPerSecond / baseline) * 100)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
