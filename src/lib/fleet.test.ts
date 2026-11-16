import { describe, expect, it } from "vitest";

import { fleetRow, fleetTotals } from "./fleet";
import type { HostHistory } from "./hostHistory";

const GiB = 1024 ** 3;

function series(key: string, metric: string, latest: number | null, extra: object = {}) {
  return {
    key,
    metric,
    unit: "bytes",
    label: key,
    ...(latest === null ? { unavailable: "not on this card" } : { latest }),
    min: [latest],
    mean: [latest],
    max: [latest],
    ...extra,
  };
}

function machine(parts: ReturnType<typeof series>[]): HostHistory {
  return {
    enabled: true,
    sampleSeconds: 10,
    step: "hour",
    stepSeconds: 3600,
    from: "2026-11-16T00:00:00Z",
    to: "2026-11-16T01:00:00Z",
    truncated: false,
    buckets: [{ start: "2026-11-16T00:00:00Z", samples: 360, expectedSamples: 360 }],
    series: parts,
  } as HostHistory;
}

describe("every machine together (row 38)", () => {
  it("adds a machine's cards, takes its hottest and its fullest disk", () => {
    const row = fleetRow(
      machine([
        series("gpu:cuda:0:used", "gpuMemoryUsed", 8 * GiB),
        series("gpu:cuda:1:used", "gpuMemoryUsed", 4 * GiB),
        series("gpu:cuda:0:total", "gpuMemoryTotal", 32 * GiB),
        series("gpu:cuda:1:total", "gpuMemoryTotal", 24 * GiB),
        series("gpu:cuda:0:util", "gpuUtilization", 80),
        series("gpu:cuda:1:util", "gpuUtilization", 20),
        series("gpu:cuda:0:temp", "gpuTemperature", 71, { max: [86] }),
        series("gpu:cuda:1:temp", "gpuTemperature", null),
        series("gpu:cuda:0:power", "gpuPower", 300, { mean: [250] }),
        series("disk:C:free", "diskFree", 100, { volume: "C:" }),
        series("disk:C:total", "diskTotal", 1000, { volume: "C:" }),
        series("disk:D:free", "diskFree", 500, { volume: "D:" }),
        series("disk:D:total", "diskTotal", 1000, { volume: "D:" }),
        series("runtimesRunning", "runtimesRunning", 2),
      ]),
    );
    expect(row).toMatchObject({
      gpus: 2,
      memoryUsed: 12 * GiB,
      memoryTotal: 56 * GiB,
      utilization: 50,
      temperature: 71,
      peakTemperature: 86,
      power: 300,
      meanPower: 250,
      runtimes: 2,
    });
    expect(row.fullestDisk?.volume).toBe("C:");
    expect(row.fullestDisk?.usedPercent).toBeCloseTo(90);
  });

  it("says not reported rather than zero, and counts who answered", () => {
    const quiet = fleetRow(machine([]));
    expect(quiet).toMatchObject({ memoryUsed: null, utilization: null, power: null });
    const totals = fleetTotals([quiet, null]);
    expect(totals).toMatchObject({ machines: 2, answering: 1, memoryUsed: null, power: null });
  });
});
