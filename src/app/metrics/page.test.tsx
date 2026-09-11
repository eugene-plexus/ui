/**
 * The metrics page, driven.
 *
 * The assertions worth keeping are the three restraints, because each is
 * a way the page could be quietly wrong rather than visibly broken:
 * "unreported" must not render as zero, metrics-off must not render as
 * an empty window, and a median must carry the sample count it was
 * computed over.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MetricsPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

let summary: unknown;
let requests: unknown;
let status: number;
let urls: string[];

beforeEach(() => {
  status = 200;
  urls = [];
  const seen = urls;
  summary = {
    windowStart: "2026-09-10T00:00:00Z",
    windowEnd: "2026-09-10T23:00:00Z",
    gatewayStartedAt: "2026-09-10T00:00:00Z",
    rowsDropped: 0,
    groups: [
      {
        model: "dolphin3-8b",
        driver: "ollama-small",
        runtime: null,
        requests: 4,
        errors: 0,
        cascaded: 0,
        swappedIn: 0,
        latencyMs: { p50: 760, p90: 1200, max: 17914 },
        tokensPerSecond: { p50: 116.8, samples: 4 },
        routingMs: { p50: 3, p90: 8, max: 41 },
        overheadMs: { p50: 6, p90: 12, max: 30 },
      },
      {
        model: "claude-via-cli",
        driver: "claude-cli",
        runtime: null,
        requests: 2,
        errors: 1,
        cascaded: 1,
        swappedIn: 0,
        latencyMs: { p50: 2000, p90: 3000, max: 3000 },
        // A backend that reported no token counts on these requests, and
        // no latency of its own either, so neither the rate nor the
        // overhead split can be computed.
        tokensPerSecond: null,
        routingMs: { p50: 2, p90: 4, max: 9 },
        overheadMs: null,
      },
    ],
  };
  requests = { requests: [] };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      if (status !== 200) {
        return new Response(JSON.stringify({ detail: { detail: "metricsEnabled is false" } }), {
          status,
          headers: { "content-type": "application/json" },
        });
      }
      const body = url.includes("/metrics/requests") ? requests : summary;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("metrics page", () => {
  it("shows throughput per backend with the sample count it was measured over", async () => {
    render(<MetricsPage />);

    // The headline: the number the milestone exists to produce.
    expect(await screen.findByText("116.8")).toBeInTheDocument();
    // Generation latency is long-tailed and a cold first request can be
    // twenty times a warm one, so a median without its sample count
    // invites a conclusion the data does not support.
    expect(screen.getByText("(4)")).toBeInTheDocument();
    expect(screen.getByText("ollama-small")).toBeInTheDocument();
  });

  it("renders an unreported throughput as unreported, never as zero", async () => {
    render(<MetricsPage />);
    await screen.findByText("116.8");
    // Scoped to the row, because "unreported" is now the right word in
    // two columns - throughput and overhead - and both are absent for
    // this backend for the same underlying reason.
    const row = screen.getByText("claude-cli").closest("tr");
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent("unreported");
    // "0 tok/s" would say slow where the data says unmeasured, and the
    // operator cannot recover the difference from the screen.
    expect(row).not.toHaveTextContent("0.0");
  });

  it("says metrics are off rather than showing an empty window", async () => {
    status = 503;
    render(<MetricsPage />);
    // Two different answers with two different fixes: one is a config
    // change, the other is "send a request".
    expect(await screen.findByText(/Not recording/i)).toBeInTheDocument();
    expect(screen.getByText(/Retain request metrics/)).toBeInTheDocument();
  });

  it("warns that the numbers are a sample when the recorder dropped rows", async () => {
    (summary as { rowsDropped: number }).rowsDropped = 1234;
    render(<MetricsPage />);
    const note = await screen.findByRole("status");
    expect(note).toHaveTextContent(/1,234 measurements were dropped/);
    // The reassurance matters as much as the warning: a dropped
    // measurement is not a dropped request.
    expect(note).toHaveTextContent(/Inference was not affected/);
  });

  it("asks the gateway for the window the operator selected", async () => {
    const user = userEvent.setup({ delay: null });
    render(<MetricsPage />);
    await screen.findByText("116.8");

    await user.selectOptions(screen.getByLabelText("Time window"), "1");
    await waitFor(() => {
      const last = urls.filter((u) => u.includes("/v1/metrics?")).pop();
      expect(last).toBeDefined();
      const since = new Date(decodeURIComponent(last!.split("since=")[1]!));
      // Within a minute of an hour ago, not a day ago.
      expect(Date.now() - since.getTime()).toBeLessThan(3700_000);
    });
  });

  it("shows the routing phase and the control plane's own overhead", async () => {
    render(<MetricsPage />);
    await screen.findByText("116.8");
    // The two phases that used to be invisible: routing happened before
    // any clock started, and the local hop was asserted to be free
    // rather than measured.
    expect(screen.getByText("3 ms")).toBeInTheDocument();
    expect(screen.getByText("6 ms")).toBeInTheDocument();
  });

  it("says overhead is unreported rather than showing it as free", async () => {
    render(<MetricsPage />);
    await screen.findByText("116.8");
    // A backend that does not report its own latency leaves the split
    // uncomputable. Rendering it as 0 would assert the hop is free,
    // which is the claim the measurement exists to check.
    const unreported = screen.getAllByText("unreported");
    expect(unreported.length).toBe(2);
  });

  it("shows what the balancer considered, including why one was skipped", async () => {
    requests = {
      requests: [
        {
          startedAt: "2026-09-10T22:00:00Z",
          requestedModel: "qwen",
          servedModel: "qwen",
          attempts: 1,
          tier: 1,
          totalMs: 900,
          outcome: "served",
          routingMs: 4,
          refreshed: true,
          strategy: "least_busy",
          tries: [{ driver: "replica-a", elapsedMs: 880, served: true, backendMs: 870 }],
          candidates: [
            { driver: "replica-a", tier: 1, eligible: true, inFlight: 0, slots: 4 },
            {
              driver: "replica-b",
              tier: 1,
              eligible: false,
              reason: "runtime 'rt-b' is stopped",
            },
          ],
        },
      ],
    };
    render(<MetricsPage />);

    // The answer to "why there and not the other one".
    const row = await screen.findByText(/considered/);
    expect(row).toHaveTextContent("least_busy");
    expect(row).toHaveTextContent("replica-a");
    expect(row).toHaveTextContent("0/4");
    expect(row).toHaveTextContent("runtime 'rt-b' is stopped");
  });

  it("calls out a request that paid for a routing-table refresh", async () => {
    requests = {
      requests: [
        {
          startedAt: "2026-09-10T22:00:00Z",
          requestedModel: "qwen",
          attempts: 1,
          totalMs: 900,
          outcome: "served",
          routingMs: 210,
          refreshed: true,
          tries: [{ driver: "a", elapsedMs: 880, served: true }],
        },
      ],
    };
    render(<MetricsPage />);
    // A refresh does HTTP to the agent and to every driver inside the
    // request that triggered it, so it is named rather than left to be
    // inferred from a larger number.
    expect(await screen.findByText(/210 ms routing \(refreshed\)/)).toBeInTheDocument();
  });
});
