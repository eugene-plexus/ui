import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "@/lib/api";
import type { UpdateAllRun } from "@/lib/types";
import { UpdateAllPanel } from "./UpdateAllPanel";

const job: UpdateAllRun = {
  id: "one",
  root: "nas",
  startedAt: "2026-10-15T15:00:00Z",
  expiresAt: "2026-10-15T17:00:00Z",
  state: "running",
  items: [{ node: "nas", kind: "node", state: "updating", detail: "Waiting for restart" }],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Update all", () => {
  it("requires one confirmation and sends one install-wide action", async () => {
    vi.spyOn(api, "get").mockResolvedValue({});
    const post = vi.spyOn(api, "post").mockResolvedValue(job);
    render(<UpdateAllPanel onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("update-all")).toBeEnabled());
    fireEvent.click(screen.getByTestId("update-all"));
    expect(post).not.toHaveBeenCalled();
    expect(screen.getByText(/Models and apps stop/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Start updates"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledExactlyOnceWith("agent", "/v1/updates/all", {}),
    );
    expect(await screen.findByText(/You can close this page/)).toBeInTheDocument();
    expect(screen.getByTestId("update-all")).toBeDisabled();
  });

  it("restores progress when reopening and refreshes versions on completion", async () => {
    vi.useFakeTimers();
    const get = vi.spyOn(api, "get").mockResolvedValue({ run: job });
    const changed = vi.fn();
    render(<UpdateAllPanel onChanged={changed} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("nas: Updating")).toBeInTheDocument();
    get.mockResolvedValue({
      run: {
        ...job,
        state: "complete",
        items: [{ ...job.items[0], state: "updated", detail: "Back online" }],
      },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(
      screen.getByText(/All machines and installed catalogue apps are current/),
    ).toBeInTheDocument();
    expect(changed).toHaveBeenCalledOnce();
  });

  it("keeps the last progress while the agent restarts", async () => {
    vi.useFakeTimers();
    const get = vi.spyOn(api, "get").mockResolvedValue({ run: job });
    render(<UpdateAllPanel onChanged={() => {}} />);
    await act(async () => {
      await Promise.resolve();
    });
    get.mockRejectedValue(new Error("Connection refused"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText("nas: Updating")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Waiting to reconnect");
    expect(screen.getByTestId("update-all")).toBeDisabled();
  });

  it("does not offer an action an older agent cannot perform", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new ApiError(404, "Not Found", {}));
    render(<UpdateAllPanel onChanged={() => {}} />);
    expect(await screen.findByText(/once to enable Update all/)).toBeInTheDocument();
    expect(screen.getByTestId("update-all")).toBeDisabled();
  });

  it("reports manual and failed machines without claiming all are current", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      run: {
        ...job,
        state: "attention",
        items: [
          { node: "nas", kind: "node", state: "manual", detail: "Pull the container image" },
          { node: "desktop", kind: "node", state: "skipped", detail: "Update the root first" },
        ],
      },
    });
    render(<UpdateAllPanel onChanged={() => {}} />);
    expect(
      await screen.findByText("Updates finished with items needing attention."),
    ).toBeInTheDocument();
    expect(screen.getByText("nas: Manual update needed")).toBeInTheDocument();
    expect(screen.getByText("desktop: Not updated")).toBeInTheDocument();
    expect(screen.queryByText(/All machines and installed catalogue apps are current/)).toBeNull();
  });
});
