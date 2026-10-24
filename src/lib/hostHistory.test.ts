import { describe, expect, it } from "vitest";

import {
  type HostHistory,
  type HostSeries,
  bucketWord,
  FLEET_METRICS,
  coverage,
  diskGroups,
  formatValue,
  gpuGroups,
  historyPath,
  hostSeries,
  ofTotal,
  pointsFrom,
} from "./hostHistory";

it("requests power for the fleet's Power column", () => {
  expect(FLEET_METRICS).toContain("gpuPower");
});

function series(partial: Partial<HostSeries> & Pick<HostSeries, "key" | "metric">): HostSeries {
  return {
    unit: "bytes",
    label: partial.key,
    min: [],
    mean: [],
    max: [],
    ...partial,
  } as HostSeries;
}

const T0 = Date.parse("2026-10-18T12:00:00Z");

function history(overrides: Partial<HostHistory> = {}): HostHistory {
  return {
    enabled: true,
    sampleSeconds: 10,
    step: "raw",
    stepSeconds: 10,
    from: "2026-10-18T12:00:00Z",
    to: "2026-10-18T12:00:40Z",
    truncated: false,
    buckets: [0, 1, 2, 3].map((i) => ({
      start: new Date(T0 + i * 10_000).toISOString(),
      samples: i === 1 || i === 2 ? 0 : 1,
      expectedSamples: 1,
    })),
    series: [
      series({
        key: "gpu:cuda:0:gpuMemoryUsed",
        metric: "gpuMemoryUsed",
        deviceKind: "cuda",
        deviceIndex: 0,
        deviceName: "RTX 5090",
        latest: 8 * 1024 ** 3,
        mean: [1, null, null, 4],
      }),
      series({
        key: "gpu:cuda:0:gpuMemoryTotal",
        metric: "gpuMemoryTotal",
        deviceKind: "cuda",
        deviceIndex: 0,
        deviceName: "RTX 5090",
        latest: 32 * 1024 ** 3,
      }),
      series({ key: "cpuUtilization", metric: "cpuUtilization", unit: "percent" }),
      series({
        key: "disk:D:\\:diskFree",
        metric: "diskFree",
        volume: "D:\\",
        holds: ["Model folder: D:\\models"],
      }),
      series({ key: "disk:D:\\:diskTotal", metric: "diskTotal", volume: "D:\\" }),
    ],
    ...overrides,
  };
}

describe("host history, chart-ready", () => {
  it("keeps a missing bucket null, never zero", () => {
    const points = pointsFrom(history());
    expect(points.map((p) => p.values["gpu:cuda:0:gpuMemoryUsed"])).toEqual([1, null, null, 4]);
    expect(points[1]!.samples).toBe(0);
  });

  it("counts one gap per empty stretch and skips the bucket still filling", () => {
    const found = coverage(history(), T0 + 35_000);
    // Bucket 3 (12:00:30-40) is still being filled at 12:00:35.
    expect(found).toEqual({ samples: 1, expected: 3, gaps: 1 });
  });

  it("groups a card's series and a volume's", () => {
    const [gpu] = gpuGroups(history());
    expect(gpu?.id).toBe("gpu:cuda:0");
    expect(gpu?.name).toBe("RTX 5090");
    expect(ofTotal(gpu?.series.gpuMemoryUsed, gpu?.series.gpuMemoryTotal)).toBe(
      "8.0 GiB of 32.0 GiB",
    );
    const [disk] = diskGroups(history());
    expect(disk?.volume).toBe("D:\\");
    expect(disk?.holds).toEqual(["Model folder: D:\\models"]);
    expect(disk?.free?.metric).toBe("diskFree");
    expect(hostSeries(history(), "cpuUtilization")?.key).toBe("cpuUtilization");
  });

  it("formats each unit", () => {
    expect(formatValue("bytes", 512 * 1024 ** 2)).toBe("512 MiB");
    expect(formatValue("percent", 4.25)).toBe("4.3%");
    expect(formatValue("percent", 55)).toBe("55%");
    expect(formatValue("celsius", 61.4)).toBe("61 °C");
    expect(formatValue("watts", 312.5)).toBe("313 W");
    expect(bucketWord(10)).toBe("10 s");
    expect(bucketWord(60)).toBe("minute");
    expect(bucketWord(3600)).toBe("hour");
  });

  it("asks for the window and the metrics named", () => {
    const path = historyPath(1, T0, ["gpuMemoryUsed", "gpuTemperature"]);
    const url = new URL(path, "http://x");
    expect(url.pathname).toBe("/v1/node/history");
    expect(url.searchParams.get("from")).toBe("2026-10-18T11:00:00.000Z");
    expect(url.searchParams.getAll("metric")).toEqual(["gpuMemoryUsed", "gpuTemperature"]);
  });
});
