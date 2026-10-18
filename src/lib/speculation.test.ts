/**
 * SD1: the speculative-decoding settings narrowed to what a model can use,
 * the builder's drafting choice, and the running model's line.
 */

import { describe, expect, it } from "vitest";

import high from "./__fixtures__/profile-build-high.json";
import { builtSpec } from "./profileBuild";
import { builtDraftFlags, draftLines, speculationFields, speculationLine } from "./speculation";
import type { ConfigField, LibraryModel, ProfileBuild } from "./types";

const FIELDS = [
  { key: "reuseRepeatedText", label: "Reuse repeated text", valueType: "boolean", default: true },
  {
    key: "draftWith",
    label: "Draft with",
    valueType: "enum",
    enumValues: ["off", "mtpHead", "companion"],
    enumLabels: ["Off", "Model's own prediction head (MTP)", "Companion file"],
  },
  { key: "draftModelPath", label: "Companion file", valueType: "string" },
  { key: "draftTokens", label: "Tokens drafted per step", valueType: "integer" },
  { key: "contextSize", label: "Context size", valueType: "integer" },
] as unknown as ConfigField[];

function model(speculation: unknown): LibraryModel {
  return {
    id: "m",
    path: "/models/qwen/Qwen3.6-27B-Q4_K_M.gguf",
    format: "gguf",
    gguf: { speculation },
  } as unknown as LibraryModel;
}

const keys = (fields: ConfigField[]) => fields.map((f) => f.key);

describe("the profile's speculative-decoding fields", () => {
  it("offers no way of drafting a model has nothing to draft with", () => {
    const shown = speculationFields(FIELDS, model({ mtpHead: false, draftFiles: [] }), {});
    expect(keys(shown)).toEqual(["reuseRepeatedText", "contextSize"]);
  });

  it("offers the model's own head only when its file carries one", () => {
    const shown = speculationFields(FIELDS, model({ mtpHead: true, draftFiles: [] }), {});
    expect(shown.find((f) => f.key === "draftWith")?.enumValues).toEqual(["off", "mtpHead"]);
    expect(keys(shown)).not.toContain("draftTokens");
  });

  it("picks a companion from the model's folder and only when drafting with one", () => {
    const path = "/models/qwen/mtp-Qwen3.6-27B-Q4_0.gguf";
    const files = [{ path, kind: "mtp" }];
    const drafting = speculationFields(FIELDS, model({ mtpHead: false, draftFiles: files }), {
      draftWith: "companion",
    });
    const companion = drafting.find((f) => f.key === "draftModelPath");
    expect(companion?.valueType).toBe("enum");
    expect(companion?.enumValues).toEqual([path]);
    expect(companion?.enumLabels).toEqual(["mtp-Qwen3.6-27B-Q4_0.gguf (MTP head)"]);
    expect(keys(drafting)).toContain("draftTokens");
  });

  it("keeps a value the model no longer offers, shown as itself", () => {
    const shown = speculationFields(FIELDS, model({ mtpHead: false, draftFiles: [] }), {
      draftWith: "mtpHead",
    });
    expect(shown.find((f) => f.key === "draftWith")?.enumValues).toEqual(["off", "mtpHead"]);
  });
});

function withTrials(trials: unknown[], recommendedDraft: number | null): ProfileBuild {
  return {
    ...(high as unknown as ProfileBuild),
    draftTrials: trials,
    recommendedDraft,
  } as ProfileBuild;
}

const OFF = { draftWith: "off", decodeTokensPerSecond: 48.2 };
const HEAD = {
  draftWith: "mtpHead",
  decodeTokensPerSecond: 81.5,
  draftedTokens: 300,
  acceptedTokens: 231,
};

describe("the builder's drafting choice", () => {
  it("saves the faster way of drafting with the rest of the built settings", () => {
    const build = withTrials([OFF, HEAD], 1);
    expect(builtDraftFlags(build)).toEqual({ draftWith: "mtpHead" });
    const candidate = build.candidates[build.recommended ?? 0];
    if (!candidate) throw new Error("the fixture has a recommended candidate");
    const spec = builtSpec({ base: null, build, candidate, name: "Built", replacing: false });
    expect(spec.flags?.draftWith).toBe("mtpHead");
    expect(spec.builtBy?.flags.draftWith).toBe("mtpHead");
  });

  it("saves Off when nothing was faster, and nothing when nothing was timed", () => {
    expect(builtDraftFlags(withTrials([OFF, { ...HEAD, decodeTokensPerSecond: 49 }], 0))).toEqual({
      draftWith: "off",
    });
    expect(builtDraftFlags(withTrials([], null))).toEqual({});
  });

  it("names the companion it saves", () => {
    const companion = {
      draftWith: "companion",
      draftModelPath: "/models/qwen/mtp-x.gguf",
      decodeTokensPerSecond: 70,
    };
    expect(builtDraftFlags(withTrials([OFF, companion], 1))).toEqual({
      draftWith: "companion",
      draftModelPath: "/models/qwen/mtp-x.gguf",
    });
  });

  it("says what each trial measured", () => {
    expect(draftLines(withTrials([OFF, HEAD], 1))).toEqual([
      "Drafting: the model's own prediction head, the fastest here.",
      "nothing drafting: 48.2 tok/s",
      "the model's own prediction head: 81.5 tok/s · 77% of drafted tokens kept (231 of 300)",
    ]);
  });
});

describe("a running model's drafting line", () => {
  it("states the acceptance rate as a fact", () => {
    expect(
      speculationLine({
        types: ["ngram-mod", "draft-mtp"],
        draftModelPath: null,
        draftedTokens: 1200,
        acceptedTokens: 913,
      }),
    ).toEqual({
      text: "Drafting with repeated text and MTP head · 76% of drafted tokens kept (913 of 1,200)",
      note: null,
    });
  });

  it("says why it is off when the profile asked for it", () => {
    expect(speculationLine({ types: [], note: "This llama.cpp build does not offer it." })).toEqual(
      {
        text: "Speculative decoding: off",
        note: "This llama.cpp build does not offer it.",
      },
    );
    expect(speculationLine(null)).toBeNull();
  });
});
