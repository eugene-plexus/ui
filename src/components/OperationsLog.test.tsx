import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { OperationsLog, operationSentence } from "./OperationsLog";

afterEach(() => vi.restoreAllMocks());

const row = {
  at: "2026-11-15T14:05:00Z",
  component: "agent",
  personId: "p-dana",
  name: "Dana",
  owner: false,
  power: "operate-models",
  action: "stop runtime",
  target: "qwen3-32b",
  status: 202,
};

it("names who did what to what", () => {
  expect(operationSentence(row).startsWith("Dana (delegated): stop runtime qwen3-32b, ")).toBe(
    true,
  );
  expect(operationSentence({ ...row, status: 409 }).endsWith("(refused, 409)")).toBe(true);
});

it("tells the owner's rows from the owner flag, never from a name", () => {
  // Row 39 review: a person called "Owner" cannot pass as the owner.
  expect(operationSentence({ ...row, name: "Owner" }).startsWith("Owner (delegated): ")).toBe(true);
  expect(operationSentence({ ...row, name: "Owner", owner: true }).startsWith("The owner: ")).toBe(
    true,
  );
});

it("reads one machine's record through its own agent", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue({ entries: [row] });
  render(<OperationsLog target="node:gpu-a" label="Big GPU" />);
  expect(await screen.findByText(/Dana .delegated.: stop runtime qwen3-32b/)).toBeVisible();
  expect(get).toHaveBeenCalledWith("node:gpu-a", "/v1/node/operations-log?limit=50");
});
