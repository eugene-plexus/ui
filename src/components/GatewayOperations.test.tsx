import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { GatewayCapacity, GatewayEfficiency } from "./GatewayOperations";

it("distinguishes stale discovery, failed control, sleeping routes and unknown counters", () => {
  render(
    <GatewayCapacity
      readAt={Date.parse("2026-10-15T12:05:00Z")}
      error={null}
      routing={{
        refreshed_at: "2026-10-15T12:00:00Z",
        control_root: { source: "agent", reachable: false, error: "503 Locked" },
        unreachable_drivers: ["missing"],
        slots: [
          {
            model: "chat",
            tiers: [
              {
                target: "qwen",
                backends: [
                  {
                    driver: "sleeping",
                    eligible: false,
                    runtime_status: "stopped",
                    start_on_demand: true,
                    ineligible_reason: "Runtime is stopped",
                  },
                ],
              },
            ],
          },
        ],
      }}
    />,
  );
  expect(screen.getByText(/snapshot is 5m old/)).toBeInTheDocument();
  expect(screen.getByText(/503 Locked/)).toBeInTheDocument();
  expect(screen.getByText(/Starts on demand/)).toBeInTheDocument();
  expect(screen.getByText("In flight").parentElement).toHaveTextContent("unreported");
  expect(screen.getByText(/1 model route without/)).toBeInTheDocument();
});

it("reports a partial read failure without calling it zero capacity", () => {
  render(<GatewayCapacity routing={null} readAt={null} error="Connection refused" />);
  expect(screen.getByRole("status")).toHaveTextContent("Capacity unavailable: Connection refused");
  expect(screen.queryByText("0 / 0")).not.toBeInTheDocument();
});

it("uses total distributions and the cache's reporting denominator, preserving absent p99 and zero overhead", () => {
  render(
    <GatewayEfficiency
      total={{
        requests: 1000,
        errors: 2,
        cascaded: 15,
        swappedIn: 3,
        latencyMs: { p50: 1000, p90: 1400, max: 5000 },
        overheadMs: { p50: 0, p90: 1, max: 5 },
        promptCache: { requests: 7, promptTokens: 100, cachedTokens: 70 },
        affinity: { hit: 2, new: 10, moved: 1, evicted: 1 },
        tierCounts: { "1": 900, "2": 98 },
      }}
    />,
  );
  expect(screen.getByText("70%")).toBeInTheDocument();
  expect(screen.getByText(/7 reporting requests/)).toBeInTheDocument();
  expect(screen.getByText("Request p99").parentElement!.textContent).toContain("unreported");
  expect(
    within(screen.getByText("Gateway overhead p50").parentElement!).getByText("0 ms"),
  ).toBeInTheDocument();
  expect(screen.getByText("3/4")).toBeInTheDocument();
});
