import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi, it, expect } from "vitest";

import { api } from "@/lib/api";
import { AppMemoryModel } from "./AppMemoryModel";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), patch: vi.fn() },
  describeError: (e: Error) => e.message,
}));

it("keeps the effective model unset while offering advice and an expert choice", async () => {
  vi.mocked(api.get).mockImplementation(async (_target, path) =>
    path === "/v1/apps/hindsight"
      ? { settings: { memoryModel: "my-untested-model" }, status: "starting" }
      : {
          data: [{ id: "untested", x_eugene_plexus: { surfaces: ["chat"] } }],
        },
  );
  let finish!: (value: { memoryModel: string }) => void;
  vi.mocked(api.patch).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const saved = vi.fn();
  render(
    <AppMemoryModel
      target="node:box"
      appId="hindsight"
      settings={{ memoryModel: null }}
      status="exited"
      onSaved={saved}
    />,
  );
  expect(screen.getByText("Choose the model Hindsight reads your chats with")).toBeInTheDocument();
  expect(await screen.findByRole("option", { name: "untested" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Model id (expert)"), {
    target: { value: "my-untested-model" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply model" }));
  expect(screen.getByText("Choose the model Hindsight reads your chats with")).toBeInTheDocument();
  await waitFor(() =>
    expect(api.patch).toHaveBeenCalledWith("node:box", "/v1/apps/hindsight/settings", {
      memoryModel: "my-untested-model",
    }),
  );
  finish({ memoryModel: "my-untested-model" });
  await waitFor(() =>
    expect(saved).toHaveBeenCalledWith({ memoryModel: "my-untested-model" }, "starting"),
  );
  expect(screen.getByTestId("memory-model-effective")).toHaveTextContent(
    "Saved: my-untested-model. Starting.",
  );
});

it("reads the effective selection after a failure and names its cause", async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [] });
  vi.mocked(api.patch).mockRejectedValue(new Error("pg0 stop refused: permission denied"));
  vi.mocked(api.get).mockImplementation(async (_target, path) =>
    path === "/v1/apps/hindsight"
      ? { settings: { memoryModel: "old" }, status: "running" }
      : { data: [] },
  );
  render(
    <AppMemoryModel
      target="agent"
      appId="hindsight"
      settings={{ memoryModel: "old" }}
      status="running"
      onSaved={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Model id (expert)"), { target: { value: "new" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply model" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("permission denied");
  expect(screen.getByTestId("memory-model-effective")).toHaveTextContent("old");
});

it("shows a saved model as stopped", () => {
  vi.mocked(api.get).mockResolvedValue({ data: [] });
  render(
    <AppMemoryModel
      target="agent"
      appId="hindsight"
      settings={{ memoryModel: "saved" }}
      status="exited"
      onSaved={vi.fn()}
    />,
  );
  expect(screen.getByTestId("memory-model-effective")).toHaveTextContent(
    "Saved: saved. Not running.",
  );
  expect(screen.queryByText("Model in effect: saved")).not.toBeInTheDocument();
});

it("reads running state after a restart failure instead of presenting the saved model as effective", async () => {
  vi.mocked(api.get).mockImplementation(async (_target, path) =>
    path === "/v1/apps/hindsight"
      ? { settings: { memoryModel: "new" }, status: "crashed" }
      : path.endsWith("/settings")
        ? { memoryModel: "new" }
        : { data: [] },
  );
  vi.mocked(api.patch).mockRejectedValue(new Error("Restart failed: address in use"));
  render(
    <AppMemoryModel
      target="agent"
      appId="hindsight"
      settings={{ memoryModel: "old" }}
      status="running"
      onSaved={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Model id (expert)"), { target: { value: "new" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply model" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("address in use");
  await waitFor(() =>
    expect(screen.getByTestId("memory-model-effective")).toHaveTextContent(
      "Saved: new. Not running.",
    ),
  );
  expect(screen.queryByText("Model in effect: new")).not.toBeInTheDocument();
});
