import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServingMeasurements } from "./ServingMeasurements";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: mocks, describeError: (e: unknown) => String(e) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("measure people served", () => {
  it("opens the record selected by the task tray", async () => {
    mocks.get.mockResolvedValue({
      measurements: [
        {
          id: "chosen",
          node: "tower",
          runtime: "r",
          state: "running",
          detail: "2 people: 5 seconds",
          levels: [],
          knee: null,
          request: { workload: "agents" },
          restarts: [],
        },
      ],
    });
    render(<ServingMeasurements runtime="r" node="tower" slots={2} openId="chosen" />);
    expect(await screen.findByRole("region", { name: "Measure r" })).toBeInTheDocument();
  });
  it("reviews effective settings and requires consent to stop replicas", async () => {
    mocks.get.mockResolvedValue({ measurements: [] });
    mocks.post.mockResolvedValue({
      otherReplicas: [{ node: "studio", runtime: "copy", model: "m" }],
      otherRuntimes: [],
      problems: [],
      estimateSeconds: 900,
    });
    render(<ServingMeasurements runtime="r" node="tower" slots={2} />);
    fireEvent.click(screen.getByText("Measure people served"));
    expect(screen.getByLabelText("Up to people")).toHaveValue(8);
    fireEvent.change(screen.getByLabelText("Workload"), { target: { value: "streams" } });
    expect(screen.getByLabelText("Seconds per level")).toHaveValue(120);
    fireEvent.click(screen.getByLabelText("Full hour per level"));
    expect(screen.getByLabelText("Seconds per level")).toHaveValue(3600);
    fireEvent.change(screen.getByLabelText("First token ceiling (ms)"), {
      target: { value: "1500" },
    });
    fireEvent.click(screen.getByText("Review measurement"));
    await screen.findByText(/copy on studio/);
    expect(screen.getByText("Start measurement")).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Stop these other copies/));
    fireEvent.click(screen.getByText("Start measurement"));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        "node:tower",
        "/v1/serving-measurements",
        expect.objectContaining({
          maxPeople: 8,
          windowSeconds: 3600,
          full: true,
          ttftThresholdMs: 1500,
          stopReplicas: [{ node: "studio", runtime: "copy", model: "m" }],
        }),
      ),
    );
  });
});
