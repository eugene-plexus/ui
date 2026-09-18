/**
 * R2.3 — a verdict of `unknown` has to read as one.
 *
 * Roadmap `specs/docs/design/release-roadmap.md` §3.3, review §6.2 #28.
 * The library reports `unknown` when there is a GPU here and no vendor
 * tool would say how much memory it has: `_intel_gpus` fills in
 * `vramTotalBytes: 0`, and the verdict used to take the *no
 * accelerator* branch and tell a 16 GB Arc owner that a 30 GB model
 * fits — wrong in the direction that runs out of memory at load.
 *
 * **The badge is where a person meets it**, so three things are checked
 * here and none of them is "the enum has a fifth member": the word
 * shown, the colour role it is given, and the fact that a `Record` over
 * `FitVerdict` cannot silently omit it. That last one is the type
 * checker's job — it failed three times the moment the contract landed,
 * which is the point of generating the type rather than writing it.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FitBadge, BudgetLine } from "./FitBadge";
import type { Fit, MemoryBudget } from "@/lib/types";

const GIB = 1024 ** 3;

/** Exactly what the library returns for an Arc whose size xpu-smi will
 * not state: a card counted, no memory known. */
const UNSEEN_CARD: MemoryBudget = {
  vramFreeBytes: 0,
  vramTotalBytes: 0,
  largestGpuFreeBytes: 0,
  ramAvailableBytes: 24 * GIB,
  ramTotalBytes: 32 * GIB,
  gpuCount: 1,
  unifiedMemory: false,
  source: "detected",
};

const UNKNOWN_FIT: Fit = {
  verdict: "unknown",
  requiredBytes: 30 * GIB,
  weightsBytes: 28 * GIB,
  kvCacheBytes: 1 * GIB,
  overheadBytes: 1 * GIB,
  contextLength: 8192,
  kvCacheType: "f16",
  basis: "metadata",
  budget: UNSEEN_CARD,
  notes: [
    "this machine has 1 graphics card(s) and no vendor tool here would say how much " +
      "memory they have, so there is nothing to compare against -- the verdict is " +
      "unknown rather than a guess.",
  ],
};

describe("a verdict of unknown", () => {
  it("does not read as a yes", () => {
    render(<FitBadge fit={UNKNOWN_FIT} />);
    const badge = screen.getByTestId("fit-badge");
    expect(badge).toHaveTextContent(/unknown|can.t tell/i);
    expect(badge).not.toHaveTextContent(/^fits/i);
  });

  it("is not dressed as a success", () => {
    // `status-success` is the green one. An `unknown` wearing it is the
    // same lie the verdict itself used to tell, one layer up.
    render(<FitBadge fit={UNKNOWN_FIT} />);
    expect(screen.getByTestId("fit-badge").className).not.toContain("status-success");
  });

  it("says what is missing rather than only that something is", () => {
    render(<FitBadge fit={UNKNOWN_FIT} compact />);
    const title = screen.getByTestId("fit-badge").getAttribute("title") ?? "";
    expect(title.toLowerCase()).toMatch(/memory|size/);
  });

  it("carries the context like every other verdict", () => {
    render(<FitBadge fit={UNKNOWN_FIT} withContext />);
    expect(screen.getByTestId("fit-badge")).toHaveTextContent("8k");
  });
});

describe("the budget line under it", () => {
  it("does not claim there is no GPU when there is one we could not measure", () => {
    // `gpuCount > 0` with zero bytes used to print "measured against
    // 0 B free of 0 B on the GPU", which is the absurdity the review
    // photographed beside the word `fits`.
    render(<BudgetLine budget={UNSEEN_CARD} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/no GPU detected/i);
    expect(text).not.toMatch(/0 B free of 0 B/i);
    expect(text.toLowerCase()).toMatch(/could not|unknown/);
  });

  it("still says so when there really is no GPU", () => {
    render(<BudgetLine budget={{ ...UNSEEN_CARD, gpuCount: 0 }} />);
    expect(document.body.textContent ?? "").toMatch(/no GPU detected/i);
  });
});
