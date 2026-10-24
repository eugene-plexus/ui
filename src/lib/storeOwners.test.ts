import { describe, expect, it } from "vitest";

import { buildCards, ownersFor } from "./settingsTopics";
import { formatBytes, ownerLabel, sweepLine } from "./storeOwners";
import type { ConfigSchema } from "./types";

const names = {
  people: new Map([["p1", "Ann"]]),
  keys: new Map([["k1", "Open WebUI"]]),
};

describe("the store's owners, as a person reads them", () => {
  it("names people, keys and the console, and never an id", () => {
    expect(ownerLabel("person:p1", names)).toBe("Ann");
    expect(ownerLabel("person:gone", names)).toBe("A removed or unknown person");
    expect(ownerLabel("key:k1", names)).toBe('App key "Open WebUI"');
    expect(ownerLabel("install", names)).toBe("You (this console)");
  });

  it("says bytes in the unit a person expects", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(40 * 1024 * 1024)).toBe("40 MiB");
    expect(formatBytes(10 * 1024 ** 3)).toBe("10 GiB");
  });

  it("leads the sweep line with what it did, and names a failure's cause", () => {
    const at = "2026-10-23T00:00:00Z";
    expect(sweepLine({ at, files: 0, uploads: 0, parts: 0, blobs: 0, freedBytes: 0 })).toBe(
      "Nothing had ended at the last sweep.",
    );
    expect(
      sweepLine({
        at,
        files: 2,
        uploads: 1,
        parts: 3,
        blobs: 2,
        freedBytes: 2048,
        removal: { checked: 2, hidden: 0, restored: 0, deleted: 1 },
      }),
    ).toBe(
      "The last sweep deleted 2 files and 1 upload (2.0 KiB), including everything 1 removed person kept.",
    );
    expect(
      sweepLine({
        at,
        files: 0,
        uploads: 0,
        parts: 0,
        blobs: 0,
        freedBytes: 0,
        removal: {
          checked: 1,
          hidden: 0,
          restored: 0,
          deleted: 0,
          error: "the control root is locked",
        },
      }),
    ).toContain("Removed people were not checked: the control root is locked");
    expect(
      sweepLine({
        at,
        files: 0,
        uploads: 0,
        parts: 0,
        blobs: 0,
        freedBytes: 0,
        removal: { checked: 3, hidden: 2, restored: 1, deleted: 0 },
      }),
    ).toBe(
      "Nothing had ended at the last sweep. 2 removed people's files are now hidden. 1 person Eugene has again has their files back.",
    );
  });
});

describe("Settings -> Files apps keep", () => {
  it("is the store's card, when the install has a store", () => {
    const topology = {
      localNode: "nas",
      nodes: ["nas"],
      components: [
        { kind: "gateway", name: "gateway", node: "nas" },
        { kind: "store", name: "store", node: "nas" },
      ],
    } as unknown as Parameters<typeof ownersFor>[1];
    const owners = ownersFor(null, topology);
    const store = owners.find((o) => o.component === "store");
    expect(store?.target).toBe("store");
    const schema: ConfigSchema = {
      component: "store",
      fields: [
        { key: "filesEnabled", label: "Keep files", valueType: "boolean", category: "files" },
        { key: "ownerQuotaGiB", label: "Space", valueType: "integer", category: "quotas" },
        { key: "removedPeopleDays", label: "Days", valueType: "integer", category: "people" },
        { key: "logLevel", label: "Log level", valueType: "enum", category: "logging" },
      ],
    } as ConfigSchema;
    const cards = buildCards([store!], new Map([["store", schema]]), "");
    const files = cards.find((c) => c.topic === "files");
    expect(files?.label).toBe("Files apps keep");
    expect(files?.sections[0]?.keys).toEqual([
      "filesEnabled",
      "ownerQuotaGiB",
      "removedPeopleDays",
    ]);
    expect(cards.find((c) => c.topic === "metrics-logs")?.sections[0]?.keys).toEqual(["logLevel"]);
  });
});
