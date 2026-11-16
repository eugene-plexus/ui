/**
 * Row 15 (DI2, call DI-C4): the prompt cache on disk on a machine's settings, with Clear.
 * Counts and sizes only, never what the conversations say.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { PromptCacheOnDisk } from "./PromptCacheOnDisk";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), delete: vi.fn() },
  describeError: (e: Error) => e.message,
}));

const MIB = 1024 ** 2;
const KEPT = {
  enabled: true,
  days: 3,
  capBytes: 20 * 1024 ** 3,
  bytes: 340 * MIB,
  conversations: 2,
  oldest: "2026-11-14T10:00:00Z",
  newest: "2026-11-15T10:00:00Z",
  folder: "/var/lib/eugene/prompt-cache",
  runtimes: [{ runtime: "qwen3-8b", conversations: 2, bytes: 340 * MIB }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue(KEPT);
});

it("says what is kept, per model, and where", async () => {
  render(<PromptCacheOnDisk target="node:tower" />);
  expect(await screen.findByText("2 saved conversations, 340 MiB.")).toBeInTheDocument();
  expect(screen.getByText(/qwen3-8b: 2, 340 MiB/)).toBeInTheDocument();
  expect(screen.getByText("/var/lib/eugene/prompt-cache")).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith("node:tower", "/v1/prompt-cache");
});

it("deletes every saved conversation and says how many", async () => {
  vi.mocked(api.delete).mockResolvedValue({
    conversations: 2,
    bytesFreed: 340 * MIB,
    notDeleted: 0,
    reason: null,
  });
  render(<PromptCacheOnDisk target="node:tower" />);
  await screen.findByText("2 saved conversations, 340 MiB.");
  vi.mocked(api.get).mockResolvedValue({ ...KEPT, bytes: 0, conversations: 0, runtimes: [] });
  await userEvent.setup().click(screen.getByRole("button", { name: "Delete saved conversations" }));
  expect(api.delete).toHaveBeenCalledWith("node:tower", "/v1/prompt-cache");
  expect(await screen.findByText("Deleted 2 saved conversations, 340 MiB.")).toBeInTheDocument();
  expect(await screen.findByText("No conversation is saved.")).toBeInTheDocument();
});

it("names the cause when a file was not deleted", async () => {
  vi.mocked(api.delete).mockResolvedValue({
    conversations: 1,
    bytesFreed: MIB,
    notDeleted: 1,
    reason: "1-aaaaaa-s0.bin: Access is denied",
  });
  render(<PromptCacheOnDisk target="agent" />);
  await screen.findByText("2 saved conversations, 340 MiB.");
  await userEvent.setup().click(screen.getByRole("button", { name: "Delete saved conversations" }));
  expect(
    await screen.findByText("1 was not deleted: 1-aaaaaa-s0.bin: Access is denied"),
  ).toBeInTheDocument();
});

it("says a read that failed, in its own words", async () => {
  vi.mocked(api.get).mockRejectedValue(new Error("agent did not answer"));
  render(<PromptCacheOnDisk target="agent" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("agent did not answer");
});
