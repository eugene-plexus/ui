import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { standbyWords } from "@/lib/standby";

import { StandbyPanel } from "./StandbyPanel";

vi.mock("@/lib/api", () => ({
  api: { put: vi.fn(), delete: vi.fn() },
  describeError: (e: Error) => e.message,
}));

const NODES = [
  { name: "nas", grants: ["node"] },
  { name: "spare", grants: ["node"] },
];

beforeEach(() => {
  vi.clearAllMocks();
});

it("asks first, saying what the copy holds, then makes the chosen machine the standby", async () => {
  vi.mocked(api.put).mockResolvedValue({});
  const changed = vi.fn();
  render(<StandbyPanel nodes={NODES} standbys={[]} onChanged={changed} />);
  const user = userEvent.setup();
  expect(screen.getByTestId("standby-state")).toHaveTextContent("No machine is the standby.");
  await user.selectOptions(screen.getByTestId("standby-pick"), "spare");
  await user.click(screen.getByRole("button", { name: "Make it the standby" }));
  expect(api.put).not.toHaveBeenCalled();
  expect(screen.getByTestId("standby-ask")).toHaveTextContent("locked keys");
  expect(screen.getByTestId("standby-ask")).toHaveTextContent("guess your passphrase offline");
  await user.click(screen.getByRole("button", { name: "Yes, make it the standby" }));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(api.put).toHaveBeenCalledWith("control", "/v1/nodes/spare/standby", undefined);
});

it("shows the root's refusal in its own words", async () => {
  vi.mocked(api.put).mockRejectedValue(
    new Error("'nas' runs this control root, so a standby there would stop with it."),
  );
  render(<StandbyPanel nodes={NODES} standbys={[]} onChanged={vi.fn()} />);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByTestId("standby-pick"), "nas");
  await user.click(screen.getByRole("button", { name: "Make it the standby" }));
  await user.click(screen.getByRole("button", { name: "Yes, make it the standby" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("runs this control root");
});

it("names the standby with what the root last heard, and stops it after asking", async () => {
  vi.mocked(api.delete).mockResolvedValue(undefined);
  const changed = vi.fn();
  const nodes = [
    { name: "nas", grants: ["node"] },
    { name: "spare", grants: ["node", "standby"] },
  ];
  const heard = new Date(Date.now() - 4000).toISOString();
  render(
    <StandbyPanel
      nodes={nodes}
      standbys={[{ node: "spare", lagEntries: 0, reachable: true, lastContactAt: heard }]}
      onChanged={changed}
    />,
  );
  const user = userEvent.setup();
  expect(screen.getByTestId("standby-state")).toHaveTextContent("spare is the standby.");
  expect(screen.getByTestId("standby-state")).toHaveTextContent("Up to date, last heard");
  await user.click(screen.getByRole("button", { name: "Stop being the standby" }));
  expect(api.delete).not.toHaveBeenCalled();
  expect(screen.getByTestId("standby-ask")).toHaveTextContent("copy is deleted");
  await user.click(screen.getByRole("button", { name: "Yes, stop it" }));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(api.delete).toHaveBeenCalledWith("control", "/v1/nodes/spare/standby");
});

it("says each state the root reports, and never guesses", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  const at = (seconds: number) => new Date(now - seconds * 1000).toISOString();
  expect(standbyWords({ node: "spare" }, now)).toMatch(/^Not heard from yet/);
  expect(
    standbyWords({ node: "spare", lastContactAt: at(30), reachable: true, lagEntries: 0 }, now),
  ).toBe("Up to date, last heard 30 s ago.");
  expect(
    standbyWords({ node: "spare", lastContactAt: at(30), reachable: true, lagEntries: 3 }, now),
  ).toBe("3 changes behind, last heard 30 s ago.");
  expect(
    standbyWords({ node: "spare", lastContactAt: at(30), reachable: true, lagEntries: 1 }, now),
  ).toBe("1 change behind, last heard 30 s ago.");
  expect(
    standbyWords({ node: "spare", lastContactAt: at(600), reachable: false, lagEntries: 0 }, now),
  ).toMatch(/^Last heard 10 min ago\. Check that spare is on/);
});
