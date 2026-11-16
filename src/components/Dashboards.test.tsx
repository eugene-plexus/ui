import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WakeCost } from "./GatewayOperations";
import { wakeCost } from "@/lib/gatewayDashboard";

// Three models a person woke over the window (row 38). Ranked by starts alone
// it would read small, chat, big; what the waits cost is big, chat, small.
const GROUPS = [
  { model: "small", node: "tower", runtime: "small-rt", swappedIn: 30, waitedMsSum: 15_000 },
  { model: "chat", node: "tower", runtime: "chat-rt", swappedIn: 10, waitedMsSum: 20_000 },
  { model: "big", node: "nas", runtime: "big-rt", swappedIn: 2, waitedMsSum: 60_000 },
  { model: "warm", node: "nas", runtime: "warm-rt", swappedIn: 0, waitedMsSum: 0 },
];

describe("wake cost", () => {
  it("ranks models by starts times wait, not by starts", () => {
    const rows = wakeCost(GROUPS, { tower: 300, nas: 450 });
    expect(rows.map((r) => r.model)).toEqual(["big", "chat", "small"]);
    expect(rows[0]).toMatchObject({ starts: 2, waitMs: 60_000, meanWaitMs: 30_000 });
    // 60 s at 450 W is 7.5 Wh.
    expect(rows[0]!.energyWh).toBe(7.5);
  });

  it("says when a wait was not kept, and does not count it as zero", () => {
    const rows = wakeCost([
      { model: "chat", node: "tower", swappedIn: 4, waitedMsSum: 0, source: "rollup" },
      { model: "chat", node: "tower", swappedIn: 1, waitedMsSum: 3000, source: "raw" },
    ]);
    expect(rows[0]).toMatchObject({ starts: 5, unknownStarts: 4, meanWaitMs: 3000 });
    expect(rows[0]!.energyWh).toBeNull();
  });

  it("shows the costliest first, with keep loaded one click away", () => {
    render(<WakeCost groups={GROUPS} powerWatts={{ tower: 300, nas: 450 }} />);
    const table = screen.getByRole("table", { name: "Wake cost by model" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0]!.textContent)).toEqual([
      "big",
      "chat",
      "small",
    ]);
    expect(within(rows[0]!).getByText("30.0 s")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("about 7.5 Wh")).toBeInTheDocument();
    const keep = within(rows[0]!).getByRole("link", { name: /Keep big loaded/ });
    expect(keep.getAttribute("href")).toBe(
      `/inference?sel=${encodeURIComponent("backends:node:nas")}`,
    );
  });

  it("says plainly when nothing was woken", () => {
    render(<WakeCost groups={[GROUPS[3]!]} powerWatts={{}} />);
    expect(screen.getByText("No request had to wait for a model to start.")).toBeInTheDocument();
  });
});
