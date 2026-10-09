import { describe, expect, it } from "vitest";

import { eligibilityEngines, LEVEL_WORDS, runnable } from "./eligibility";
import type { EngineDescriptor } from "./types";

const engine = (over: Partial<EngineDescriptor>) =>
  ({ engine: "llama_cpp", available: true, modelFormats: ["gguf"], ...over }) as EngineDescriptor;

describe("eligibilityEngines", () => {
  it("sends what each engine accepts, and an older agent's formats as whole rules", () => {
    const accepts = [{ format: "gguf" as const, preference: 10 }];
    const [withAccepts, older] = eligibilityEngines([
      engine({ accepts }),
      engine({ engine: "vllm", modelFormats: ["safetensors"] }),
    ]);
    expect(withAccepts!.accepts).toBe(accepts);
    expect(older!.accepts).toEqual([{ format: "safetensors", preference: 100 }]);
  });

  it("calls an engine installable only when it is not installed and could be here", () => {
    const [installed, managed, macOnly] = eligibilityEngines([
      engine({}),
      engine({ available: false, acquisition: { policy: "managed" } as never }),
      engine({
        engine: "mlx",
        available: false,
        acquisition: { policy: "manual", installable: false } as never,
      }),
    ]);
    expect(installed!.installable).toBe(false);
    expect(managed!.installable).toBe(true);
    expect(macOnly!.installable).toBe(false);
  });
});

it("keeps Troy's words for the three levels", () => {
  expect(LEVEL_WORDS).toEqual({
    works_here: "Will work on this machine now",
    other_engine: "Will work with a different engine",
    not_here: "Can not work on this machine",
  });
  expect(
    runnable([
      { engine: "vllm", verdict: "may_run", available: true, reason: "" },
      { engine: "strata", verdict: "after_preparation", available: true, reason: "" },
    ] as never).map((v) => v.engine),
  ).toEqual(["vllm"]);
});
