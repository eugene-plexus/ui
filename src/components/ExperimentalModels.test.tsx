import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ExperimentalModels } from "./ExperimentalModels";
import { api } from "@/lib/api";
import type { Row } from "@/lib/inferenceRows";

vi.mock("@/lib/api", () => ({ api: { post: vi.fn() }, describeError: (e: Error) => e.message }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("saves a separate stopped runtime with an explicit model alias", async () => {
  vi.mocked(api.post).mockResolvedValue({});
  render(<ExperimentalModels target="node:worker" node="worker" rows={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Add prepared Strata model" }));
  fireEvent.change(screen.getByLabelText("Saved name"), { target: { value: "qwen-small" } });
  fireEvent.change(screen.getByLabelText("Model alias"), { target: { value: "qwen-fast" } });
  fireEvent.change(screen.getByLabelText("Prepared config path"), {
    target: { value: "D:\\Models\\qwen.json" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save model" }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      "node:worker",
      "/v1/runtimes",
      expect.objectContaining({
        engine: "strata",
        name: "qwen-small",
        modelAlias: "qwen-fast",
        autoStart: false,
        startOnDemand: false,
      }),
    ),
  );
  expect(await screen.findByRole("status")).toHaveTextContent("Saved qwen-fast");
});

it("asks the gateway to drain and switch on the selected node", async () => {
  vi.mocked(api.post).mockResolvedValue({ message: "New model is loading" });
  const rows = [
    { engine: "strata", runtime: "old", model: "a", runtimeStatus: "ready" },
    { engine: "strata", runtime: "new", model: "b", runtimeStatus: "stopped" },
  ] as Row[];
  render(<ExperimentalModels target="node:worker" node="worker" rows={rows} />);
  fireEvent.change(screen.getByLabelText("Model to stop"), { target: { value: "old" } });
  fireEvent.change(screen.getByLabelText("Model to start"), { target: { value: "new" } });
  fireEvent.click(screen.getByRole("button", { name: "Switch model" }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith("gateway", "/v1/runtimes/switch", {
      node: "worker",
      source: "old",
      target: "new",
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent("loading");
});
