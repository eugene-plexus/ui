import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { LibraryServices } from "./LibraryServices";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: { get: vi.fn(), post: vi.fn() },
}));
afterEach(() => vi.resetAllMocks());

it("shows the Library on its own machine and restarts it through that machine", async () => {
  vi.mocked(api.get).mockResolvedValue({
    components: [
      { name: "library", kind: "library", status: "crashed", lastError: "connection refused" },
    ],
  });
  render(<LibraryServices target="node:nas" />);
  expect(
    await screen.findByText("The Library is not answering (connection refused)."),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Restart Library" }));
  expect(api.post).toHaveBeenCalledWith("node:nas", "/v1/components/library/restart", {});
});

it("reads the gateway's saved-settings state on its card", async () => {
  vi.mocked(api.get).mockImplementation(async (_target, path) =>
    path === "/v1/components"
      ? { components: [{ name: "gateway", kind: "gateway", status: "running" }] }
      : {
          library: {
            reachable: false,
            since: null,
            cause: "connection refused",
            modelsOnSavedSettings: 3,
          },
        },
  );
  render(<LibraryServices target="node:desk" />);
  expect(
    await screen.findByText(
      "The Library is not answering. 3 models use their last known settings.",
    ),
  ).toBeVisible();
  expect(api.get).toHaveBeenCalledWith("node:desk", "/api/proxy/gateway/v1/info");
});
