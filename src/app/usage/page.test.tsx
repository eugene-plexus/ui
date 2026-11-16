/**
 * The Usage page (row 40), driven: it reads the root's usage and prices and
 * the gateway's served models, says a spent allowance and an unknown price
 * plainly, and sends an owner's rate as exact micro-dollars.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import UsagePage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/usage",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, controls }: { children: ReactNode; controls?: ReactNode }) => (
    <div data-testid="shell">
      {controls}
      {children}
    </div>
  ),
}));

const zero = {
  requests: 0,
  promptTokens: 0,
  completionTokens: 0,
  tokens: 0,
  costUsd: "0.000000000000",
  unpricedRequests: 0,
  models: [],
};

const REPORT = {
  day: "2026-11-16",
  month: "2026-11",
  kept: { days: 62, months: 13 },
  subjects: [
    {
      kind: "group",
      id: "g1",
      name: "Sales",
      day: zero,
      month: {
        requests: 3,
        promptTokens: 1000,
        completionTokens: 500,
        tokens: 1500,
        costUsd: "4.010000000000",
        unpricedRequests: 1,
        models: [],
      },
      allowances: [
        {
          kind: "costPerMonth",
          limit: "4.000000000000",
          used: "4.010000000000",
          left: "0.000000000000",
          spent: true,
          resetsAt: "2026-12-01T00:00:00Z",
        },
      ],
    },
  ],
};

const MODELS = {
  object: "list",
  data: [
    {
      id: "cloud/x",
      object: "model",
      x_eugene_plexus: { locality: "external", drivers: [], backends: [] },
    },
    {
      id: "local-m",
      object: "model",
      x_eugene_plexus: { locality: "local", drivers: [], backends: [] },
    },
  ],
};

let calls: { url: string; method: string; body?: string }[] = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      if (url.includes("/v1/usage/prices")) {
        if (init?.method === "PUT") {
          return json({
            prices: [
              {
                model: "local-m",
                inputPerMillionMicros: 100_000,
                outputPerMillionMicros: 2_500_000,
              },
            ],
          });
        }
        return json({ prices: [] });
      }
      if (url.includes("/v1/usage")) return json(REPORT);
      if (url.includes("/v1/models")) return json(MODELS);
      return new Response("{}", { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Usage page", () => {
  it("says a spent allowance and what an unpriced request is", async () => {
    render(<UsagePage />);
    const group = await screen.findByTestId("usage-group-g1");
    expect(within(group).getByText(/Month: 1,500 tokens · 3 requests · \$4\.01/)).toBeTruthy();
    expect(within(group).getByText(/with no price, cost unknown/)).toBeTruthy();
    expect(within(group).getByText(/\$4\.01 of \$4\.00 this month\. Spent/)).toBeTruthy();
    expect(await screen.findByText(/cost unknown, refused under a spend limit/)).toBeTruthy();
    expect(screen.getByText(/No price set: counted as free/)).toBeTruthy();
  });

  it("sends an owner's rate as exact micro-dollars", async () => {
    const user = userEvent.setup();
    render(<UsagePage />);
    const row = await screen.findByTestId("price-local-m");
    await user.type(within(row).getByLabelText("local-m input price"), "0.1");
    await user.type(within(row).getByLabelText("local-m output price"), "2.5");
    await user.click(within(row).getByRole("button", { name: "Set rate" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.method === "PUT");
    expect(JSON.parse(put?.body ?? "{}")).toEqual({
      model: "local-m",
      price: { inputPerMillionMicros: 100_000, outputPerMillionMicros: 2_500_000 },
    });
    expect(await screen.findByText(/Your rate: \$0\.10 in · \$2\.50 out/)).toBeTruthy();
  });
});
