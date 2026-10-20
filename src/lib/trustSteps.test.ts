import { describe, expect, it } from "vitest";

import { TRUST_GUIDES, TRUST_OS_ORDER, detectOs, orderedOs } from "./trustSteps";

describe("detectOs", () => {
  const cases: [string, string, number, string | null][] = [
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120", "Win32", 0, "windows"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605", "MacIntel", 0, "macos"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari", "iPhone", 5, "ios"],
    ["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari", "iPad", 5, "ios"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605", "MacIntel", 5, "ios"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile", "Linux armv8l", 5, "android"],
    ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) Chrome/120", "Linux x86_64", 0, "chromeos"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Firefox/120.0", "Linux x86_64", 0, "linux"],
    ["curl/8.0", "", 0, null],
  ];
  for (const [ua, platform, touch, expected] of cases) {
    it(`${expected ?? "nothing"} for ${ua.slice(0, 40)}`, () => {
      expect(detectOs(ua, platform, touch)).toBe(expected);
    });
  }
});

describe("orderedOs", () => {
  it("puts the detected OS first and keeps the rest", () => {
    const order = orderedOs("android");
    expect(order[0]).toBe("android");
    expect([...order].sort()).toEqual([...TRUST_OS_ORDER].sort());
  });
  it("uses the usual order when nothing was detected", () => {
    expect(orderedOs(null)).toEqual(TRUST_OS_ORDER);
  });
});

describe("the guides", () => {
  it("cover every OS and never tell a person to run a command", () => {
    for (const os of TRUST_OS_ORDER) {
      const guide = TRUST_GUIDES[os];
      expect(guide.steps.length).toBeGreaterThan(2);
      for (const step of [...guide.steps, ...(guide.firefox ?? [])]) {
        expect(step).not.toMatch(/\b(sudo|certutil|security add|update-ca|powershell|bash)\b/i);
      }
    }
  });
});
