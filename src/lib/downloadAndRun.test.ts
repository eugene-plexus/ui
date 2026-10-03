import { describe, expect, it } from "vitest";
import { downloadLabel, isDownloadAndRun, pendingChainedRuns, type RunTask } from "./oneClickRun";
import type { Download } from "./types";
const done = {
  id: "d",
  repo: "org/model",
  state: "done",
  modelId: "m",
  runWhenReady: true,
} as Download;
describe("legacy download intent migration", () => {
  it("migrates only completed, catalogued, unclaimed run requests", () => {
    expect(pendingChainedRuns([done], [], "agent")).toEqual([done]);
    for (const patch of [{ state: "downloading" }, { modelId: null }, { runWhenReady: false }]) {
      expect(pendingChainedRuns([{ ...done, ...patch } as Download], [], "agent")).toEqual([]);
    }
  });
  it("treats node identity as part of a run", () => {
    const active = { model: { id: "m" }, node: { target: "agent" }, step: "loading" } as RunTask;
    expect(pendingChainedRuns([done], [active], "agent")).toEqual([]);
    expect(pendingChainedRuns([done], [active], "node:worker")).toEqual([done]);
  });
  it("keeps download tasks recognizable and chooses the destination basename", () => {
    expect(isDownloadAndRun({ kind: "run", id: "dl_a1" })).toBe(true);
    expect(isDownloadAndRun({ kind: "run", id: "other" })).toBe(false);
    expect(
      downloadLabel({
        ...done,
        files: [{ destinationPath: "D:\\models\\model.gguf" }],
      } as Download),
    ).toBe("model.gguf");
  });
});
