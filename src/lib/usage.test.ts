import { describe, expect, it } from "vitest";

import {
  allowanceLine,
  allowancesBody,
  describeAllowances,
  dollarsToMicros,
  microsToDollars,
  rootKnowsAllowances,
  usd,
} from "./usage";

describe("row 40 money", () => {
  it("turns typed dollars into exact micro-dollars on the digits", () => {
    expect(dollarsToMicros("4")).toBe(4_000_000);
    expect(dollarsToMicros("$4.00")).toBe(4_000_000);
    expect(dollarsToMicros("1,250.5")).toBe(1_250_500_000);
    expect(dollarsToMicros("0.000001")).toBe(1);
    // 0.1 + 0.2 is not 0.3 in a float; here it is never added as one.
    expect(dollarsToMicros("0.3")).toBe(300_000);
    expect(dollarsToMicros("")).toBeUndefined();
    expect(dollarsToMicros("0.0000001")).toBeNull();
    expect(dollarsToMicros("-1")).toBeNull();
    expect(dollarsToMicros("four")).toBeNull();
  });

  it("says micro-dollars and the root's exact strings as a person reads them", () => {
    expect(microsToDollars(4_000_000)).toBe("4.00");
    expect(microsToDollars(10_500)).toBe("0.0105");
    expect(microsToDollars(1)).toBe("0.000001");
    expect(usd("0.010500000000")).toBe("$0.0105");
    expect(usd("1234.000000000000")).toBe("$1,234.00");
  });

  it("sends only the allowances that are set", () => {
    expect(allowancesBody({ tokensPerDay: 10, tokensPerMonth: null })).toEqual({
      tokensPerDay: 10,
    });
    expect(describeAllowances({ tokensPerDay: 1000, costPerMonthMicros: 4_000_000 })).toBe(
      "1,000 tokens a day · $4.00 a month",
    );
    expect(describeAllowances({})).toBe("");
  });

  it("offers group allowances only to a root that answers them", () => {
    expect(rootKnowsAllowances([{ policies: { queueBand: null } }])).toBe(false);
    expect(rootKnowsAllowances([{ policies: { queueBand: null, tokensPerDay: null } }])).toBe(true);
    expect(rootKnowsAllowances(null)).toBe(false);
  });

  it("says a spent allowance and when it resets", () => {
    const line = allowanceLine({
      kind: "costPerMonth",
      limit: "4.000000000000",
      used: "4.010000000000",
      left: "0.000000000000",
      spent: true,
      resetsAt: "2026-12-01T00:00:00Z",
    });
    expect(line).toBe("$4.01 of $4.00 this month. Spent: refused until 1 Dec, 00:00 UTC.");
  });
});
