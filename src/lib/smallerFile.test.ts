import { describe, expect, it } from "vitest";

import { SMALLER_CAVEAT, noneLine, offerLine, originOf, pickSmaller } from "./smallerFile";
import type { CatalogueCandidate, Download, Fit } from "./types";

function candidate(label: string, gb: number, verdict: string): CatalogueCandidate {
  return {
    label,
    format: "gguf",
    files: [{ path: `${label}.gguf`, sizeBytes: gb * 1e9 }],
    sizeBytes: gb * 1e9,
    fit: { verdict, contextLength: 16384 },
  } as unknown as CatalogueCandidate;
}

function download(over: Partial<Download>): Download {
  return {
    id: "d",
    state: "done",
    repo: "unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF",
    revision: "main",
    files: [],
    ...over,
  } as unknown as Download;
}

describe("originOf", () => {
  it("names the repository the model's own finished download came from", () => {
    const downloads = [
      download({ id: "other", modelId: "someone-else", repo: "a/b" }),
      download({
        id: "old",
        modelId: "m",
        resolvedCommit: "abc",
        finishedAt: "2026-09-01T00:00:00Z",
      }),
      download({ id: "new", modelId: "m", repo: "c/d", finishedAt: "2026-09-30T00:00:00Z" }),
    ];
    expect(originOf(downloads, "m")).toEqual({ repo: "c/d", revision: "main" });
  });

  it("prefers the commit a download resolved to over the branch it asked for", () => {
    expect(originOf([download({ modelId: "m", resolvedCommit: "abc123" })], "m")).toEqual({
      repo: "unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF",
      revision: "abc123",
    });
  });

  it("knows nothing about a file copied in by hand, or a download that did not finish", () => {
    expect(originOf([], "m")).toBeNull();
    expect(originOf([download({ modelId: "m", state: "failed" })], "m")).toBeNull();
  });
});

describe("pickSmaller", () => {
  const GIB = 1024 ** 3;
  // The real Qwen3-30B-A3B repository's sizes, with the catalogue's own
  // size-only verdicts, which are wrong at a long context and are ignored.
  const repo = [
    candidate("Q5_K_M", 21.73, "no"),
    candidate("Q4_K_M", 18.56, "no"),
    candidate("IQ4_XS", 16.38, "no"),
    candidate("Q3_K_M", 14.71, "no"),
    candidate("UD-IQ3_XXS", 12.91, "split"),
    candidate("UD-TQ1_0", 8.09, "split"),
  ];
  /** The file on disk's own fit: its real cache and overhead, on one card. */
  function fitOf(cardGiB: number, cacheGiB: number, verdict = "split"): Fit {
    return {
      verdict,
      kvCacheBytes: cacheGiB * GIB,
      overheadBytes: GIB,
      budget: { vramFreeBytes: (cardGiB - 1) * GIB },
    } as unknown as Fit;
  }
  const Q4 = 18.56e9;

  it("offers the largest smaller quant whose weights fit beside this file's cache", () => {
    // Measured shape, 24 GB card at 64k f16: 6.0 GiB of cache + 1 GiB.
    expect(pickSmaller(repo, fitOf(24, 6.0), Q4)?.label).toBe("IQ4_XS");
    // 16 GB at 16k: 1.5 GiB of cache.
    expect(pickSmaller(repo, fitOf(16, 1.5), Q4)?.label).toBe("UD-IQ3_XXS");
  });

  it("uses this file's cache, not the catalogue's guess from size", () => {
    // Every verdict above says "no" or "split"; the arithmetic still finds one.
    expect(repo.every((c) => c.fit?.verdict !== "fits")).toBe(true);
    expect(pickSmaller(repo, fitOf(24, 6.0), Q4)).not.toBeNull();
  });

  it("offers nothing where no smaller quant fits, as on an 8 GB card", () => {
    expect(pickSmaller(repo, fitOf(8, 1.5), Q4)).toBeNull();
    expect(pickSmaller(repo, fitOf(8, 6.0), Q4)).toBeNull();
  });

  it("never offers the same size or larger", () => {
    expect(pickSmaller(repo, fitOf(48, 1.5), Q4)?.label).toBe("IQ4_XS");
  });

  it("cannot say without the machine's memory or the file's cache", () => {
    expect(pickSmaller(repo, { ...fitOf(24, 6.0), budget: undefined } as Fit, Q4)).toBeNull();
    expect(
      pickSmaller(repo, { ...fitOf(24, 6.0), kvCacheBytes: undefined } as unknown as Fit, Q4),
    ).toBeNull();
  });
});

describe("the words", () => {
  it("say what it is and where it sits, and promise nothing about answers", () => {
    expect(offerLine(candidate("UD-Q3_K_XL", 13.8, "fits"), 16384)).toBe(
      "A smaller version, UD-Q3_K_XL (13.8 GB), fits entirely on the card at 16k.",
    );
    expect(SMALLER_CAVEAT).toContain("does not measure how much");
    expect(noneLine(65536)).toBe(
      "No smaller version of this model fits entirely on the card at 64k.",
    );
  });
});
