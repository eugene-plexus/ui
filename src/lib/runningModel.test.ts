import { describe, expect, it } from "vitest";

import type { LibraryModel, Runtime, RuntimeStatus } from "@/lib/types";

import { describeRunning, runningModel, runtimesForModel, samePath } from "./runningModel";

/**
 * The join. The *wiring* — that the Library page asks the picked node at
 * all, and that a running model stops the Run button and stops the fit
 * panel contradicting itself — is in `library/page.test.tsx`, and it is
 * the half that was actually missing.
 */

const WINDOWS_PATH = "Y:\\models\\gemma-3-27b-it-Q6_K_L.gguf";

function model(over: Partial<LibraryModel> = {}): LibraryModel {
  return {
    id: "gemma",
    path: WINDOWS_PATH,
    format: "gguf",
    name: "gemma-3-27b-it-Q6_K_L",
    status: "present",
    ...over,
  } as LibraryModel;
}

function runtime(over: Partial<Runtime> = {}): Runtime {
  return {
    name: "gemma-a",
    engine: "llama_cpp",
    modelPath: WINDOWS_PATH,
    status: "ready" as RuntimeStatus,
    ...over,
  } as Runtime;
}

describe("is this model running here", () => {
  it("finds the runtime that declares this model's path", () => {
    const found = runningModel(model(), [runtime()]);
    expect(found?.runtime).toBe("gemma-a");
    expect(found?.live).toBe(true);
    expect(found?.stopped).toBe(false);
  });

  it("says nothing about a node running a different model", () => {
    expect(runningModel(model(), [runtime({ modelPath: "Y:\\models\\qwen-30b.gguf" })])).toBeNull();
    expect(runningModel(model(), [])).toBeNull();
  });

  it("matches on the DECLARED path, not the one the engine opens", () => {
    // M11 made `modelPath` the declaration and `localPath` the resolved
    // answer precisely so the first stays a stable identifier. Since
    // 2026-09-17 a node may open its own copy, so `localPath` is a
    // different file on disk for the same model — matching on it would
    // lose the model exactly where this page's advice matters most.
    const found = runningModel(model(), [
      runtime({
        localPath: "C:\\ProgramData\\EugenePlexus\\copies\\gemma-3-27b-it-Q6_K_L.gguf",
        localPathSource: "copy",
      }),
    ]);
    expect(found?.runtime).toBe("gemma-a");
    expect(found?.localPath).toContain("copies");
  });

  it("separates on its way up from up, and from stopped", () => {
    for (const status of ["copying", "starting", "loading"] as RuntimeStatus[]) {
      const found = runningModel(model(), [runtime({ status })]);
      expect(found?.busy, status).toBe(true);
      expect(found?.live, status).toBe(false);
      expect(found?.stopped, status).toBe(false);
    }
    for (const status of ["stopped", "exited", "crashed"] as RuntimeStatus[]) {
      const found = runningModel(model(), [runtime({ status })]);
      expect(found?.stopped, status).toBe(true);
      expect(found?.live, status).toBe(false);
    }
  });

  it("reports the strongest true thing when one model has several runtimes", () => {
    // M6 replicas: N runtimes over one file. A page that picked the
    // first in the list would say "stopped" about a model that is
    // serving, which is the same class of wrong as the defect this
    // module exists for.
    const runtimes = [
      runtime({ name: "stale", status: "stopped" }),
      runtime({ name: "warm", status: "loading" }),
      runtime({ name: "live", status: "ready" }),
    ];
    expect(runningModel(model(), runtimes)?.runtime).toBe("live");
    expect(runtimesForModel(model(), runtimes).map((r) => r.name)).toEqual([
      "live",
      "warm",
      "stale",
    ]);
  });
});

describe("samePath", () => {
  it("takes an exact match, which is what the UI's own launches produce", () => {
    expect(samePath(WINDOWS_PATH, WINDOWS_PATH)).toBe(true);
  });

  it("folds separators and case for a path that is spelled for Windows", () => {
    // A hand-declared runtime, or a config file typed by a person.
    expect(samePath("Y:/models/Gemma-3-27B-it-Q6_K_L.gguf", WINDOWS_PATH)).toBe(true);
    expect(samePath("\\\\TOWER\\models\\a.gguf", "//tower/models/A.GGUF")).toBe(true);
  });

  it("does NOT fold case on a POSIX path", () => {
    // Two POSIX paths differing only in case are two different files.
    // Folding them would report a model as running when something else
    // is — a false "it fits, it is up" is worse than no answer.
    expect(samePath("/models/a.gguf", "/models/A.gguf")).toBe(false);
    expect(samePath("/models/a.gguf", "/models/a.gguf")).toBe(true);
  });

  it("never matches on nothing", () => {
    expect(samePath(null, null)).toBe(false);
    expect(samePath("", "")).toBe(false);
    expect(samePath(undefined, "/models/a.gguf")).toBe(false);
  });
});

describe("describeRunning", () => {
  it("names the machine the picker named, not a hostname nobody chose", () => {
    const found = runningModel(model(), [runtime()])!;
    expect(describeRunning(found, "this machine")).toBe("Running on this machine now.");
    expect(describeRunning(found, "Amish_Station")).toBe("Running on Amish_Station now.");
  });

  it("translates the three stop reasons, because each wants a different move", () => {
    const stopped = (stopReason: Runtime["stopReason"]) =>
      describeRunning(runningModel(model(), [runtime({ status: "stopped", stopReason })])!, "nas");
    expect(stopped("idle")).toContain("the gateway unloaded it");
    expect(stopped("operator")).toContain("someone stopped it");
    expect(stopped("autoStart")).toContain("not to start on its own");
    // No reason given is not the same as "someone stopped it".
    expect(stopped(undefined)).toBe("Set up on nas and not running.");
  });

  it("distinguishes copying from loading, which is minutes of difference", () => {
    const at = (status: RuntimeStatus) =>
      describeRunning(runningModel(model(), [runtime({ status })])!, "Amish_Station");
    expect(at("copying")).toContain("Copying onto Amish_Station");
    expect(at("loading")).toContain("Loading into memory");
  });
});
