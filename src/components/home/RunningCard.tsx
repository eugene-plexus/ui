"use client";

import Link from "next/link";

import type { Row } from "@/lib/inferenceRows";

/**
 * "Running": what is serving right now, in four columns.
 *
 * The rows are the Inference screen's join (`lib/inferenceRows.ts`) —
 * the gateway's drivers, the runtimes they follow, the node each runs
 * on — cut down to what a person checking in wants: which model, on
 * which machine, in what state, how busy. Everything else, and every
 * control, is one click away on Inference. Hidden when there is nothing
 * to show; the first-model card above says what to do about that.
 *
 * "Runtime" is this project's word and not the person's (P5); it appears
 * here only as a tooltip on the model, for the operator who wants the
 * name the API uses.
 */
export function RunningCard({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return null;
  return (
    <section
      data-testid="home-running"
      className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-ui text-base font-semibold">Running</h2>
        <Link href="/inference" className="font-ui text-xs underline">
          Inference
        </Link>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="font-ui text-[color:var(--muted)]">
            <tr>
              <th className="py-1.5 pr-4 font-medium">Model</th>
              <th className="py-1.5 pr-4 font-medium">Machine</th>
              <th className="py-1.5 pr-4 font-medium">State</th>
              <th className="py-1.5 pr-4 font-medium">Busy</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const state = stateOf(row);
              return (
                <tr key={row.key} className="border-t border-[color:var(--border)]">
                  <td
                    className="py-1.5 pr-4 font-mono"
                    title={row.runtime ? `Runtime ${row.runtime}` : undefined}
                  >
                    {row.model ?? row.driver ?? "—"}
                  </td>
                  <td className="py-1.5 pr-4">{row.node ?? "this machine"}</td>
                  <td className={`py-1.5 pr-4 ${state.className}`} title={row.error ?? undefined}>
                    {state.label}
                  </td>
                  <td className="py-1.5 pr-4 text-[color:var(--muted)] tabular-nums">
                    {row.inFlight === null
                      ? "—"
                      : row.inFlight === 0
                        ? "idle"
                        : `${row.inFlight} busy`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** One plain word per state, coloured like the Inference screen's. */
function stateOf(row: Row): { label: string; className: string } {
  if (row.runtime && row.runtimeStatus) {
    switch (row.runtimeStatus) {
      case "ready":
        return { label: "ready", className: "text-status-success" };
      case "loading":
        return { label: "loading", className: "text-status-warn" };
      case "starting":
        return { label: "starting", className: "text-status-warn" };
      case "exited":
        return { label: "restarting", className: "text-status-warn" };
      case "crashed":
        return { label: "crashed", className: "text-status-error" };
      case "stopped":
        return { label: "stopped", className: "text-[color:var(--muted)]" };
      default:
        return { label: row.runtimeStatus, className: "" };
    }
  }
  if (row.reachable === true) return { label: "ready", className: "text-status-success" };
  if (row.reachable === false) return { label: "unreachable", className: "text-status-error" };
  return { label: "unknown", className: "text-[color:var(--muted)]" };
}
