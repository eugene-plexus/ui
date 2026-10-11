/**
 * LS8: Delete a model, any format. What the confirmation says before
 * anything goes, what it refuses, and what it sends.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { DeleteModel, blockedBy, isRunning } from "./DeleteModel";
import { api } from "@/lib/api";
import type { TargetNode } from "@/lib/nodeBudget";
import type { LibraryModel, ModelDeletion, Runtime } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  describeError: (e: Error) => e.message,
}));
afterEach(cleanup);

const MODEL = {
  id: "gguf",
  path: "D:\\Models\\Flash-IQ2_XS.gguf",
  format: "gguf",
  name: "Flash-IQ2_XS",
  status: "present",
} as LibraryModel;

const PLAN: ModelDeletion = {
  modelId: "gguf",
  files: [{ path: "D:\\Models\\Flash-IQ2_XS.gguf", role: "weights", sizeBytes: 68_000_000_000 }],
  kept: [
    {
      path: "D:\\Models\\mmproj.gguf",
      sizeBytes: 1_000,
      usedBy: [{ id: "q8", name: "Flash-Q8_0" }],
    },
  ],
  bytesFreed: 68_000_000_000,
  profiles: 2,
  preparedFrom: [{ id: "prep", name: "flash-iq2", bytesFreed: 2_400_000_000 }],
  token: "t1",
};

function node(name: string, target: string): TargetNode {
  return {
    name,
    label: name,
    local: target === "agent",
    target,
    reachable: true,
    lastError: null,
    budget: null,
  };
}

function runtime(status: Runtime["status"], name = "flash"): Runtime {
  return { name, status, modelPath: MODEL.path } as Runtime;
}

let runtimesBy: Record<string, Runtime[]>;

beforeEach(() => {
  runtimesBy = { agent: [runtime("stopped")], "node:nas": [] };
  vi.mocked(api.get).mockImplementation(async (target: string, path: string) => {
    if (path.endsWith("/deletion")) return PLAN;
    if (path === "/v1/runtimes") return { runtimes: runtimesBy[target] ?? [] };
    throw new Error(`unexpected ${target}${path}`);
  });
  vi.mocked(api.post).mockResolvedValue({
    models: ["gguf", "prep"],
    deleted: [MODEL.path],
    kept: [],
    bytesFreed: 70_400_000_000,
  });
  vi.mocked(api.delete).mockResolvedValue(undefined);
});

it("says a running runtime blocks it, naming the node", () => {
  expect(isRunning(runtime("ready"))).toBe(true);
  expect(isRunning(runtime("exited"))).toBe(false);
  expect(
    blockedBy([{ node: node("nas", "node:nas"), runtimes: [runtime("loading")], error: null }]),
  ).toBe("It is running (flash on nas): stop it there first.");
  expect(
    blockedBy([{ node: node("pc", "agent"), runtimes: [runtime("stopped")], error: null }]),
  ).toBeNull();
  // A node it cannot ask may be running it: said, and it blocks.
  expect(
    blockedBy([{ node: node("nas", "node:nas"), runtimes: [], error: "502 Bad Gateway" }]),
  ).toBe("Could not ask nas whether it runs it (502 Bad Gateway).");
});

it("lists every file, what is kept and for whom, and deletes with the plan's token", async () => {
  const done = vi.fn();
  render(
    <DeleteModel
      model={MODEL}
      nodes={[node("pc", "agent"), node("nas", "node:nas")]}
      onDeleted={done}
    />,
  );
  fireEvent.click(screen.getByTestId("delete-model"));
  const confirm = await screen.findByTestId("delete-model-confirm");
  await waitFor(() => expect(screen.getByTestId("delete-confirm")).toBeEnabled());
  expect(confirm).toHaveTextContent("Removes 1 file (68 GB) and 2 saved profiles");
  expect(screen.getByTestId("delete-files")).toHaveTextContent("Flash-IQ2_XS.gguf · 68 GB");
  expect(screen.getByTestId("delete-kept")).toHaveTextContent("mmproj.gguf · used by Flash-Q8_0");
  expect(screen.getByTestId("delete-runtimes")).toHaveTextContent("pc (flash)");
  // The prepared model made from it goes only when ticked.
  fireEvent.click(screen.getByRole("checkbox", { name: /Delete flash-iq2 too/ }));
  expect(screen.getByTestId("delete-confirm")).toHaveTextContent("Delete and free 70 GB");
  await act(async () => {
    fireEvent.click(screen.getByTestId("delete-confirm"));
  });
  expect(api.post).toHaveBeenCalledWith("library", "/v1/models/gguf/delete", {
    token: "t1",
    alsoDelete: ["prep"],
  });
  // Nothing is left pointing at the file.
  expect(api.delete).toHaveBeenCalledWith("agent", "/v1/runtimes/flash");
  expect(done).toHaveBeenCalled();
});

it("refuses while any node runs it, and while the Library says no", async () => {
  runtimesBy["node:nas"] = [runtime("ready", "flash-nas")];
  const { unmount } = render(
    <DeleteModel
      model={MODEL}
      nodes={[node("pc", "agent"), node("nas", "node:nas")]}
      onDeleted={() => {}}
    />,
  );
  fireEvent.click(screen.getByTestId("delete-model"));
  expect(await screen.findByTestId("delete-refused")).toHaveTextContent(
    "It is running (flash-nas on nas): stop it there first.",
  );
  expect(screen.getByTestId("delete-confirm")).toBeDisabled();
  unmount();
  runtimesBy["node:nas"] = [];
  vi.mocked(api.get).mockImplementation(async (_target: string, path: string) =>
    path.endsWith("/deletion")
      ? { ...PLAN, refusal: "A download is writing into it (o/r): let it finish." }
      : { runtimes: [] },
  );
  render(<DeleteModel model={MODEL} nodes={[node("pc", "agent")]} onDeleted={() => {}} />);
  fireEvent.click(screen.getByTestId("delete-model"));
  expect(await screen.findByTestId("delete-refused")).toHaveTextContent(
    "A download is writing into it",
  );
  expect(screen.getByTestId("delete-confirm")).toBeDisabled();
});
