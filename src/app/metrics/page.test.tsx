/**
 * The metrics page, driven.
 *
 * The assertions worth keeping are the three restraints, because each is
 * a way the page could be quietly wrong rather than visibly broken:
 * "unreported" must not render as zero, metrics-off must not render as
 * an empty window, and a median must carry the sample count it was
 * computed over.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MetricsPage from "./page";

vi.mock("next/navigation", () => ({
  // The shared navigation reads the pathname to mark the current
  // screen. Added when the shared navigation landed; without it every
  // page that renders a header throws on mount.
  usePathname: () => "/metrics",
  // The shell reads `?sel=` to know which object the page is about.
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

let summary: unknown;
let requests: unknown;
let clientUsage: unknown;
let status: number;
let errorBody: unknown;
let urls: string[];
/** When set, a read whose window starts before this is held until released. */
let holdOlderThan: number | null;
let releaseHeld: () => void;
let held: Promise<void>;
/** A different summary for reads whose window starts before `holdOlderThan`. */
let olderSummary: unknown;
/** URL fragments whose reads answer 404, as an older gateway's would. */
let failPaths: string[];

beforeEach(() => {
  holdOlderThan = null;
  olderSummary = null;
  failPaths = [];
  held = new Promise((resolve) => {
    releaseHeld = resolve;
  });
  status = 200;
  errorBody = { detail: { detail: "metricsEnabled is false" } };
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
        // Streamed requests: a first-token time and a decode rate whose
        // sample count is deliberately DIFFERENT from tokensPerSecond's
        // (the decode window guard can exclude requests usage kept).
        ttftMs: { p50: 180, p90: 300, max: 900 },
        decodeTokensPerSecond: { p50: 128.4, samples: 3 },
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
  clientUsage = {
    windowStart: "2026-09-10T00:00:00Z",
    windowEnd: "2026-09-11T00:00:00Z",
    rowsDropped: 0,
    truncated: false,
    clients: [],
  };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      const sinceParam = url.split("since=")[1];
      const since = sinceParam ? Date.parse(decodeURIComponent(sinceParam)) : NaN;
      const older = holdOlderThan !== null && since < holdOlderThan;
      if (older) await held;
      if (failPaths.some((p) => url.includes(p))) {
        return new Response(JSON.stringify({ detail: "Not Found" }), {
          status: 404,
          statusText: "Not Found",
          headers: { "content-type": "application/json" },
        });
      }
      if (status !== 200) {
        return new Response(JSON.stringify(errorBody), {
          status,
          statusText: String(status),
          headers: { "content-type": "application/json" },
        });
      }
      const body = url.includes("/metrics/requests")
        ? requests
        : url.includes("/metrics/clients")
          ? clientUsage
          : older && olderSummary !== null
            ? olderSummary
            : summary;
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

  it("links metrics-off to the gateway's own settings, not an empty Config page", async () => {
    status = 503;
    render(<MetricsPage />);
    // A bare `/config` has no `?sel=` and renders "Nothing selected".
    const link = await screen.findByRole("link", { name: "Config page" });
    expect(link).toHaveAttribute("href", "/config?sel=gateway");
  });

  it("shows the gateway's own sentence when a read fails, not the status line", async () => {
    status = 500;
    errorBody = {
      detail: {
        title: "Metrics store unavailable",
        detail: "The metrics file could not be opened because the disk is full.",
        status: 500,
      },
    };
    render(<MetricsPage />);
    const sentence = await screen.findByText(
      "The metrics file could not be opened because the disk is full.",
    );
    expect(sentence).toHaveAttribute("role", "alert");
    expect(screen.queryByText(/HTTP 500/)).toBeNull();
  });

  it("keeps the dashboard when a side read fails, and says which one", async () => {
    // An older gateway has neither endpoint. One refused side read used to
    // reject the whole read and leave only an error on the page.
    failPaths = ["/metrics/clients", "/metrics/requests"];
    render(<MetricsPage />);
    expect(await screen.findByText("116.8")).toBeInTheDocument();
    expect(screen.getByText(/Could not read usage by client key/)).toBeInTheDocument();
    expect(screen.getByText(/Could not read recent requests/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers to copy a request's id, which is what a log search needs", async () => {
    requests = {
      requests: [
        {
          startedAt: "2026-09-21T12:00:00Z",
          requestedModel: "alias",
          attempts: 1,
          totalMs: 50,
          requestId: "req-7f3a",
          outcome: "served",
          tries: [],
        },
      ],
    };
    render(<MetricsPage />);
    const id = await screen.findByText("Request req-7f3a");
    const row = id.closest("li") as HTMLElement;
    expect(within(row).getByRole("button", { name: "Copy request ID" })).toBeInTheDocument();
  });

  it("dates a request from another day, since the window spans a week", async () => {
    const lastWeek = new Date(Date.now() - 5 * 86_400_000).toISOString();
    requests = {
      requests: [
        {
          startedAt: lastWeek,
          requestedModel: "alias",
          attempts: 1,
          totalMs: 50,
          requestId: "req-old",
          outcome: "served",
          tries: [],
        },
      ],
    };
    render(<MetricsPage />);
    const row = (await screen.findByText("Request req-old")).closest("li") as HTMLElement;
    const day = new Date(lastWeek).toLocaleString(undefined, { month: "short", day: "numeric" });
    expect(row).toHaveTextContent(day);
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

  it("never shows an older selection's numbers under a newer one", async () => {
    const user = userEvent.setup({ delay: null });
    render(<MetricsPage />);
    await screen.findByText("116.8");
    // The week's reads are slow and say something different.
    holdOlderThan = Date.now() - 2 * 86_400_000;
    olderSummary = {
      ...(summary as object),
      groups: [
        {
          ...(summary as { groups: object[] }).groups[0],
          tokensPerSecond: { p50: 777.7, samples: 9 },
        },
      ],
    };
    await user.selectOptions(screen.getByLabelText("Time window"), "168");
    expect(await screen.findByTestId("metrics-updating")).toHaveTextContent("Updating");
    await user.selectOptions(screen.getByLabelText("Time window"), "1");
    await waitFor(() => expect(screen.queryByTestId("metrics-updating")).toBeNull());
    // The week's reads land last.
    releaseHeld();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText("777.7")).toBeNull();
    expect(screen.getAllByText("116.8").length).toBeGreaterThan(0);
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
    // which is the claim the measurement exists to check. Scoped to the
    // row because the stat tiles now say "unreported" too, for their
    // own nulls — the page-wide count stopped identifying this cell.
    const row = screen.getByText("claude-cli").closest("tr");
    expect(row).not.toBeNull();
    const unreported = within(row as HTMLElement).getAllByText("unreported");
    expect(unreported.length).toBe(2);
  });

  it("shows first token and decode speed beside the whole-attempt rate", async () => {
    render(<MetricsPage />);
    // The decode median with ITS OWN sample count — three streamed
    // requests qualified where four reported usage, and pretending the
    // two numbers rest on the same evidence would overstate one of them.
    expect(await screen.findByText("128.4")).toBeInTheDocument();
    expect(screen.getByText("(3)")).toBeInTheDocument();
    // The model name is also an option in the model filter, so take the
    // occurrence that sits in a table row.
    const dolphin = screen
      .getAllByText("dolphin3-8b")
      .map((el) => el.closest("tr"))
      .find((tr) => tr !== null);
    expect(dolphin).toBeTruthy();
    expect(dolphin).toHaveTextContent("180 ms");
    // A backend where nothing streamed has no first token to time and
    // no decode window: an em dash, never a zero.
    const claude = screen.getByText("claude-cli").closest("tr");
    expect(claude).not.toBeNull();
    expect(within(claude as HTMLElement).queryByText("0.0")).toBeNull();
  });

  it("owns its scroll, because the shell clips at the viewport", async () => {
    render(<MetricsPage />);
    await screen.findByText("116.8");
    // The AppShell is h-dvh with overflow hidden; a page without its own
    // overflow-y-auto renders everything below the fold unreachable.
    // Shipped that way once: the comparison table was visible only to
    // copy/paste. jsdom applies no CSS, so the class IS the assertion.
    const scroller = screen.getByTestId("metrics-scroll");
    expect(scroller.className).toContain("overflow-y-auto");
    expect(scroller).toContainElement(screen.getByText("claude-cli"));
  });

  it("leads with the window's headline tiles, nulls as unreported", async () => {
    render(<MetricsPage />);
    // Tiles read the groupBy=total answer; the mock serves the same
    // summary, whose first group carries streamed numbers. The tile is
    // found by its caption because "First token" is also a column head.
    expect(await screen.findByText("median, streamed requests")).toBeInTheDocument();
    expect(screen.getByText("Decode speed")).toBeInTheDocument();
    expect(screen.getByText("128.4 tok/s")).toBeInTheDocument();
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

  it("shows correlation, full elapsed time and unknown attempt usage", async () => {
    requests = {
      requests: [
        {
          startedAt: "2026-09-21T12:00:00Z",
          requestedModel: "alias",
          attempts: 1,
          totalMs: 50,
          elapsedMs: 900,
          requestId: "request-fixture",
          outcome: "error",
          tries: [
            {
              driver: "primary",
              elapsedMs: 50,
              served: false,
              retryDisposition: "indeterminate",
              usageKnown: false,
            },
          ],
        },
      ],
    };
    render(<MetricsPage />);
    expect(await screen.findByText("Request request-fixture")).toBeInTheDocument();
    expect(screen.getByText(/outcome unknown; not replayed/)).toHaveTextContent(
      "usage unknown (not zero cost)",
    );
    expect(screen.getByText("900 ms")).toBeInTheDocument();
  });
});

it("shows per-key usage with incomplete accounting and retention limits", async () => {
  clientUsage = {
    rowsDropped: 1,
    truncated: true,
    clients: [
      {
        clientKeyId: "verified-id",
        clientKeyName: "Laptop app",
        requests: 5,
        served: 3,
        failed: 2,
        attempts: 6,
        promptTokens: 123,
        completionTokens: 45,
        incompleteUsageRequests: 2,
      },
    ],
  };
  render(<MetricsPage />);
  expect(await screen.findByText("Laptop app")).toBeInTheDocument();
  expect(screen.getByText("verified-id")).toBeInTheDocument();
  expect(screen.getByText("123")).toBeInTheDocument();
  expect(screen.getByText(/Older per-key history has expired/)).toBeInTheDocument();
  expect(screen.getByText(/Per-key totals are incomplete/)).toBeInTheDocument();
  expect(screen.getByText(/This is not a billing total/)).toBeInTheDocument();
});
