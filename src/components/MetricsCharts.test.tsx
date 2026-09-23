/**
 * The hourly chart, as a screen reader meets it.
 *
 * Its table pointed `aria-describedby` at an id no element carried, and
 * the image's label said only that a table existed. The description has
 * to exist and has to say what the chart shows: the latest value and the
 * peak hour.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { HourPoint } from "@/lib/metricsCharts";

import { HourChart } from "./MetricsCharts";

function point(t: string, requests: number): HourPoint {
  return {
    t,
    requests,
    errors: 0,
    latencyP50: null,
    latencyP90: null,
    ttftP50: null,
    decodeP50: null,
  };
}

const POINTS = [
  point("2026-09-21T09:00:00Z", 3),
  point("2026-09-21T10:00:00Z", 40),
  point("2026-09-21T11:00:00Z", 12),
];

describe("HourChart", () => {
  it("describes itself with an element that exists, naming the latest and the peak", () => {
    render(
      <HourChart
        title="Requests"
        points={POINTS}
        series={[{ name: "Requests", value: (p) => p.requests, color: "red" }]}
        format={(v) => String(v)}
        kind="bars"
      />,
    );
    const chart = screen.getByRole("img");
    const id = chart.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)).not.toBeNull();
    expect(chart).toHaveAccessibleDescription(/latest 12 at .*highest 40 at/);
    const table = document.querySelector("table");
    expect(document.getElementById(table!.getAttribute("aria-describedby")!)).not.toBeNull();
  });
});
