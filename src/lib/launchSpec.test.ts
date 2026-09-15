/**
 * The spec Run and the profile editor both compose, as data.
 */

import { describe, expect, it } from "vitest";

import { composeSpec, contextPrefill, defaultProfileSpec, runtimeName } from "./launchSpec";
import type { LibraryModel, ModelProfile } from "./types";

const MODEL: LibraryModel = {
  id: "m1",
  path: "D:\\models\\unsloth\\Qwen3-14B-GGUF\\Qwen3-14B-UD-Q6_K_XL.gguf",
  format: "gguf",
  name: "Qwen3-14B-UD-Q6_K_XL",
  status: "present",
  contextLength: 40960,
};

const DEFAULT: ModelProfile = {
  id: "p1",
  name: "default",
  default: true,
  engine: "llama_cpp",
  flags: { contextSize: 32768 },
};

describe("composeSpec", () => {
  it("copies the profile onto the runtime field for field, autoStart on", () => {
    expect(composeSpec(MODEL, DEFAULT)).toEqual({
      name: "qwen3-14b-ud-q6-k-xl",
      engine: "llama_cpp",
      modelPath: MODEL.path,
      flags: { contextSize: 32768 },
      extraArgs: undefined,
      env: undefined,
      autoStart: true,
    });
  });

  it("sends autoStart false for Skip, and nothing else changes", () => {
    const spec = composeSpec(MODEL, DEFAULT, { autoStart: false });
    expect(spec.autoStart).toBe(false);
    expect(spec.name).toBe("qwen3-14b-ud-q6-k-xl");
  });

  it("never sets host or port: the agent owns both", () => {
    const spec = composeSpec(MODEL, DEFAULT) as Record<string, unknown>;
    expect("host" in spec).toBe(false);
    expect("port" in spec).toBe(false);
  });
});

describe("runtimeName", () => {
  it("is the model's slug for the default profile and gains the profile's name otherwise", () => {
    expect(runtimeName(MODEL, { name: "default", default: true })).toBe("qwen3-14b-ud-q6-k-xl");
    expect(runtimeName(MODEL, { name: "long context", default: false })).toBe(
      "qwen3-14b-ud-q6-k-xl-long-context",
    );
  });
});

describe("defaultProfileSpec", () => {
  it("is named default, marked default, and carries only the context that fits", () => {
    expect(defaultProfileSpec("llama_cpp", 75_520)).toEqual({
      name: "default",
      engine: "llama_cpp",
      default: true,
      flags: { contextSize: 75_520 },
      extraArgs: [],
      env: {},
    });
  });

  it("leaves the context to the engine when nothing fits better", () => {
    expect(defaultProfileSpec("llama_cpp", null).flags).toEqual({});
  });
});

describe("contextPrefill", () => {
  it("is the agent's number when it is below the model's own context", () => {
    expect(contextPrefill(75_520, 262_144)).toBe(75_520);
  });
  it("is null when the model's own context already fits, or nobody said", () => {
    expect(contextPrefill(262_144, 262_144)).toBeNull();
    expect(contextPrefill(300_000, 262_144)).toBeNull();
    expect(contextPrefill(null, 262_144)).toBeNull();
    expect(contextPrefill(undefined, 262_144)).toBeNull();
    expect(contextPrefill(0, 262_144)).toBeNull();
  });
  it("is the agent's number when the model did not say how long its context is", () => {
    expect(contextPrefill(16_384, null)).toBe(16_384);
  });
});
