"use client";

/**
 * The dashboard's charts: hand-rolled SVG over theme tokens, no chart
 * library — the same call R6.1's benchmark curve made, for the same
 * reasons (the export pipeline carries no new dependency, and the
 * themes' accent tokens are the only palette that survives a theme
 * switch).
 *
 * Design rules these components enforce rather than hope for:
 *
 * - **One measure per chart, one axis.** Errors are not a second hue
 *   inside the requests bars — editorial's status-red against its green
 *   accent fails deuteranopia separation (measured, ΔE 5.2), so errors
 *   get their own panel. Position separates what hue cannot.
 * - **Marks wear the series color; text wears text tokens.** Labels,
 *   ticks and values are foreground/muted ink, never the accent.
 * - **A null breaks the line.** "Nothing measured this hour" renders as
 *   a gap, not an interpolated value no request ever had.
 * - **The tooltip enhances, the table gates nothing.** Every chart
 *   carries a disclosure with the same numbers as text — the value a
 *   pointer can reach is also reachable without one.
 */

import { useId, useMemo, useRef, useState } from "react";

import { type HourPoint, hourLabel, niceMax } from "@/lib/metricsCharts";

const W = 460;
const H = 150;
const PAD_LEFT = 44;
const PAD_RIGHT = 10;
const PAD_TOP = 14;
const PAD_BOTTOM = 22;
const PLOT_W = W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = H - PAD_TOP - PAD_BOTTOM;

export interface Series {
  name: string;
  value: (p: HourPoint) => number | null;
  /** CSS color expression — a token var or a color-mix over tokens. */
  color: string;
}

interface FrameProps {
  title: string;
  caption?: string;
  points: HourPoint[];
  series: Series[];
  format: (v: number) => string;
  /** Axis ticks only — shorter than `format`, because 44px of gutter
   * holds "2.5 s" and not "60.0 tok/s". Defaults to `format`. */
  axisFormat?: (v: number) => string;
  /** "bars" draws series[0] as columns; "lines" draws every series. */
  kind: "bars" | "lines";
}

function ticksFor(points: HourPoint[], series: Series[]): { max: number; mid: number } {
  let max = 0;
  for (const p of points) {
    for (const s of series) {
      const v = s.value(p);
      if (v !== null && v > max) max = v;
    }
  }
  const top = niceMax(max);
  return { max: top, mid: top / 2 };
}

/**
 * What a sighted reader takes from the chart at a glance, as a sentence:
 * each series' latest value and its peak hour. The chart's label used to
 * say only that a table existed, and its `aria-describedby` named an id
 * no element had.
 */
export function chartSummary(
  points: HourPoint[],
  series: Series[],
  format: (v: number) => string,
): string {
  const span = points.length;
  const parts: string[] = [];
  for (const s of series) {
    let latest: { v: number; t: string } | null = null;
    let peak: { v: number; t: string } | null = null;
    for (const p of points) {
      const v = s.value(p);
      if (v === null) continue;
      latest = { v, t: p.t };
      if (peak === null || v > peak.v) peak = { v, t: p.t };
    }
    if (!latest || !peak) {
      parts.push(`${s.name}: nothing measured in this window.`);
      continue;
    }
    parts.push(
      `${s.name}: latest ${format(latest.v)} at ${hourLabel(latest.t, span)}, ` +
        `highest ${format(peak.v)} at ${hourLabel(peak.t, span)}.`,
    );
  }
  return parts.join(" ");
}

function xFor(index: number, count: number): number {
  // Center of the index's slot, so bars and line points line up.
  return PAD_LEFT + ((index + 0.5) / count) * PLOT_W;
}

/** Polyline segments between nulls: a gap in the data is a gap in the
 * ink. Exported for the unit test — the rule is worth pinning without
 * a DOM. */
