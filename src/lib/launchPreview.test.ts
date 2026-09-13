/**
 * The launch panel's sentence, composed from the agent's real answer
 * shapes (M11).
 *
 * The fixtures are the bodies the agent's own suite asserts on: a model
 * the node does not have (with and without a mapping that applied), a
 * memory refusal, and an admit with the location attached.
 */

import { describe, expect, it } from "vitest";

import { configTabHref, describeAdmission } from "./launchPreview";
import type { Admission } from "./types";

const NOT_HERE_MAPPED: Admission = {
  decision: "refuse",
  fit: "unknown",
  basis: "file_size",
  blockers: [],
  location: {
    path: "/models/q.gguf",
    localPath: "Z:\\models\\q.gguf",
    exists: false,
    mapping: { from: "/models", to: "Z:\\models" },
  },
  reason:
    "refuse: /models/q.gguf is not on Amish_Station. The mapping /models -> Z:\\models applied " +
    "and nothing exists at Z:\\models\\q.gguf. Check that the share is mounted at Z:\\models, or " +
    "fix the mapping: Config -> Agent @ Amish_Station -> Model directory mappings. Or pass " +
    "?force=true to launch anyway.",
};

const NOT_HERE_UNMAPPED: Admission = {
  ...NOT_HERE_MAPPED,
  location: { path: "/models/q.gguf", localPath: "/models/q.gguf", exists: false },
};

const TOO_BIG: Admission = {
  decision: "refuse",
  fit: "no",
  basis: "metadata",
  requiredBytes: 36 * 1024 ** 3,
  freeBytes: 26.5 * 1024 ** 3,
  totalBytes: 32 * 1024 ** 3,
  reason: "refuse: /models/big.gguf needs about 36.0 GiB at 131072 context ...",
  location: { path: "/models/big.gguf", localPath: "Z:\\models\\big.gguf", exists: true },
};

const ADMIT: Admission = {
  decision: "admit",
  fit: "fits",
  basis: "metadata",
  requiredBytes: 3 * 1024 ** 3,
  freeBytes: 24 * 1024 ** 3,
  totalBytes: 32 * 1024 ** 3,
  device: { kind: "cuda", index: 0, name: "NVIDIA GeForce RTX 5090" },
  reason: "admit: ...",
  location: {
    path: "/models/q.gguf",
    localPath: "Z:\\models\\q.gguf",
    exists: true,
    mapping: { from: "/models", to: "Z:\\models" },
    sizeBytes: 1_800_000_000,
    librarySizeBytes: 1_800_000_000,
    sizeMatchesLibrary: true,
  },
};

describe("describeAdmission", () => {
  it("a model the node does not have is an error that points at the mapping tab", () => {
    const preview = describeAdmission(NOT_HERE_MAPPED, "Amish_Station", "node:Amish_Station");
    expect(preview.tone).toBe("error");
    expect(preview.headline).toBe("Not on Amish_Station");
    expect(preview.detail).toContain("resolves to Z:\\models\\q.gguf there");
    expect(preview.detail).toContain("/models → Z:\\models");
    expect(preview.detail).toContain("Check the mount");
    expect(preview.fixTarget).toBe("node:Amish_Station");
  });

  it("with no mapping it says to map the library's directory", () => {
    const preview = describeAdmission(NOT_HERE_UNMAPPED, "Amish_Station", "node:Amish_Station");
    expect(preview.detail).toContain("/models/q.gguf does not exist there");
    expect(preview.detail).toContain("map the library's directory");
    expect(preview.fixTarget).toBe("node:Amish_Station");
  });

  it("a memory refusal keeps the agent's own arithmetic and offers no tab", () => {
    const preview = describeAdmission(TOO_BIG, "Amish_Station", "node:Amish_Station");
    expect(preview.tone).toBe("error");
    expect(preview.headline).toBe("Will not fit on Amish_Station");
    expect(preview.detail).toBe(TOO_BIG.reason);
    expect(preview.fixTarget).toBeNull();
  });

  it("an admit says what will be opened, through which mapping, and the numbers", () => {
    const preview = describeAdmission(ADMIT, "Amish_Station", "node:Amish_Station");
    expect(preview.tone).toBe("ok");
    expect(preview.headline).toBe("Launch on Amish_Station: fits");
    expect(preview.detail).toContain("Opens Z:\\models\\q.gguf");
    expect(preview.detail).toContain("through /models → Z:\\models");
    expect(preview.detail).toContain(
      "Needs about 3.0 GiB; 24.0 GiB free on NVIDIA GeForce RTX 5090",
    );
    expect(preview.detail).toContain("from the library's metadata");
    expect(preview.fixTarget).toBeNull();
  });

  it("a file that is not the size the library says is a warning, not a refusal", () => {
    const preview = describeAdmission(
      {
        ...ADMIT,
        location: {
          ...ADMIT.location!,
          sizeBytes: 5,
          librarySizeBytes: 10,
          sizeMatchesLibrary: false,
        },
        warning: "Z:\\models\\q.gguf is 5 bytes here but the library lists 10 for /models/q.gguf",
      },
      "Amish_Station",
      "node:Amish_Station",
    );
    expect(preview.tone).toBe("warn");
    expect(preview.detail).toContain("a different file, or a stale scan");
  });

  it("an admit on faith or with partial offload is a warning", () => {
    expect(
      describeAdmission({ ...ADMIT, fit: "unknown", warning: "no vendor tool" }, "here", "agent")
        .headline,
    ).toBe("Launch on here: admitted on faith");
    expect(describeAdmission({ ...ADMIT, fit: "split" }, "here", "agent").tone).toBe("warn");
  });

  it("an older agent with no location is described from the decision alone", () => {
    const preview = describeAdmission(
      { decision: "admit", fit: "fits", basis: "file_size", reason: "admit: ..." },
      "here",
      "agent",
    );
    expect(preview.tone).toBe("ok");
    expect(preview.detail).toBeNull();
  });
});

describe("configTabHref", () => {
  it("links to the node's agent tab", () => {
    expect(configTabHref("node:Amish_Station")).toBe("/config?tab=node%3AAmish_Station");
    expect(configTabHref("agent")).toBe("/config?tab=agent");
  });
});
