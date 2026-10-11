/**
 * LS5: a run operation that prepares its model for an engine first
 * (library-sources-and-engines.md §6.6). Asked for, never implied (B54).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import {
  describeRunDetail,
  findPreparation,
  findRun,
  getRuns,
  refreshRuns,
  resetRunsForTests,
  runTask,
  startDownloadAndPrepare,
  startPreparation,
  startRun,
  type RunOperation,
} from "./oneClickRun";
import type { TargetNode } from "./nodeBudget";
import type { LibraryModel } from "./types";

vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const GGUF: LibraryModel = {
  id: "g",
  name: "Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-00001-of-00002",
  path: "/models/q/Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-00001-of-00002.gguf",
  format: "gguf",
  status: "present",
};
const PREPARED = {
  id: "p",
  name: "qwen3.8-flash-next-iq2_xs",
  path: "/models/Strata-data/qwen3.8-flash-next-iq2_xs.eugene-prepared.json",
  format: "prepared",
  contextLength: null,
};
const HERE: TargetNode = {
  name: "amish",
  label: "amish",
  local: true,
  target: "agent",
  reachable: true,
  lastError: null,
  budget: null,
};
let records: RunOperation[];

beforeEach(() => {
  vi.useFakeTimers();
  resetRunsForTests();
  records = [];
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async (_target, path) =>
    path === "/v1/node" ? { name: "amish" } : { operations: structuredClone(records) },
  );
  vi.mocked(api.put).mockImplementation(async (_target, path, intent) => {
    const i = intent as RunOperation["intent"];
    const made: RunOperation = {
      id: path.split("/").pop()!,
      intent: i,
      node: i.node,
      model: i.modelId ? { ...GGUF, contextLength: null } : null,
      step: i.modelId ? "checking" : "downloading",
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
    records.push(made);
    return structuredClone(made);
  });
});
afterEach(() => {
  resetRunsForTests();
  vi.useRealTimers();
});

describe("preparation runs", () => {
  it("asks for the engine and context, once while it is in flight", async () => {
    const id = startPreparation({ ...GGUF, contextLength: null }, HERE, {
      engine: "strata",
      contextSize: 32768,
    });
    expect(
      startPreparation({ ...GGUF, contextLength: null }, HERE, {
        engine: "strata",
        contextSize: 32768,
      }),
    ).toBe(id);
    await vi.waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith("library", `/v1/run-operations/${id}`, {
      node: "amish",
      modelId: "g",
      preparation: { engine: "strata", contextSize: 32768 },
    });
  });

  it("leaves the context to the engine unless one is chosen", async () => {
    const id = startPreparation({ ...GGUF, contextLength: null }, HERE, {
      engine: "strata",
      contextSize: null,
    });
    await vi.waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith("library", `/v1/run-operations/${id}`, {
      node: "amish",
      modelId: "g",
      preparation: { engine: "strata" },
    });
  });

  it("downloads every file at the pinned revision, then prepares, in one request", async () => {
    const id = startDownloadAndPrepare(
      {
        repo: "ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF",
        files: ["IQ2_XS/a-00001-of-00002.gguf", "IQ2_XS/a-00002-of-00002.gguf"],
        revision: "ed59f92",
        source: null,
        label: "Qwen3.8-Flash-Next IQ2_XS",
      },
      HERE,
      { engine: "strata", contextSize: null },
    );
    await vi.waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith("library", `/v1/run-operations/${id}`, {
      node: "amish",
      download: {
        repo: "ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF",
        files: ["IQ2_XS/a-00001-of-00002.gguf", "IQ2_XS/a-00002-of-00002.gguf"],
        revision: "ed59f92",
      },
      preparation: { engine: "strata" },
    });
    await refreshRuns();
    // Once the server has it, the run is named by the file it is getting.
    expect(runTask(getRuns()[0]!).title).toBe(
      "Getting a-00001-of-00002.gguf to prepare for Strata on amish",
    );
  });

  it("is not a Run of the model it prepares, until its model is the prepared one", async () => {
    startPreparation({ ...GGUF, contextLength: null }, HERE, {
      engine: "strata",
      contextSize: null,
    });
    await vi.waitFor(() => expect(records).toHaveLength(1));
    await refreshRuns();
    expect(findRun("g", "agent")).toBeNull();
    expect(findPreparation("g", "agent")?.step).toBe("checking");
    // Run beside it is its own run.
    const run = startRun(GGUF, HERE);
    expect(run).not.toBe(records[0]!.id);
    await vi.waitFor(() => expect(records).toHaveLength(2));
    // Prepared: the run is the prepared model's, and still found by its source.
    records[0]!.preparedFrom = { ...GGUF, contextLength: null };
    records[0]!.model = PREPARED;
    records[0]!.step = "loading";
    await refreshRuns();
    expect(findRun("p", "agent")?.id).toBe(records[0]!.id);
    expect(findPreparation("g", "agent")?.id).toBe(records[0]!.id);
    expect(runTask(findRun("p", "agent")!).title).toBe(`Prepare ${GGUF.name} for Strata on amish`);
  });

  it("says where the preparation is, in the engine's words, with what it has written", async () => {
    startPreparation({ ...GGUF, contextLength: null }, HERE, {
      engine: "strata",
      contextSize: null,
    });
    await vi.waitFor(() => expect(records).toHaveLength(1));
    records[0]!.step = "preparing";
    records[0]!.preparation = {
      state: "running",
      step: "Step 6 of 7: preparing the model for Strata",
      message: "fetching MTP tensors 12/31",
      bytesWritten: 2_000_000_000,
      bytesNeeded: 8_000_000_000,
      warnings: [],
    };
    await refreshRuns();
    const task = getRuns()[0]!;
    const line = describeRunDetail(task);
    expect(line.detail).toContain("Step 6 of 7: preparing the model for Strata");
    expect(line.detail).toContain("fetching MTP tensors 12/31");
    expect(line.detail).toMatch(/2(\.0)? GB of about 8(\.0)? GB written/);
    expect(line.progress).toBeCloseTo(0.25);
    expect(
      describeRunDetail({
        ...task,
        preparation: { state: "waiting", message: "waiting for another preparation on this node" },
      }).detail,
    ).toBe("waiting for another preparation on this node");
    expect(
      describeRunDetail({
        ...task,
        step: "failed",
        failedStep: "prepare",
        error: "Strata's setup stopped: not enough RAM",
      }).detail,
    ).toBe("Preparing it for Strata failed: Strata's setup stopped: not enough RAM");
  });
});
