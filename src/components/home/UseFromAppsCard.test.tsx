import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import type { ClientKeyList } from "@/lib/types";

import { UseFromAppsCard } from "./UseFromAppsCard";

afterEach(() => vi.restoreAllMocks());

function show() {
  render(<UseFromAppsCard models={[]} gatewayPortUrl={null} placement={null} localNode="worker" />);
}

describe("install-wide key registry", () => {
  it("names migrated origins and the revocation bound", async () => {
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
    expect(screen.getByText(/60 seconds old/)).toBeInTheDocument();
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
