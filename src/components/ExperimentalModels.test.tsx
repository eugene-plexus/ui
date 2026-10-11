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

it("sends prepared models to the Library instead of posting a runtime (LS3)", () => {
  render(<ExperimentalModels node="worker" rows={[]} />);
  expect(screen.queryByRole("button", { name: "Add prepared Strata model" })).toBeNull();
  expect(screen.queryByLabelText("Prepared config path")).toBeNull();
  expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute("href", "/library");
  expect(api.post).not.toHaveBeenCalled();
});

it("asks the gateway to drain and switch on the selected node", async () => {
  vi.mocked(api.post).mockResolvedValue({ message: "New model is loading" });
  const rows = [
    { engine: "strata", runtime: "old", model: "a", runtimeStatus: "ready" },
    { engine: "strata", runtime: "new", model: "b", runtimeStatus: "stopped" },
  ] as Row[];
  render(<ExperimentalModels node="worker" rows={rows} />);
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
