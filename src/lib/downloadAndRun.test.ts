import { describe, expect, it } from "vitest";
import { downloadLabel, isDownloadAndRun } from "./oneClickRun";
import type { Download } from "./types";
const done = {
  id: "d",
  repo: "org/model",
  state: "done",
  modelId: "m",
} as unknown as unknown as Download;
describe("download-and-run tasks", () => {
  it("keeps download tasks recognizable and chooses the destination basename", () => {
    expect(isDownloadAndRun({ kind: "run", id: "dl_a1" })).toBe(true);
    expect(isDownloadAndRun({ kind: "run", id: "other" })).toBe(false);
    expect(
      downloadLabel({
        ...done,
        files: [{ destinationPath: "D:\\models\\model.gguf" }],
      } as unknown as Download),
    ).toBe("model.gguf");
  });
});