export function segments(
  points: HourPoint[],
  value: (p: HourPoint) => number | null,
  yMax: number,
): { x: number; y: number }[][] {
  const runs: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  points.forEach((p, i) => {
    const v = value(p);
    if (v === null) {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    run.push({
      x: xFor(i, points.length),
      y: PAD_TOP + PLOT_H - (Math.min(v, yMax) / yMax) * PLOT_H,
    });
  });
  if (run.length) runs.push(run);
  return runs;
}

export function HourChart({
  title,
  caption,
  points,
  series,
  format,
  axisFormat,
  kind,
}: FrameProps) {
  const tick = axisFormat ?? format;
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const { max } = useMemo(() => ticksFor(points, series), [points, series]);
  const summary = useMemo(() => chartSummary(points, series, format), [points, series, format]);
  const span = points.length;

  if (points.length === 0) return null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const x = frac * W;
    const index = Math.round(((x - PAD_LEFT) / PLOT_W) * span - 0.5);
    setHover(index >= 0 && index < span ? index : null);
  };

  const hovered = hover !== null ? points[hover] : null;
  const barW = Math.min(24, (PLOT_W / span) * 0.8);
  const yFor = (v: number) => PAD_TOP + PLOT_H - (Math.min(v, max) / max) * PLOT_H;

  return (
    <figure className="min-w-0">
      <figcaption className="font-ui mb-1 flex items-baseline gap-2 text-sm">
        <span className="font-semibold">{title}</span>
        {caption && <span className="text-xs text-[color:var(--muted)]">{caption}</span>}
        {kind === "lines" && series.length > 1 && (
          <span className="ml-auto flex items-center gap-3 text-xs text-[color:var(--muted)]">
            {series.map((s) => (
              <span key={s.name} className="flex items-center gap-1">
                <span
                  aria-hidden
                  className="inline-block h-0.5 w-4 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                {s.name}
              </span>
            ))}
          </span>
        )}
      </figcaption>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={`${title} per hour; the same values are in the table below this chart.`}
          aria-describedby={id}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {/* Recessive frame: hairline gridlines at 0, mid and top. */}
          {[0, 0.5, 1].map((f) => (
            <line
              key={f}
              x1={PAD_LEFT}
              x2={W - PAD_RIGHT}
              y1={PAD_TOP + PLOT_H * (1 - f)}
              y2={PAD_TOP + PLOT_H * (1 - f)}
              stroke="var(--border)"
              strokeWidth={1}
            />
          ))}
          {[0, 0.5, 1].map((f) => (
            <text
              key={f}
              x={PAD_LEFT - 6}
              y={PAD_TOP + PLOT_H * (1 - f) + 3}
              textAnchor="end"
              className="fill-[color:var(--muted)]"
              fontSize={9}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {tick(max * f)}
            </text>
          ))}
          {/* Sparse x labels: first, middle, last hour. */}
          {[0, Math.floor((span - 1) / 2), span - 1]
            .filter((v, i, a) => a.indexOf(v) === i)
            .map((i) => (
              <text
                key={i}
                x={i === span - 1 ? W - PAD_RIGHT : xFor(i, span)}
                y={H - 6}
                // The edge labels anchor inward so neither clips against
                // the viewBox.
                textAnchor={i === 0 ? "start" : i === span - 1 ? "end" : "middle"}
                className="fill-[color:var(--muted)]"
                fontSize={9}
              >
                {hourLabel(points[i]!.t, span)}
              </text>
            ))}

          {kind === "bars" &&
            points.map((p, i) => {
              const v = series[0]!.value(p);
              if (v === null || v === 0) return null;
              const y = yFor(v);
              const h = PAD_TOP + PLOT_H - y;
              const x = xFor(i, span) - barW / 2;
              const r = Math.min(4, h, barW / 2);
              return (
                <path
                  key={p.t}
                  // 4px rounded data-end, square at the baseline.
                  d={`M ${x} ${PAD_TOP + PLOT_H} V ${y + r} Q ${x} ${y} ${x + r} ${y} H ${
                    x + barW - r
                  } Q ${x + barW} ${y} ${x + barW} ${y + r} V ${PAD_TOP + PLOT_H} Z`}
                  fill={series[0]!.color}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              );
            })}

          {kind === "lines" &&
            series.map((s) => (
              <g key={s.name}>
                {segments(points, s.value, max).map((run, ri) =>
                  run.length === 1 ? (
                    // A lone point between gaps would otherwise be
                    // invisible ink: no line can reach it.
                    <circle
                      key={ri}
                      cx={run[0]!.x}
                      cy={run[0]!.y}
                      r={3}
                      fill={s.color}
                      stroke="var(--panel)"
                      strokeWidth={2}
                    />
                  ) : (
                    <polyline
                      key={ri}
                      points={run.map((pt) => `${pt.x},${pt.y}`).join(" ")}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ),
                )}
              </g>
            ))}

          {/* The crosshair finds the X — readers aim at an hour, never
              at a 2px line. */}
          {hovered && kind === "lines" && (
            <line
              x1={xFor(hover!, span)}
              x2={xFor(hover!, span)}
              y1={PAD_TOP}
              y2={PAD_TOP + PLOT_H}
              stroke="var(--border-hover)"
              strokeWidth={1}
            />
          )}
          {hovered &&
            kind === "lines" &&
            series.map((s) => {
              const v = s.value(hovered);
              if (v === null) return null;
              return (
                <circle
                  key={s.name}
                  cx={xFor(hover!, span)}
                  cy={yFor(v)}
                  r={4}
                  fill={s.color}
                  stroke="var(--panel)"
                  strokeWidth={2}
                />
              );
            })}
        </svg>

        {hovered && (
          <div
            className="font-ui pointer-events-none absolute top-0 z-10 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-2 py-1 text-xs shadow-sm"
            style={{
              left: `${Math.min(92, Math.max(2, ((hover! + 0.5) / span) * 100))}%`,
              transform: "translateX(-50%)",
            }}
          >
            <div className="text-[color:var(--muted)]">{hourLabel(hovered.t, span)}</div>
            {series.map((s) => {
              const v = s.value(hovered);
              return (
                <div key={s.name} className="flex items-center gap-1.5 whitespace-nowrap">
                  <span
                    aria-hidden
                    className="inline-block h-0.5 w-3 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="font-semibold">{v === null ? "—" : format(v)}</span>
                  {series.length > 1 && <span className="text-[color:var(--muted)]">{s.name}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p id={id} className="sr-only">
        {summary}
      </p>

      <details className="mt-1">
        <summary className="font-ui cursor-pointer text-xs text-[color:var(--muted)]">
          As a table
        </summary>
        <table className="mt-1 w-full text-left text-xs" aria-describedby={id}>
          <thead>
            <tr>
              <th className="py-1 pr-2 font-medium">Hour</th>
              {series.map((s) => (
                <th key={s.name} className="py-1 pr-2 text-right font-medium">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.t} className="border-t border-[color:var(--border)]">
                <td className="py-1 pr-2 text-[color:var(--muted)]">{hourLabel(p.t, span)}</td>
                {series.map((s) => {
                  const v = s.value(p);
                  return (
                    <td
                      key={s.name}
                      className="py-1 pr-2 text-right font-mono"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {v === null ? "—" : format(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** One headline number. `value === null` renders "unreported" — never
 * 0, for the page's standing reason. */
export function StatTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | null;
  sub?: string;
  tone?: "error";
}) {
  return (
    <div className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2">
      <div className="font-ui text-xs text-[color:var(--muted)]">{label}</div>
      <div
        className={`font-ui text-xl font-semibold ${
          tone === "error" && value !== null && value !== "0" ? "text-status-error" : ""
        }`}
      >
        {value ?? <span className="text-sm font-normal text-[color:var(--muted)]">unreported</span>}
      </div>
      {sub && <div className="text-[0.625rem] text-[color:var(--muted)]">{sub}</div>}
    </div>
  );
}
