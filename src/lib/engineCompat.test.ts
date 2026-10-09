import { describe, expect, it } from "vitest";

import { capableEngines, installedButNotFor, offeredOnThisNode } from "./engineCompat";
import type { EngineDescriptor, LibraryModel } from "./types";

function engine(overrides: Partial<EngineDescriptor>): EngineDescriptor {
  return {
    engine: "llama_cpp",
    available: true,
    modelFormats: ["gguf"],
    ...overrides,
  } as EngineDescriptor;
}

const llama = engine({ engine: "llama_cpp", modelFormats: ["gguf"] });
const vllm = engine({ engine: "vllm", modelFormats: ["safetensors"] });
const mlx = engine({ engine: "mlx", modelFormats: ["safetensors"], experimental: false });

function model(overrides: Partial<LibraryModel>): LibraryModel {
  return {
    id: "m",
    path: "/models/m",
    root: "/models",
    format: "safetensors",
    name: "m",
    status: "present",
    ...overrides,
  } as LibraryModel;
}

describe("capableEngines", () => {
  it("keeps the plain format join for an unmarked safetensors directory", () => {
    // Absence of the MLX marker means unknown, not incompatible: both
    // safetensors engines stay offered, and the engine's own failure
    // remains the second filter.
    const capable = capableEngines(model({}), [llama, vllm, mlx]);
    expect(capable.map((e) => e.engine)).toEqual(["vllm", "mlx"]);
  });

  it("offers only the MLX engine for an MLX-quantized directory", () => {
    // The marker is the library reading config.json's top-level MLX
    // quantization block — integer-packed weights vLLM cannot load.
    // Offering vLLM here is a launch button that fails at spawn.
    const marked = model({
      safetensors: { mlxQuantization: { bits: 4, groupSize: 64 } },
    });
    const capable = capableEngines(marked, [llama, vllm, mlx]);
    expect(capable.map((e) => e.engine)).toEqual(["mlx"]);
  });

  it("a GGUF model is untouched by the marker rule", () => {
    const gguf = model({ format: "gguf" });
    expect(capableEngines(gguf, [llama, vllm, mlx]).map((e) => e.engine)).toEqual(["llama_cpp"]);
  });
});

describe("offeredOnThisNode", () => {
  it("an engine Eugene installs itself is listed even when it cannot be installed now", () => {
    // "Not installable" on llama.cpp is a reason worth reading: GitHub's
    // hourly limit, a build not published yet.
    const refused = engine({
      engine: "llama_cpp",
      available: false,
      acquisition: { policy: "managed", installable: false, reason: "GitHub's limit..." },
    } as Partial<EngineDescriptor>);
    expect(offeredOnThisNode(refused)).toBe(true);
  });

  it("a hand-installed engine with a real install path is offered", () => {
    // The agent's manualInstall.command is its own judgment of
    // "appropriate hardware" — present only on Apple silicon for MLX —
    // so the UI hardcodes no platform list.
    const onAMac = engine({
      engine: "mlx",
      available: false,
      acquisition: {
        policy: "manual",
        installable: false,
        manualInstall: { command: "uv venv ~/eugene-mlx && ..." },
      },
    } as Partial<EngineDescriptor>);
    expect(offeredOnThisNode(onAMac)).toBe(true);
  });

  it("a hand-installed engine someone already installed is offered", () => {
    const installed = engine({
      engine: "mlx",
      available: true,
      acquisition: { policy: "manual", installable: false },
    } as Partial<EngineDescriptor>);
    expect(offeredOnThisNode(installed)).toBe(true);
  });

  it("MLX on the wrong hardware is hidden, now that it is no longer experimental", () => {
    // "mlx: not installed (not installable here)" on every Windows box
    // in the install would teach people to skip the engines line. The
    // flag that used to hide it went with A4 (2026-09-30).
    const onWindows = engine({
      engine: "mlx",
      experimental: false,
      available: false,
      acquisition: {
        policy: "manual",
        installable: false,
        manualInstall: { notes: "mlx-lm runs only on Apple silicon. ..." },
      },
    } as Partial<EngineDescriptor>);
    expect(offeredOnThisNode(onWindows)).toBe(false);
  });

  it("vLLM where it has no build is hidden, and offered where it has one", () => {
    const onWindows = engine({
      engine: "vllm",
      available: false,
      acquisition: {
        policy: "manual",
        installable: false,
        manualInstall: { notes: "vLLM has no Windows build and upstream's answer is WSL." },
      },
    } as Partial<EngineDescriptor>);
    const onLinuxCuda = engine({
      engine: "vllm",
      available: false,
      acquisition: {
        policy: "manual",
        installable: false,
        manualInstall: { command: "uv pip install vllm --torch-backend=auto" },
      },
    } as Partial<EngineDescriptor>);
    expect(offeredOnThisNode(onWindows)).toBe(false);
    expect(offeredOnThisNode(onLinuxCuda)).toBe(true);
  });
});

describe("installedButNotFor", () => {
  const strata = engine({ engine: "strata", modelFormats: [] });

  it("names Strata, installed but not offered for a GGUF model, and says where its models go", () => {
    const gguf = model({ format: "gguf" });
    const missing = installedButNotFor(gguf, [llama, strata]);
    expect(missing.map((m) => m.engine)).toEqual(["strata"]);
    expect(missing[0]!.why).toMatch(/prepared Strata models/);
    expect(missing[0]!.why).toMatch(/Backends/);
  });

  it("says which format an installed engine loads instead", () => {
    const missing = installedButNotFor(model({ format: "gguf" }), [llama, vllm]);
    expect(missing).toEqual([
      { engine: "vllm", why: "loads safetensors models, and this one is gguf." },
    ]);
  });

  it("explains an MLX-quantized directory rather than a format mismatch", () => {
    const marked = model({ safetensors: { mlxQuantization: { bits: 4, groupSize: 64 } } });
    const missing = installedButNotFor(marked, [vllm, mlx]);
    expect(missing.map((m) => m.engine)).toEqual(["vllm"]);
    expect(missing[0]!.why).toMatch(/MLX-quantized/);
  });

  it("leaves out engines that are not installed, and those already offered", () => {
    const absent = engine({ engine: "strata", modelFormats: [], available: false });
    expect(installedButNotFor(model({ format: "gguf" }), [llama, absent])).toEqual([]);
  });
});
