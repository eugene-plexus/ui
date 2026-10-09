/**
 * A3c — a split says which kind it is, on the badge and in its numbers.
 *
 * `split` covered 46.5 tok/s and 4.9 tok/s on the same 8 GB budget
 * (moe-aware-fit §0 M2), and the badge wrote both as *partial offload*.
 * These drive the component rather than `fitWords`: the words are
 * covered beside themselves, and every case there would stay green with
 * the badge still reading its own old table.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FitBadge } from "./FitBadge";
import type { Fit } from "@/lib/types";

const GIB = 1024 ** 3;

const MOE_SPLIT: Fit = {
  verdict: "split",
  requiredBytes: 23 * GIB,
  weightsBytes: 20.6 * GIB,
  kvCacheBytes: 1.4 * GIB,
  overheadBytes: GIB,
  contextLength: 16384,
  kvCacheType: "f16",
  basis: "metadata",
  expertBytes: 18.3 * GIB,
  offload: "experts",
  budget: {
    vramFreeBytes: 7.5 * GIB,
    vramTotalBytes: 8 * GIB,
    largestGpuFreeBytes: 7.5 * GIB,
    ramAvailableBytes: 24 * GIB,
    ramTotalBytes: 32 * GIB,
    gpuCount: 1,
    unifiedMemory: false,
    source: "detected",
  },
  notes: [],
};

describe("the badge on a split", () => {
  it("says experts in RAM for a mixture-of-experts model", () => {
    render(<FitBadge fit={MOE_SPLIT} compact withContext />);
    const badge = screen.getByTestId("fit-badge");
    expect(badge).toHaveTextContent("experts in RAM at 16k");
    expect(badge).not.toHaveTextContent("partial offload");
    expect(badge).toHaveAttribute("data-offload", "experts");
    expect(badge.getAttribute("title")).toContain("experts sit in system memory");
  });

  it("keeps partial offload for a dense spill", () => {
    render(<FitBadge fit={{ ...MOE_SPLIT, expertBytes: 0, offload: "layers" }} compact />);
    expect(screen.getByTestId("fit-badge")).toHaveTextContent("partial offload");
  });

  it("claims neither when the file's expert share was not read", () => {
    render(<FitBadge fit={{ ...MOE_SPLIT, expertBytes: null, offload: null }} compact />);
    const badge = screen.getByTestId("fit-badge");
    expect(badge).toHaveTextContent("needs RAM too");
    expect(badge).not.toHaveAttribute("data-offload");
  });

  it("opens into what sits where, with the experts-in-RAM context", () => {
    render(<FitBadge fit={MOE_SPLIT} expertsContext={61440} />);
    fireEvent.click(screen.getByTestId("fit-badge"));
    expect(screen.getByTestId("fit-placement")).toHaveTextContent(
      "The card holds everything except the experts: 4.70 GiB with the cache. Up to 18.3 GiB of experts go to system memory. That way it fits up to 61,440 tokens.",
    );
  });

  it("offers no experts context for a dense spill, whatever it is handed", () => {
    render(
      <FitBadge fit={{ ...MOE_SPLIT, expertBytes: 0, offload: "layers" }} expertsContext={61440} />,
    );
    fireEvent.click(screen.getByTestId("fit-badge"));
    const placement = screen.getByTestId("fit-placement");
    expect(placement).toHaveTextContent("some whole layers run from system memory");
    expect(placement).not.toHaveTextContent("61,440");
  });
});
