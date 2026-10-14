/**
 * `readValue`: what a widget can truthfully show for what a component sent.
 * Settings never lie (Troy, 2026-09-29). See the module's docblock.
 */

import { describe, expect, it } from "vitest";

import { isFieldVisible } from "./configPresentation";
import { effectiveValue, formatValue, readValue, unsetSentence } from "./configValue";
import type { ConfigField } from "./types";

function field(over: Partial<ConfigField>): ConfigField {
  return {
    key: "k",
    label: "K",
    category: "c",
    valueType: "string",
    sensitive: false,
    required: false,
    requiresRestart: false,
    pendingRestart: false,
    ...over,
  } as ConfigField;
}

describe("readValue", () => {
  it("null and missing are unset, for every type", () => {
    for (const valueType of ["boolean", "enum", "integer", "string", "path_list"] as const) {
      expect(readValue(field({ valueType, enumValues: ["a"] }), null).kind).toBe("unset");
      expect(readValue(field({ valueType, enumValues: ["a"] }), undefined).kind).toBe("unset");
    }
  });

  it("an enum value that is not a choice cannot be shown as one", () => {
    const enumField = field({ valueType: "enum", enumValues: ["edge", "releases"] });
    expect(readValue(enumField, "edge")).toEqual({ kind: "value" });
    const beta = readValue(enumField, "beta");
    expect(beta.kind).toBe("unrepresentable");
    expect(readValue(enumField, 3).kind).toBe("unrepresentable");
  });

  it("a boolean is only a boolean", () => {
    const flag = field({ valueType: "boolean" });
    expect(readValue(flag, false)).toEqual({ kind: "value" });
    expect(readValue(flag, "false").kind).toBe("unrepresentable");
    expect(readValue(flag, 0).kind).toBe("unrepresentable");
  });

  it("numbers: a string cannot be shown, a number out of range is shown and said", () => {
    const n = field({ valueType: "integer", minimum: 1, maximum: 64 });
    expect(readValue(n, 12)).toEqual({ kind: "value" });
    expect(readValue(n, "12").kind).toBe("unrepresentable");
    expect(readValue(n, Number.NaN).kind).toBe("unrepresentable");
    const high = readValue(n, 1000);
    expect(high.kind === "value" && high.warning).toMatch("1 to 64");
    const frac = readValue(n, 2.5);
    expect(frac.kind === "value" && frac.warning).toMatch("whole number");
  });

  it("empty text is unset only where the component says what unset means", () => {
    expect(readValue(field({}), "")).toEqual({ kind: "value" });
    expect(readValue(field({ unsetMeans: "found by the agent" }), "").kind).toBe("unset");
    expect(readValue(field({}), { a: 1 }).kind).toBe("unrepresentable");
  });

  it("list entries that cannot be read are counted", () => {
    const list = readValue(field({ valueType: "url_list" }), ["http://a", 7]);
    expect(list.kind === "value" && list.warning).toMatch("1 entry");
    expect(readValue(field({ valueType: "url_list" }), "http://a").kind).toBe("unrepresentable");
    const maps = readValue(field({ valueType: "path_mappings" }), [{ from: "/m" }]);
    expect(maps.kind === "value" && maps.warning).toMatch("1 entry");
  });
});

describe("words", () => {
  it("an empty list is 'empty', never 'none'", () => {
    expect(formatValue(field({ valueType: "url_list" }), [])).toBe("empty");
  });

  it("an unset field says the component's words, else its default, else plainly", () => {
    expect(unsetSentence(field({ unsetMeans: "No cap." }))).toBe("No cap.");
    expect(unsetSentence(field({ valueType: "integer", default: 15 }))).toBe(
      "Not set: uses the default, 15.",
    );
    expect(unsetSentence(field({}))).toBe("Not set.");
  });
});

describe("showWhen reads the effective value", () => {
  it("a field whose condition is the controller's default is shown", () => {
    const provider = field({ key: "provider", valueType: "enum", default: "openai" });
    const key = field({ key: "apiKey", showWhen: { key: "provider", equals: ["openai"] } });
    expect(effectiveValue("provider", {}, [provider, key])).toBe("openai");
    expect(isFieldVisible(key, {}, [provider, key])).toBe(true);
    expect(isFieldVisible(key, { provider: "xai" }, [provider, key])).toBe(false);
  });
});
