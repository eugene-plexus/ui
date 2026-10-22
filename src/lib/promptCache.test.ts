/**
 * Row 9 (PC7): a running model says the prompt cache it was started with, and the profile
 * editor says what an unset cache setting really does (Eugene passes the default).
 */

import { describe, expect, it } from "vitest";

import { ACTS_WHEN_UNSET } from "./speculation";
import { PROMPT_CACHE_KEYS, promptCacheLine } from "./promptCache";

const GIB = 1024 ** 3;

describe("a running model's prompt cache line", () => {
  it("says the size and that the profile set it", () => {
    expect(promptCacheLine({ bytes: 24 * GIB, source: "profile", note: null })).toEqual({
      text: "Prompt cache: 24 GiB of system memory, set on the profile.",
      note: null,
    });
  });

  it("says the default it was started with", () => {
    expect(promptCacheLine({ bytes: 8 * GIB, source: "engine_default" })).toEqual({
      text: "Prompt cache: 8 GiB of system memory, the default.",
      note: null,
    });
  });

  it("says a size typed into the extra arguments, with the agent's note", () => {
    expect(
      promptCacheLine({
        bytes: 2 * GIB,
        source: "extra_args",
        note: "Set to 2 GiB in extraArgs, after the profile's 24 GiB, so the profile's does not apply.",
      }),
    ).toEqual({
      text: "Prompt cache: 2 GiB of system memory, set in the extra arguments.",
      note: "Set to 2 GiB in extraArgs, after the profile's 24 GiB, so the profile's does not apply.",
    });
  });

  it("says off, and a size under a gibibyte in mebibytes", () => {
    expect(promptCacheLine({ bytes: 0, source: "off" })?.text).toBe("Prompt cache: off.");
    expect(promptCacheLine({ bytes: 512 * 1024 ** 2, source: "profile" })?.text).toBe(
      "Prompt cache: 512 MiB of system memory, set on the profile.",
    );
    expect(promptCacheLine({ bytes: 1.5 * GIB, source: "profile" })?.text).toBe(
      "Prompt cache: 1.5 GiB of system memory, set on the profile.",
    );
  });

  it("says when the build does not offer it, with the agent's reason", () => {
    expect(
      promptCacheLine({
        bytes: null,
        source: "unsupported",
        note: "This llama.cpp build has no --cache-ram, so Prompt cache in system memory is not passed.",
      }),
    ).toEqual({
      text: "Prompt cache: not set",
      note: "This llama.cpp build has no --cache-ram, so Prompt cache in system memory is not passed.",
    });
  });

  it("says no limit when extra arguments ask for none", () => {
    expect(
      promptCacheLine({ bytes: null, source: "extra_args", note: "There is no limit." })?.text,
    ).toBe("Prompt cache: no limit, set in the extra arguments.");
  });

  it("says nothing for a runtime that reports none", () => {
    expect(promptCacheLine(null)).toBeNull();
    expect(promptCacheLine(undefined)).toBeNull();
  });
});

describe("the profile editor and an unset cache setting", () => {
  it("shows the adapter's own words, because Eugene passes the default", () => {
    // For every other flag, unset means nothing is passed and the editor says so. These
    // three are always passed, so "not passed" would be a lie (settings never lie).
    for (const key of ["cacheRam", "cacheReuse", "ctxCheckpoints"]) {
      expect(PROMPT_CACHE_KEYS.has(key)).toBe(true);
      expect(ACTS_WHEN_UNSET.has(key)).toBe(true);
    }
  });
});
