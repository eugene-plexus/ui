import { describe, expect, it } from "vitest";

import {
  accountWords,
  applyOrder,
  effectiveOrderWords,
  moveKey,
  orderChanged,
  orderKey,
  orderPatch,
  type SearchAccountView,
} from "./searchOrder";

const a = (name: string, extra: Partial<SearchAccountView> = {}): SearchAccountView => ({
  name,
  provider: name,
  runs: true,
  placed_by: "default",
  ...extra,
});

describe("web search order", () => {
  it("keys an account by name, or node:name when it has a machine", () => {
    expect(orderKey(a("brave"))).toBe("brave");
    expect(orderKey(a("searxng", { node: "nas" }))).toBe("nas:searxng");
    expect(orderKey(a("x", { node: null }))).toBe("x");
  });

  it("applies a draft: named first, the rest after, gone names dropped", () => {
    const accounts = [a("one"), a("two"), a("three")];
    expect(applyOrder(accounts, null).map(orderKey)).toEqual(["one", "two", "three"]);
    expect(applyOrder(accounts, ["three", "ghost", "one"]).map(orderKey)).toEqual([
      "three",
      "one",
      "two",
    ]);
  });

  it("moves one place and stops at the ends", () => {
    expect(moveKey(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveKey(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveKey(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });

  it("builds the PATCH body, empty for the default", () => {
    expect(orderPatch(["google", "nas:searxng"])).toEqual({
      webSearchOrder: ["google", "nas:searxng"],
    });
    expect(orderPatch([])).toEqual({ webSearchOrder: [] });
  });

  it("knows a draft that changes nothing", () => {
    const accounts = [a("one"), a("two")];
    expect(orderChanged(accounts, null)).toBe(false);
    expect(orderChanged(accounts, ["one", "two"])).toBe(false);
    expect(orderChanged(accounts, ["two", "one"])).toBe(true);
  });

  it("says which order is in effect, in the gateway's words, not the draft's", () => {
    expect(effectiveOrderWords([])).toBe("");
    expect(effectiveOrderWords([a("one"), a("two")])).toBe(
      "The default order is in effect: free accounts first, then this machine's before others.",
    );
    expect(
      effectiveOrderWords([a("one", { placed_by: "order" }), a("two", { placed_by: "order" })]),
    ).toBe("Your order is in effect.");
    expect(effectiveOrderWords([a("one", { placed_by: "order" }), a("two")])).toContain(
      "Your order is in effect for the first 1. The rest follow the default order",
    );
  });

  it("words a row: label, machine, billing, not set up", () => {
    expect(
      accountWords(a("s", { label: "SearXNG", node: "nas", billing: "free", runs: false })),
    ).toEqual({ title: "SearXNG", where: "on nas", billing: "free", notSetUp: true });
    expect(accountWords(a("brave", { billing: "per_search" }))).toEqual({
      title: "brave",
      where: null,
      billing: "billed per search",
      notSetUp: false,
    });
  });
});
