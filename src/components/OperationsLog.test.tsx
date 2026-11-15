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
  expect(operationSentence(row)).toMatch(/^Dana: stop runtime qwen3-32b, /);
  expect(operationSentence({ ...row, status: 409 })).toMatch(/\(refused, 409\)$/);
});

it("reads one machine's record through its own agent", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue({ entries: [row] });
  render(<OperationsLog target="node:gpu-a" label="Big GPU" />);
  expect(await screen.findByText(/Dana: stop runtime qwen3-32b/)).toBeVisible();
  expect(get).toHaveBeenCalledWith("node:gpu-a", "/v1/node/operations-log?limit=50");
});
