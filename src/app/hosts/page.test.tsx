/**
 * The Hosts page, driven: the fleet row, a machine that does not answer,
 * and the restraints the page shares with Metrics -- a series a machine
 * cannot read is "not reported" with its reason, never a zero.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HostsPage from "./page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/hosts",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

const NOW = Date.now();
const GiB = 1024 ** 3;
const NO_SENSORS = "Windows publishes no temperature or power for this card";

let enabled: boolean;
let urls: string[];

function history() {
  const buckets = [0, 1, 2, 3].map((i) => ({
    start: new Date(NOW - (40 - i * 10) * 1000).toISOString(),
    samples: i === 1 ? 0 : 1,
    expectedSamples: 1,
  }));
  const gpu = (metric: string, unit: string, extra: Record<string, unknown>) => ({
    key: `gpu:cuda:0:${metric}`,
    metric,
    unit,
    label: `RTX 5090 ${metric}`,
    deviceKind: "cuda",
    deviceIndex: 0,
    deviceName: "RTX 5090",
    min: [1, null, 1, 1],
    mean: [1, null, 1, 1],
    max: [1, null, 1, 1],
    ...extra,
  });
  return {
    enabled,
    sampleSeconds: 10,
    step: "raw",
    stepSeconds: 10,
    from: buckets[0]!.start,
    to: new Date(NOW).toISOString(),
    truncated: false,
    latestAt: new Date(NOW - 10_000).toISOString(),
    buckets,
    series: [
      gpu("gpuMemoryUsed", "bytes", { latest: 8 * GiB }),
      gpu("gpuMemoryTotal", "bytes", { latest: 32 * GiB }),
      gpu("gpuMemoryEugene", "bytes", { latest: 6 * GiB }),
      gpu("gpuUtilization", "percent", { latest: 55 }),
      gpu("gpuTemperature", "celsius", {
        unavailable: NO_SENSORS,
        min: [null, null, null, null],
        mean: [null, null, null, null],
        max: [null, null, null, null],
      }),
      {
        key: "cpuUtilization",
        metric: "cpuUtilization",
        unit: "percent",
        label: "CPU",
        latest: 12,
        min: [10, null, 12, 12],
        mean: [10, null, 12, 12],
        max: [10, null, 12, 12],
      },
    ],
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: String(status),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  enabled = true;
  urls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = decodeURIComponent(String(input));
      urls.push(url);
      if (url.includes("node:nas/")) {
        return json({ detail: { detail: "nas did not answer: connection refused" } }, 502);
      }
      if (url.includes("/v1/node/history")) return json(history());
      if (url.endsWith("/agent/v1/node"))
        return json({ name: "amish", enrolled: true, devices: [] });
      if (url.endsWith("/control/v1/nodes")) {
        return json({ nodes: [{ name: "amish" }, { name: "nas", reachable: false }] });
      }
      return json({});
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Hosts page", () => {
  it("rows every machine, and says which one is not answering", async () => {
    render(<HostsPage />);
    const fleet = await screen.findByRole("table", { name: "Machines" });
    await waitFor(() => expect(within(fleet).getByText("RTX 5090")).toBeTruthy());
    expect(within(fleet).getByText("8.0 GiB of 32.0 GiB")).toBeTruthy();
    expect(within(fleet).getByText("6.0 GiB")).toBeTruthy();
    expect(within(fleet).getByText(/Not answering: .*connection refused/)).toBeTruthy();
    // The fleet asks only for what it draws.
    const fleetRead = urls.find((u) => u.includes("/v1/node/history") && u.includes("metric="));
    expect(fleetRead).toContain("metric=gpuTemperature");
  });

  it("says not reported, with the reason, where a machine cannot read a series", async () => {
    render(<HostsPage />);
    await screen.findByText(/Not reported on this machine \(1\)/);
    expect(screen.getAllByText(new RegExp(NO_SENSORS)).length).toBeGreaterThan(0);
    // Never a zero in its place.
    expect(screen.queryByText("0 °C")).toBeNull();
  });

  it("counts a gap in the window", async () => {
    render(<HostsPage />);
    expect(await screen.findByText(/1 gap/)).toBeTruthy();
  });

  it("says when recording is off, and that the record is still shown", async () => {
    enabled = false;
    render(<HostsPage />);
    expect(await screen.findByText(/Recording is off on this machine/)).toBeTruthy();
  });
});
