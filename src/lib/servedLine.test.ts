/**
 * The "Serves" column on Machines (Troy, 2026-10-13): lead with the model's
 * state, and do not say a name twice.
 */

import { describe, expect, it } from "vitest";

import { describeServed, nameKey, repeatsModel, type ServedInput } from "./servedLine";

function served(over: Partial<ServedInput> = {}): ServedInput {
  return {
    driver: "qwen3-8-flash-next-iq2-xs-driver",
    model: "qwen3.8-flash-next-iq2_xs",
    runtime: "qwen3-8-flash-next-iq2-xs",
    reachable: false,
    status: "stopped",
    ...over,
  };
}

describe("a name as it compares", () => {
  it("ignores case, punctuation and a trailing driver", () => {
    expect(nameKey("qwen3-8-flash-next-iq2-xs-driver")).toBe("qwen38flashnextiq2xs");
    expect(nameKey("qwen3.8-flash-next-iq2_xs")).toBe("qwen38flashnextiq2xs");
    expect(nameKey("Qwen3.8 Flash")).toBe("qwen38flash");
    expect(nameKey("driver")).toBe("");
  });

  it("calls the driver of the same name the model's own", () => {
    expect(repeatsModel("qwen3-8-flash-next-iq2-xs-driver", "qwen3.8-flash-next-iq2_xs")).toBe(
      true,
    );
  });

  it("calls the same short name the model's own, whatever its length", () => {
    expect(repeatsModel("gpt-driver", "gpt")).toBe(true);
    expect(repeatsModel("gpt-driver", "gpt-4o")).toBe(false);
  });

  it("calls a shortened form the model's own, too", () => {
    expect(repeatsModel("qwen3-8b-driver", "unsloth/Qwen3-8B")).toBe(true);
    expect(repeatsModel("anthropic", "anthropic/… (12 models)")).toBe(true);
  });

  it("does not call a different name the model's", () => {
    expect(repeatsModel("gpu-box-driver", "qwen3-8b")).toBe(false);
    expect(repeatsModel("openai-driver", "gpt-4o-mini")).toBe(false);
    // Too short to be a model's prefix rather than a name of its own.
    expect(repeatsModel("q-driver", "qwen3-8b")).toBe(false);
  });
});

describe("one line of Serves", () => {
  it("is the model and its state, with no driver when it only repeats the model", () => {
    const line = describeServed(served());
    expect(line.lead).toBe("qwen3.8-flash-next-iq2_xs");
    expect(line.state).toBe("stopped");
    expect(line.via).toBeNull();
    // The plumbing is still one hover away.
    expect(line.title).toBe(
      "driver qwen3-8-flash-next-iq2-xs-driver, runtime qwen3-8-flash-next-iq2-xs",
    );
  });

  it("names the driver when it says something the model does not", () => {
    const line = describeServed(
      served({ driver: "gpu-box-driver", status: "ready", reachable: true }),
    );
    expect(line.via).toBe("gpu-box-driver");
    expect(line.state).toBe("ready");
    expect(line.tone).toBe("good");
  });

  it("falls back to the driver when no model is named, and does not repeat it", () => {
    const line = describeServed(served({ model: null, status: null, reachable: null }));
    expect(line.lead).toBe("qwen3-8-flash-next-iq2-xs-driver");
    expect(line.via).toBeNull();
    expect(line.state).toBeNull();
  });

  it("says unreachable for a driver nothing reaches, whatever the engine says", () => {
    expect(describeServed(served({ status: "ready", reachable: false })).state).toBe("unreachable");
    expect(describeServed(served({ status: null, reachable: false })).state).toBe("unreachable");
    expect(describeServed(served({ status: "ready", reachable: false })).tone).toBe("bad");
  });

  it("does not call a model unreachable that is simply not up yet", () => {
    expect(describeServed(served({ status: "stopped", reachable: false })).state).toBe("stopped");
    expect(describeServed(served({ status: "loading", reachable: false })).state).toBe("loading");
    expect(describeServed(served({ status: "crashed", reachable: false })).tone).toBe("bad");
  });

  it("says nothing of state for a backend that has no engine and has not been checked", () => {
    const line = describeServed(
      served({ runtime: null, status: null, reachable: null, driver: "ollama-driver" }),
    );
    expect(line.state).toBeNull();
    expect(line.title).toBe("driver ollama-driver");
  });
});
