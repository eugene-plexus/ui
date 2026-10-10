import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import {
  answerInstall,
  cancelRun,
  describeRunDetail,
  dismissRun,
  findRun,
  getRuns,
  refreshRuns,
  resetRunsForTests,
  runTask,
  startDownloadAndRun,
  startRun,
  type RunOperation,
} from "./oneClickRun";
import type { TargetNode } from "./nodeBudget";
import type { LibraryModel } from "./types";

vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
const MODEL: LibraryModel = {
  id: "m",
  name: "Example 8B",
  path: "/models/m.gguf",
  format: "gguf",
  status: "present",
  contextLength: 40960,
};
const HERE: TargetNode = {
  name: "desktop",
  label: "desktop",
  local: true,
  target: "agent",
  reachable: true,
  lastError: null,
  budget: null,
};
let records: RunOperation[];
function record(id: string, intent: RunOperation["intent"]): RunOperation {
  return {
    id,
    intent,
    node: intent.node,
    model: intent.modelId ? { ...MODEL, contextLength: 40960 } : null,
    step: intent.modelId ? "checking" : "downloading",
    engine: null,
    runtime: null,
    runtimeStatus: null,
    download: null,
    install: null,
    error: null,
    failedStep: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  resetRunsForTests();
  records = [];
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async (_target, path) =>
    path === "/v1/node" ? { name: "desktop" } : { operations: structuredClone(records) },
  );
  vi.mocked(api.put).mockImplementation(async (_target, path, intent) => {
    const made = record(path.split("/").pop()!, intent as RunOperation["intent"]);
    records.push(made);
    return structuredClone(made);
  });
  vi.mocked(api.post).mockImplementation(async (_target, path) => {
    const id = path.split("/").at(-2)!;
    const found = records.find((r) => r.id === id)!;
    if (path.endsWith("/cancel")) found.step = "cancelled";
    return structuredClone(found);
  });
  vi.mocked(api.delete).mockImplementation(async (_target, path) => {
    records = records.filter((r) => r.id !== path.split("/").pop());
  });
});
afterEach(() => {
  resetRunsForTests();
  vi.useRealTimers();
});

describe("durable run observer", () => {
  it("resolves a missing local identity before assigning durable work", async () => {
    const id = startRun(MODEL, { ...HERE, name: null });
    await vi.waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith("library", `/v1/run-operations/${id}`, {
      node: "desktop",
      modelId: "m",
    });
    expect(findRun("m", "agent")?.node.name).toBe("desktop");
  });
  it("submits only intent, preserves the chosen node, and reads progress from the server", async () => {
    const id = startRun(MODEL, HERE);
    expect(startRun(MODEL, HERE)).toBe(id);
    await vi.waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith("library", `/v1/run-operations/${id}`, {
      node: "desktop",
      modelId: "m",
    });
    records[0]!.step = "ready";
    records[0]!.runtime = "example-8b";
    await refreshRuns();
    expect(findRun("m", "agent")?.step).toBe("ready");
    expect(api.post).not.toHaveBeenCalled();
  });
  it("recovers progress after a full browser reset without issuing launch calls", async () => {
    startRun(MODEL, HERE);
    await vi.waitFor(() => expect(records).toHaveLength(1));
    records[0]!.step = "loading";
    records[0]!.runtimeStatus = "loading";
    resetRunsForTests();
    await refreshRuns();
    expect(getRuns()[0]!.step).toBe("loading");
    expect(getRuns()[0]!.node.target).toBe("agent");
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.post).not.toHaveBeenCalled();
  });
  it("persists an install decision, cancels on the server, and dismisses the receipt", async () => {
    const id = startRun(MODEL, HERE);
    await vi.waitFor(() => expect(records).toHaveLength(1));
    records[0]!.step = "awaiting-install";
    await refreshRuns();
    answerInstall(id, "install");
    await vi.waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("library", `/v1/run-operations/${id}/answer`, {
        answer: "install",
      }),
    );
    cancelRun(id);
    await vi.waitFor(() => expect(getRuns()[0]?.step).toBe("cancelled"));
    dismissRun(id);
    await vi.waitFor(() => expect(getRuns()).toHaveLength(0));
    expect(api.delete).toHaveBeenCalledWith("library", `/v1/run-operations/${id}`);
  });
  it("sends download and run as one durable request and never claims from a browser", async () => {
    const id = startDownloadAndRun({ repo: "org/model", file: "model.gguf", label: "Model" }, HERE);
    await vi.waitFor(() => expect(records).toHaveLength(1));
    expect(api.put).toHaveBeenCalledWith("library", `/v1/run-operations/${id}`, {
      node: "desktop",
      download: { repo: "org/model", files: ["model.gguf"] },
    });
    expect(api.post).not.toHaveBeenCalled();
  });
  it("keeps the last known progress during an outage", async () => {
    startRun(MODEL, HERE);
    await vi.waitFor(() => expect(records).toHaveLength(1));
    await refreshRuns();
    vi.mocked(api.get).mockRejectedValueOnce(new Error("offline"));
    await expect(refreshRuns()).rejects.toThrow("offline");
    expect(getRuns()[0]?.step).toBe("checking");
  });
  it("ignores a stale poll that finishes after an accepted submission", async () => {
    await refreshRuns();
    let deliver: (value: unknown) => void = () => {};
    vi.mocked(api.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    const stale = refreshRuns();
    const id = startRun(MODEL, HERE);
    await vi.waitFor(() => expect(records).toHaveLength(1));
    deliver({ operations: [] });
    await stale;
    expect(findRun("m", "agent")?.id).toBe(id);
  });
  it("does not let a response from the previous browser session repopulate its store", async () => {
    let deliver: (value: unknown) => void = () => {};
    vi.mocked(api.put).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    const id = startRun(MODEL, HERE);
    resetRunsForTests();
    deliver(record(id, { node: "desktop", modelId: "m" }));
    await Promise.resolve();
    await Promise.resolve();
    expect(getRuns()).toEqual([]);
  });
  it("keeps progress language focused on the action and names the failed step", async () => {
    startRun(MODEL, HERE);
    await vi.waitFor(() => expect(records).toHaveLength(1));
    await refreshRuns();
    const task = getRuns()[0]!;
    for (const step of [
      "checking",
      "installing",
      "settings",
      "launching",
      "loading",
      "ready",
    ] as const) {
      const line = runTask({ ...task, step }).title + describeRunDetail({ ...task, step }).detail;
      for (const word of ["runtime", "companion", "endpoint", "backend"])
        expect(line.toLowerCase()).not.toContain(word);
    }
    expect(
      describeRunDetail({ ...task, step: "failed", failedStep: "install", error: "Disk full" })
        .detail,
    ).toContain("Installing llama.cpp failed: Disk full");
    expect(runTask(task).cancel).toBeTypeOf("function");
  });
});
