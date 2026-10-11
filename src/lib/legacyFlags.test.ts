import { describe, expect, it } from "vitest";

import { currentFlags } from "./legacyFlags";
import { builtFieldStates } from "./profileBuild";
import type { ModelProfile } from "./types";

describe("flags saved before Flash attention had three states (agent#6)", () => {
  it("reads true as on and false as the engine's own choice, never off", () => {
    expect(currentFlags({ flashAttention: true, threads: 8 })).toEqual({
      flashAttention: "on",
      threads: 8,
    });
    expect(currentFlags({ flashAttention: false })).toEqual({});
    expect(currentFlags({ flashAttention: "off" })).toEqual({ flashAttention: "off" });
    expect(currentFlags({})).toEqual({});
  });

  it("does not call a build edited because it was recorded as true", () => {
    const profile = (flash: unknown, recorded: unknown) =>
      ({
        id: "p",
        name: "Built",
        engine: "llama_cpp",
        flags: { cacheType: "q8_0", flashAttention: flash },
        builtBy: { flags: { cacheType: "q8_0", flashAttention: recorded } },
      }) as unknown as ModelProfile;
    expect(builtFieldStates(profile("on", true)).flashAttention).toBe("built");
    expect(builtFieldStates(profile(true, true)).flashAttention).toBe("built");
    expect(builtFieldStates(profile("off", true)).flashAttention).toBe("edited");
  });
});
