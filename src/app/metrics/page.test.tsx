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
        // The CLI subscription backends never report token counts.
        tokensPerSecond: null,
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
    // "0 tok/s" would say slow where the data says unmeasured, and the
    // operator cannot recover the difference from the screen.
    expect(await screen.findByText("unreported")).toBeInTheDocument();
    expect(screen.queryByText("0.0")).not.toBeInTheDocument();
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
});
