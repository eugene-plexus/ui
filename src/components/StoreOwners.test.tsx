import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { StoreOwners } from "./StoreOwners";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  describeError: (e: Error) => e.message,
}));

function answers(held: string[] = []) {
  vi.mocked(api.get).mockImplementation(async (target: string, path: string) => {
    if (target === "store" && path === "/v1/owners") {
      return {
        owners: [
          { owner: "person:p1", files: 3, bytes: 42 * 1024 * 1024, uploads: 1 },
          { owner: "key:k1", files: 1, bytes: 512, uploads: 0 },
        ],
        files: 4,
        bytes: 42 * 1024 * 1024 + 512,
        blobBytes: 42 * 1024 * 1024,
      };
    }
    if (target === "store" && path === "/v1/store/status") {
      return {
        parts: { files: true },
        held,
        lastSweep: {
          at: "2026-10-23T00:00:00Z",
          files: 0,
          uploads: 0,
          parts: 0,
          blobs: 0,
          freedBytes: 0,
        },
      };
    }
    if (target === "control") return { people: [{ id: "p1", name: "ann", displayName: "Ann" }] };
    if (target === "agent") return { keys: [{ id: "k1", name: "Open WebUI" }] };
    throw new Error(`unexpected ${target} ${path}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

it("shows how much each owner keeps, by name, and nothing of what", async () => {
  answers();
  render(<StoreOwners />);
  const rows = await screen.findAllByTestId("store-owner");
  await waitFor(() => expect(rows[0]).toHaveTextContent("Ann"));
  expect(rows[0]).toHaveTextContent("3 (+1 uploading)");
  expect(rows[0]).toHaveTextContent("42 MiB");
  expect(rows[1]).toHaveTextContent('App key "Open WebUI"');
  expect(screen.getByTestId("store-sweep")).toHaveTextContent("Nothing had ended");
  expect(screen.queryByTestId("store-held")).toBeNull();
  // Only counts were asked for: no file list, no content.
  const asked = vi.mocked(api.get).mock.calls.map(([target, path]) => `${target} ${path}`);
  expect(asked.filter((a) => a.startsWith("store"))).toEqual([
    "store /v1/owners",
    "store /v1/store/status",
  ]);
});

it("asks before deleting what held removed people kept", async () => {
  answers(["person:x", "person:y", "person:z"]);
  vi.mocked(api.post).mockResolvedValue({});
  render(<StoreOwners />);
  const held = await screen.findByTestId("store-held");
  expect(held).toHaveTextContent("3 removed people's files are kept until you choose");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Delete their files" }));
  expect(api.post).not.toHaveBeenCalled();
  const buttons = screen.getAllByRole("button");
  await user.click(buttons.find((b) => b.textContent === "Delete their files")!);
  await waitFor(() => expect(api.post).toHaveBeenCalledWith("store", "/v1/removals/release", {}));
});

it("says the store did not answer, in its own words", async () => {
  vi.mocked(api.get).mockRejectedValue(new Error("Target not in topology"));
  render(<StoreOwners />);
  expect(await screen.findByTestId("store-owners-error")).toHaveTextContent(
    "The store did not answer: Target not in topology",
  );
});
