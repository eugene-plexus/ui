import { describe, expect, it } from "vitest";

import { ownBuildSpec } from "./ownBuild";
import type { Runtime } from "./types";

const refused = {
  name: "qwen",
  engine: "llama_cpp",
  modelPath: "/Users/troy/Eugene Models/qwen.gguf",
  modelAlias: "qwen",
  port: 8090,
  autoStart: true,
  flags: { ctx_size: 8192 },
  binary: "/opt/homebrew/bin/llama-server",
  refusedBinary: "/opt/homebrew/bin/llama-server",
  status: "crashed",
  lastError:
    "/opt/homebrew/bin/llama-server belongs to troy; Eugene's own account runs programs only…",
  argv: ["/opt/homebrew/bin/llama-server"],
  pid: 4242,
} as unknown as Runtime;

describe("Eugene's own build in place of a refused program (row 8)", () => {
  it("keeps the runtime's declaration and leaves out its binary", () => {
    const spec = ownBuildSpec(refused);
    expect(spec).toEqual({
      name: "qwen",
      engine: "llama_cpp",
      modelPath: "/Users/troy/Eugene Models/qwen.gguf",
      modelAlias: "qwen",
      port: 8090,
      autoStart: true,
      flags: { ctx_size: 8192 },
    });
    expect("binary" in spec).toBe(false);
  });

  it("sends nothing the node reports about the process", () => {
    const spec = ownBuildSpec(refused) as Record<string, unknown>;
    for (const key of ["refusedBinary", "status", "lastError", "argv", "pid"]) {
      expect(key in spec).toBe(false);
    }
  });
});
