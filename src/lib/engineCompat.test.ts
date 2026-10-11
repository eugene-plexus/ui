import { describe, expect, it } from "vitest";

import { offeredOnThisNode } from "./engineCompat";
import type { EngineDescriptor } from "./types";

function engine(overrides: Partial<EngineDescriptor>): EngineDescriptor {
  return {
    engine: "llama_cpp",
    available: true,
    modelFormats: ["gguf"],
    ...overrides,
  } as EngineDescriptor;
}

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
