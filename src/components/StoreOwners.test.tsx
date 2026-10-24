import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { shortDate } from "@/lib/storeOwners";

import { StoreOwners } from "./StoreOwners";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  describeError: (e: Error) => e.message,
}));

const REMOVED_AT = Date.UTC(2026, 9, 20) / 1000;
const DELETE_AT = REMOVED_AT + 30 * 86400;

function answers({ removed = false } = {}) {
  vi.mocked(api.get).mockImplementation(async (target: string, path: string) => {
    if (target === "store" && path === "/v1/owners") {
      return {
        owners: [
          { owner: "person:p1", files: 3, bytes: 42 * 1024 * 1024, uploads: 1 },
          { owner: "key:k1", files: 1, bytes: 512, uploads: 0 },
          ...(removed
            ? [
                {
                  owner: "person:gone",
                  files: 2,
                  bytes: 2048,
                  uploads: 0,
                  removedAt: REMOVED_AT,
                  deleteAt: DELETE_AT,
                },
              ]
            : []),
        ],
        files: removed ? 6 : 4,
        bytes: 42 * 1024 * 1024 + 512,
        blobBytes: 42 * 1024 * 1024,
      };
    }
    if (target === "store" && path === "/v1/store/status") {
      return {
        parts: { files: true },
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
  expect(screen.queryByTestId("store-removed")).toBeNull();
  // Only counts were asked for: no file list, no content.
  const asked = vi.mocked(api.get).mock.calls.map(([target, path]) => `${target} ${path}`);
  expect(asked.filter((a) => a.startsWith("store"))).toEqual([
    "store /v1/owners",
    "store /v1/store/status",
  ]);
});

it("lists a removed person's files with their delete date, and asks before Delete now", async () => {
  answers({ removed: true });
  vi.mocked(api.post).mockResolvedValue({});
  render(<StoreOwners />);
  const removed = await screen.findByTestId("store-removed-person");
  expect(removed).toHaveTextContent("A removed or unknown person");
  expect(removed).toHaveTextContent("2 files");
  expect(removed).toHaveTextContent(`removed ${shortDate(REMOVED_AT)}`);
  expect(removed).toHaveTextContent(`deleted on ${shortDate(DELETE_AT)}`);
  // Hidden people are not among the owners whose files are in use.
  expect(screen.getAllByTestId("store-owner")).toHaveLength(2);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Delete now: A removed or unknown person" }));
  expect(api.post).not.toHaveBeenCalled();
  expect(screen.getByTestId("store-removed")).toHaveTextContent("This cannot be undone");
  const buttons = screen.getAllByRole("button");
  await user.click(buttons.find((b) => b.textContent === "Delete now")!);
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith("store", "/v1/removals/delete", {
      owner: "person:gone",
    }),
  );
});

it("says the store did not answer, in its own words", async () => {
  vi.mocked(api.get).mockRejectedValue(new Error("Target not in topology"));
  render(<StoreOwners />);
  expect(await screen.findByTestId("store-owners-error")).toHaveTextContent(
    "The store did not answer: Target not in topology",
  );
});
