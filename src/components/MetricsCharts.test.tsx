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

import { HourChart, RequestOutcomes } from "./MetricsCharts";

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

describe("RequestOutcomes", () => {
  it("separates served and unserved counts with an accessible summary", () => {
    render(<RequestOutcomes requests={80} errors={20} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "60 served, 20 not served, out of 80 recorded requests.",
    );
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("60 served")).toBeInTheDocument();
    expect(screen.getByText("20 not served")).toBeInTheDocument();
  });

  it.each([
    [10, 0, "100%"],
    [10, 10, "0%"],
    [10000, 1, ">99.9%"],
    [10000, 9999, "<0.1%"],
  ])("preserves outcome extremes (%s requests, %s errors)", (requests, errors, label) => {
    render(<RequestOutcomes requests={Number(requests)} errors={Number(errors)} />);
    expect(screen.getByText(String(label))).toBeInTheDocument();
  });

  it.each([
    [0, 0],
    [10, 11],
    [10, -1],
    [NaN, 0],
    [Infinity, 0],
    [10, 0.5],
  ])("does not draw an invented ratio from %s requests and %s errors", (requests, errors) => {
    render(<RequestOutcomes requests={requests} errors={errors} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/No requests|unavailable/)).toBeInTheDocument();
  });
});
