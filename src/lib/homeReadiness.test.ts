import { describe, expect, it } from "vitest";
import { homeReadiness } from "./homeReadiness";
import type { RoutingTableView } from "./types";

type Backend = RoutingTableView["slots"][number]["tiers"][number]["backends"][number];
const table = (backends: Backend[]): RoutingTableView => ({
  refreshed_at: "2026-09-20T00:00:00Z",
  slots: [{ model: "alias", tiers: [{ target: "actual-model", backends }] }],
});
const backend = (status: string, extra: Partial<Backend> = {}): Backend => ({
  driver: "same-name",
  node: "a",
  eligible: status === "ready",
  runtime_status: status,
  ...extra,
});

describe("Home uses the requested slot's available replicas and fallbacks", () => {
  it("does not confuse the same driver name on two nodes", () => {
    expect(
      homeReadiness("alias", table([backend("crashed"), backend("ready", { node: "b" })])),
    ).toMatchObject({ canSend: true, kind: "ready" });
  });
  it("does not enable a crashed model just because it has start-on-demand enabled", () => {
    expect(
      homeReadiness("alias", table([backend("crashed", { start_on_demand: true })])),
    ).toMatchObject({ canSend: false, kind: "failed" });
  });
  it("lets a stopped on-demand fallback serve while another replica loads", () => {
    expect(
      homeReadiness(
        "alias",
        table([backend("loading"), backend("stopped", { start_on_demand: true })]),
      ),
    ).toMatchObject({ canSend: true, kind: "on-demand" });
  });
  it("fails closed for missing routing, unknown models and stopping runtimes", () => {
    expect(homeReadiness("alias", null).canSend).toBe(false);
    expect(homeReadiness("absent", table([backend("ready")])).canSend).toBe(false);
    expect(homeReadiness("alias", table([backend("stopping")])).canSend).toBe(false);
  });
  it("can use an eligible externally managed backend without runtime facts", () => {
    expect(homeReadiness("alias", table([{ driver: "external", eligible: true }])).canSend).toBe(
      true,
    );
  });
});
