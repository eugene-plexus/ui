import { describe, expect, it } from "vitest";

import {
  bestAnswer,
  eligibilityEngines,
  engineLists,
  hubFormatFor,
  LEVEL_WORDS,
  runnable,
  runsHubModelsAsTheyAre,
  verdictLine,
} from "./eligibility";
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

describe("Discover's helpers (LS2)", () => {
  const answer = (level: "works_here" | "other_engine" | "not_here") =>
    ({ modelId: level, level, engines: [] }) as never;

  it("a row is as good as its best format", () => {
    expect(bestAnswer([answer("not_here"), undefined, answer("other_engine")])).toEqual(
      answer("other_engine"),
    );
    expect(bestAnswer([undefined])).toBeUndefined();
  });

  it("says each verdict about the machine in the picker", () => {
    const v = { engine: "vllm", verdict: "may_run", reason: "r", available: false } as never;
    expect(verdictLine({ ...(v as object), installable: true } as never, "box", (e) => e)).toBe(
      "vllm: r; not installed on box yet",
    );
    expect(verdictLine(v, "box", (e) => e)).toBe("vllm: r; cannot run on box");
  });

  // Troy, 2026-10-09, on Amish_Station after LS3: "Works here now" found none
  // of 30. Strata's `prepared` was counted as a format the hub could serve.
  it("never asks the hub for prepared models, which only an engine makes", () => {
    const strata = engine({
      engine: "strata",
      modelFormats: ["prepared"],
      accepts: [
        { format: "prepared", preparedFor: "strata", preference: 50 },
        { format: "gguf", preparation: { recipe: "s" }, preference: 50 },
      ],
    });
    const llama = engine({ accepts: [{ format: "gguf", preference: 10 }] });
    expect(hubFormatFor("works_here", [llama, strata])).toBe("gguf");
    const notInstalled = engine({
      available: false,
      accepts: [{ format: "gguf", preference: 10 }],
      acquisition: { policy: "managed" } as never,
    });
    expect(hubFormatFor("works_here", [notInstalled, strata])).toBeNull();
    expect(hubFormatFor("other_engine", [notInstalled, strata])).toBe("gguf");
  });

  it("asks the hub for one format only when the filter's engines load one", () => {
    const engines = [
      engine({ accepts: [{ format: "gguf", preference: 10 }] }),
      engine({
        engine: "strata",
        accepts: [{ format: "gguf", preparation: { recipe: "s" }, preference: 50 }],
      }),
      engine({
        engine: "vllm",
        available: false,
        accepts: [{ format: "safetensors", preference: 20 }],
        acquisition: { policy: "manual", installable: false } as never,
      }),
    ];
    expect(hubFormatFor("works_here", engines)).toBe("gguf");
    // Strata prepares a GGUF; vLLM cannot be installed here.
    expect(hubFormatFor("other_engine", engines)).toBe("gguf");
    expect(hubFormatFor(null, engines)).toBeNull();
    expect(hubFormatFor("works_here", null)).toBeNull();
    const mac = [
      ...engines.slice(0, 2),
      engine({
        engine: "mlx",
        available: false,
        accepts: [{ format: "safetensors", preference: 10 }],
      }),
    ];
    expect(hubFormatFor("other_engine", mac)).toBeNull();
  });
});

describe("the sources list's helpers (LS4)", () => {
  const llama = {
    engine: "llama_cpp",
    available: true,
    modelFormats: ["gguf"],
    accepts: [{ format: "gguf" }],
  } as EngineDescriptor;
  const strata = {
    engine: "strata",
    available: true,
    modelFormats: ["prepared"],
    accepts: [
      { format: "prepared", preparedFor: "strata" },
      {
        format: "gguf",
        files: ["a-00001-of-00002.gguf"],
        preparation: { recipe: "strata-prepare" },
      },
    ],
    supportedModels: [
      {
        id: "a",
        title: "A",
        format: "gguf",
        source: { repoId: "o/r", file: "a-00001-of-00002.gguf", revision: "c" },
      },
    ],
  } as EngineDescriptor;

  it("sends only the engines that publish a list", () => {
    expect(engineLists([llama, strata])).toEqual([
      { engine: "strata", models: strata.supportedModels },
    ]);
  });

  it("Works here now is the default only where a hub's model runs as it is", () => {
    expect(runsHubModelsAsTheyAre([llama, strata])).toBe(true);
    // Strata loads only what it prepared, or prepares first: not as it is.
    expect(runsHubModelsAsTheyAre([strata])).toBe(false);
    expect(runsHubModelsAsTheyAre([{ ...llama, available: false }])).toBe(false);
    expect(runsHubModelsAsTheyAre(null)).toBe(false);
  });
});
