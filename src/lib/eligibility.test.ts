import { describe, expect, it } from "vitest";

import {
  bestAnswer,
  betterAfterPreparing,
  betterRouteLine,
  betterRouteWhy,
  eligibilityEngines,
  engineLists,
  fitLine,
  fitModelOf,
  hubFormatFor,
  judge,
  LEVEL_WORDS,
  levelEngine,
  runnable,
  runsHubModelsAsTheyAre,
  verdictLine,
  type EligibilityList,
  type EngineVerdict,
} from "./eligibility";
import type { EngineDescriptor } from "./types";

const engine = (over: Partial<EngineDescriptor>) =>
  ({ engine: "llama_cpp", available: true, modelFormats: ["gguf"], ...over }) as EngineDescriptor;

describe("eligibilityEngines", () => {
  it("sends what each engine accepts", () => {
    const accepts = [{ format: "gguf" as const, preference: 10 }];
    const [withAccepts] = eligibilityEngines([engine({ accepts })]);
    expect(withAccepts!.accepts).toBe(accepts);
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

// --- each engine owns its fit (LS6) -----------------------------------------

describe("each engine's own fit", () => {
  const v = (over: Partial<EngineVerdict>): EngineVerdict => ({
    engine: "llama_cpp",
    verdict: "runs",
    available: true,
    installable: false,
    experimental: false,
    reason: "runs it",
    ...over,
  });

  it("passes an engine's fit model to the judge, and none when it declares none", () => {
    const [declared, none] = eligibilityEngines([
      engine({ fit: { kind: "spill" } }),
      engine({ engine: "vllm" }),
    ]);
    expect(declared!.fit).toEqual({ kind: "spill" });
    expect("fit" in none!).toBe(false);
  });

  it("an engine's fit model is the one it declared, and none otherwise", () => {
    expect(fitModelOf(engine({ fit: { kind: "spill" } }))).toEqual({ kind: "spill" });
    expect(fitModelOf(engine({}))).toBeNull();
    expect(fitModelOf(engine({ engine: "vllm", fit: { kind: "reserved_share" } }))).toEqual({
      kind: "reserved_share",
    });
    expect(fitModelOf(undefined)).toBeNull();
  });

  it("says each engine's fit in its own words, and not estimated as such", () => {
    const name = (e: string) => ({ llama_cpp: "llama.cpp", mlx: "MLX" })[e] ?? e;
    expect(
      fitLine(
        v({
          fit: { approximate: false, estimated: true, verdict: "split", reason: "experts in RAM" },
        }),
        name,
      ),
    ).toBe("llama.cpp: fits, slower: experts in RAM");
    expect(
      fitLine(
        v({
          engine: "mlx",
          fit: { approximate: false, estimated: false, reason: "no fit estimate" },
        }),
        name,
      ),
    ).toBe("MLX: fit not estimated (no fit estimate)");
    expect(fitLine(v({}), name)).toBeNull();
  });

  it("the dot's engine is one that fits: too large here moves it to the next", () => {
    const tooLarge = v({
      fit: { approximate: false, estimated: true, verdict: "no", reason: "too large" },
    });
    const strata = v({
      engine: "strata",
      verdict: "after_preparation",
      fit: { approximate: false, estimated: true, verdict: "fits", reason: "fits" },
    });
    expect(levelEngine([tooLarge, strata])?.engine).toBe("strata");
    const unmeasured = v({
      fit: { approximate: false, estimated: false, reason: "not estimated" },
    });
    expect(levelEngine([unmeasured, strata])?.engine).toBe("llama_cpp");
  });

  it("asks the judge with the fit question, and leaves the field out when none is asked", async () => {
    const asked: unknown[] = [];
    const post = async (body: unknown): Promise<EligibilityList> => {
      asked.push(body);
      return { models: [] };
    };
    const engines = eligibilityEngines([engine({ fit: { kind: "spill" } })]);
    await judge(post, { engines, fit: { contextLength: 8192 } });
    await judge(post, { engines, fit: null });
    expect(asked[0]).toEqual({ engines, fit: { contextLength: 8192 } });
    expect("fit" in (asked[1] as object)).toBe(false);
  });

  it("a failure from the Library reaches the caller, not a second ask", async () => {
    let calls = 0;
    const post = async (): Promise<EligibilityList> => {
      calls += 1;
      throw new Error("down");
    };
    await expect(judge(post, { engines: [], fit: { contextLength: 1 } })).rejects.toThrow("down");
    expect(calls).toBe(1);
  });
});

describe("betterAfterPreparing (LS9, Troy's B54 change)", () => {
  type Fit = "fits" | "tight" | "split" | "no";
  const fit = (verdict: Fit | null) =>
    verdict
      ? { estimated: true, verdict, reason: "its own rule" }
      : { estimated: false, reason: "not asked" };
  const llama = (verdict: Fit | null, available = true): EngineVerdict =>
    ({
      engine: "llama_cpp",
      verdict: "runs",
      available,
      reason: "runs GGUF",
      fit: fit(verdict),
    }) as EngineVerdict;
  const strata = (verdict: Fit | null, available = true): EngineVerdict =>
    ({
      engine: "strata",
      verdict: "after_preparation",
      available,
      reason: "after preparing it",
      fit: fit(verdict),
    }) as EngineVerdict;
  const name = (e: string) => (e === "llama_cpp" ? "llama.cpp" : "Strata");

  it.each([
    ["split", "fits", true],
    ["no", "fits", true],
    ["split", "split", true],
    ["fits", "fits", false],
    ["tight", "fits", false],
    ["split", "tight", false],
    ["split", "no", false],
    [null, "fits", false],
    ["split", null, false],
  ] as const)("as is %s, after preparing %s: recommended %s", (asIs, prepared, yes) => {
    const route = betterAfterPreparing([llama(asIs), strata(prepared)]);
    expect(route !== null).toBe(yes);
  });

  it("a fit that was not estimated never counts, whatever verdict it carries", () => {
    const guessed = {
      ...llama("split"),
      fit: { estimated: false, verdict: "split", reason: "not asked" },
    } as EngineVerdict;
    expect(betterAfterPreparing([guessed, strata("fits")])).toBeNull();
  });

  it("needs both engines here: an engine not installed recommends nothing", () => {
    expect(betterAfterPreparing([llama("split"), strata("fits", false)])).toBeNull();
    expect(betterAfterPreparing([llama("split", false), strata("fits")])).toBeNull();
    expect(betterAfterPreparing([strata("fits")])).toBeNull();
    expect(betterAfterPreparing(null)).toBeNull();
  });

  it("says why in each engine's own terms", () => {
    const split = betterAfterPreparing([llama("split"), strata("fits")])!;
    expect(betterRouteLine(split, name)).toBe("Faster here with Strata after preparing");
    expect(betterRouteWhy(split, name)).toBe(
      "Strata fits it here after preparing it; llama.cpp would run part of it from system memory, slower.",
    );
    const lowRam = betterAfterPreparing([llama("no"), strata("split")])!;
    expect(betterRouteWhy(lowRam, name)).toBe(
      "Strata runs it here after preparing it, in its low-RAM mode; llama.cpp cannot fit it.",
    );
  });
});
