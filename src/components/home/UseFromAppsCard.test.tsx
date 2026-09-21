import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import type { ClientKeyList } from "@/lib/types";

import { UseFromAppsCard } from "./UseFromAppsCard";

afterEach(() => vi.restoreAllMocks());

function show() {
  render(<UseFromAppsCard models={[]} gatewayPortUrl={null} placement={null} localNode="worker" />);
}

describe("install-wide key registry", () => {
  it("names migrated origins and the admission dependency", async () => {
    const registry: ClientKeyList = {
      keys: [
        {
          id: "old",
          name: "Laptop",
          tail: "sample",
          createdAt: "2026-09-01T00:00:00Z",
          expiresAt: "2099-09-01T00:00:00Z",
          migrated: true,
          originNode: "nas",
        },
      ],
      scope: "install",
      migration: "complete",
      detail: "Existing keys are registered install-wide.",
    };
    const get = vi.spyOn(api, "get").mockResolvedValue(registry);
    show();
    expect(await screen.findByText("migrated from nas")).toBeInTheDocument();
    expect(screen.getByTestId("key-migration")).toHaveTextContent("registered install-wide");
    expect(screen.getByText(/Client requests need the active key authority/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("agent", "/v1/auth/client-keys");
  });

  it("shows migration trouble and refreshes after recovery", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue({
      keys: [],
      scope: "install",
      migration: "error",
      detail: "Existing keys could not be registered. Restore the control connection.",
    });
    show();
    expect(await screen.findByTestId("key-migration")).toHaveTextContent("could not be registered");
    get.mockResolvedValue({
      keys: [],
      scope: "install",
      migration: "complete",
      detail: "Existing keys are registered install-wide.",
    });
    fireEvent.click(screen.getByText("Refresh key status"));
    expect(
      await screen.findByText("Existing keys are registered install-wide."),
    ).toBeInTheDocument();
  });

  it("reports authority failure without claiming an empty healthy registry", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new Error("Client-key authority unavailable"));
    show();
    expect(await screen.findByTestId("key-error")).toHaveTextContent("authority unavailable");
    expect(screen.getByText(/Registry status has not been confirmed/)).toBeInTheDocument();
    expect(screen.queryByTestId("key-migration")).not.toBeInTheDocument();
  });
});

it("makes a scoped key with the chosen limits", async () => {
  vi.spyOn(api, "get").mockResolvedValue({ keys: [], scope: "install" });
  const post = vi.spyOn(api, "post").mockResolvedValue({ key: { id: "new" }, token: "shown-once" });
  show();
  await screen.findByText("Keys and revocations apply to every gateway in this install.", {
    exact: false,
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByRole("textbox", { name: /Allowed model IDs/ }), {
    target: { value: "alias\nactual\nactual" },
  });
  fireEvent.change(screen.getByLabelText("Concurrent requests"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Requests per minute"), { target: { value: "12" } });
  fireEvent.click(screen.getByTestId("make-key"));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("agent", "/v1/auth/client-keys", {
      name: "My app",
      limits: {
        allowedModels: ["alias", "actual"],
        maxConcurrentRequests: 1,
        requestsPerMinute: 12,
      },
    }),
  );
  expect(await screen.findByTestId("fresh-key")).toHaveTextContent("shown-once");
});

it("makes legacy access explicit and edits limits without minting another token", async () => {
  const key = {
    id: "legacy",
    name: "Old app",
    tail: "sample",
    createdAt: "2026-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
  };
  const get = vi.spyOn(api, "get").mockResolvedValue({ keys: [key], scope: "install" });
  const put = vi.spyOn(api, "put").mockResolvedValue({});
  const post = vi.spyOn(api, "post");
  show();
  expect(await screen.findByText(/Legacy \/ unrestricted/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Set limits"));
  const row = screen.getByTestId("key-list");
  fireEvent.click(within(row).getByRole("checkbox"));
  get.mockResolvedValue({
    keys: [
      { ...key, limits: { allowedModels: [], maxConcurrentRequests: 2, requestsPerMinute: 60 } },
    ],
    scope: "install",
  });
  fireEvent.click(within(row).getByText("Save limits"));
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith("agent", "/v1/auth/client-keys/legacy/limits", {
      limits: { allowedModels: [], maxConcurrentRequests: 2, requestsPerMinute: 60 },
    }),
  );
  expect(await screen.findByText(/No models allowed/)).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});
