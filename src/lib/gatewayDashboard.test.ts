import { describe, expect, it } from "vitest";
import { capacityBackends, durationLabel, percentage } from "./gatewayDashboard";

describe("gateway capacity accounting", () => {
  it("counts aliases and fallbacks once per node/driver, but preserves same-name replicas on other nodes", () => {
    const one = { driver: "qwen", node: "one", eligible: true, in_flight: 3, parallel_slots: 4 };
    const two = { ...one, node: "two", in_flight: 1 };
    const result = capacityBackends({
      refreshed_at: new Date().toISOString(),
      slots: [
        { model: "chat", tiers: [{ target: "qwen", backends: [one, two] }] },
        {
          model: "fast",
          tiers: [
            { target: "qwen", backends: [one] },
            { target: "qwen", backends: [two] },
          ],
        },
      ],
    });
    expect(result).toHaveLength(2);
    expect(result.reduce((n, b) => n + b.in_flight!, 0)).toBe(4);
    expect(result.reduce((n, b) => n + b.parallel_slots!, 0)).toBe(8);
    expect(result[0]!.models).toEqual(["chat", "fast"]);
  });
  it("keeps absent counters unknown", () => {
    expect(
      capacityBackends({
        refreshed_at: "now",
        slots: [
          { model: "m", tiers: [{ target: "m", backends: [{ driver: "old", eligible: true }] }] },
        ],
      })[0]!.in_flight,
    ).toBeUndefined();
  });
});

it("does not round rare failures away or divide by no observations", () => {
  expect(percentage(99999, 100000)).toBe(">99.9%");
  expect(percentage(1, 100000)).toBe("<0.1%");
  expect(percentage(0, 0)).toBe("—");
  expect(percentage(0, 1)).toBe("0%");
  expect(durationLabel(90061000)).toBe("1d 1h");
});
