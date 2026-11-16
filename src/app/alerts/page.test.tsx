/**
 * The Alerts page (row 38): what fired leads, the settings come after; the
 * webhook's address is never shown back; a person with an operations power
 * reads alerts and gets no settings.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearOperationsSession, setOperationsSession } from "@/lib/operations";

import AlertsPage from "./page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/alerts",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

const VIEW = {
  evaluating: true,
  evaluatedAt: "2026-11-16T12:00:00Z",
  problems: ["Host history of nas: no answer"],
  firing: [
    {
      id: "gpu-hot:tower:gpu:cuda:0",
      ruleId: "gpu-hot",
      kind: "gpu-hot",
      state: "firing",
      message: "RTX 5090 on tower is at 88 °C",
      value: 88,
      threshold: 85,
      machine: "tower",
      link: "/hosts?sel=agent%3Atower",
      startedAt: "2026-11-16T11:55:00Z",
    },
  ],
  recent: [],
  slos: [],
  webhook: { state: "failing", lastError: "connection refused" },
};

const SETTINGS = {
  defaults: false,
  rules: [{ id: "gpu-hot", kind: "gpu-hot", enabled: true, threshold: 85, forMinutes: 5 }],
  slos: [],
  webhook: { configured: true, host: "hooks.lan" },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let puts: unknown[];

beforeEach(() => {
  puts = [];
  sessionStorage.clear();
  clearOperationsSession();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = decodeURIComponent(String(input));
      if (url.endsWith("/control/v1/alerts")) return json(VIEW);
      if (url.endsWith("/control/v1/alerting") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        return json({ ...SETTINGS, rules: body.rules, slos: body.slos });
      }
      if (url.endsWith("/control/v1/alerting")) return json(SETTINGS);
      if (url.endsWith("/control/v1/nodes")) return json({ nodes: [{ name: "tower" }] });
      return json({});
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearOperationsSession();
});

describe("the Alerts page", () => {
  it("leads with what fired, in one line, then the rules", async () => {
    render(<AlertsPage />);
    expect(await screen.findByRole("heading", { level: 1, name: "1 alert firing." })).toBeTruthy();
    const firing = screen.getByRole("region", { name: "Firing now" });
    expect(within(firing).getByText("RTX 5090 on tower is at 88 °C")).toBeTruthy();
    expect(screen.getByText(/1 read failed in the last check/)).toBeTruthy();
    const rules = await screen.findByRole("region", { name: "Rules" });
    // Data before settings: the firing list comes first in the page.
    expect(firing.compareDocumentPosition(rules) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      await screen.findByText("The webhook at hooks.lan did not answer: connection refused."),
    ).toBeTruthy();
  });

  it("saves the rules it shows, and shows what the root answered", async () => {
    render(<AlertsPage />);
    const rule = await screen.findByRole("group", { name: "Rule gpu-hot" });
    fireEvent.change(within(rule).getByLabelText("Temperature, °C"), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rules and targets" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    const body = puts[0] as { rules: { threshold: number }[]; webhookUrl?: unknown };
    expect(body.rules[0]!.threshold).toBe(80);
    expect("webhookUrl" in body).toBe(false); // absent keeps the webhook
    expect(await screen.findByText("Saved.")).toBeTruthy();
  });

  it("gives a person with an operations power the alerts and no settings", async () => {
    setOperationsSession({ token: "t", name: "Dana", powers: ["operate-models"] });
    render(<AlertsPage />);
    expect(await screen.findByText("RTX 5090 on tower is at 88 °C")).toBeTruthy();
    expect(
      screen.getByText("The owner sets the rules, the SLO targets and where alerts are sent."),
    ).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Rules" })).toBeNull();
  });
});
