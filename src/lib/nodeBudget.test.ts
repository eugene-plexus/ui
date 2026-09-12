/**
 * Turning the node's device list into a fit budget.
 *
 * The fixture is the live worker's own `GET /v1/node` answer from the
 * two-machine install, not an invented one: an RTX 5090 with 32.4 GB
 * free of 34.2, beside a CPU carrying 100 GB of host memory.
 */

import { describe, expect, it } from "vitest";

import { budgetFromNode, fitQuery } from "./nodeBudget";
import type { NodeIdentity } from "./types";

const AMISH_STATION: NodeIdentity = {
  enrolled: true,
  name: "Amish_Station",
  devices: [
    {
      kind: "cuda",
      name: "NVIDIA GeForce RTX 5090",
      index: 0,
      memoryTotalBytes: 34190917632,
      memoryFreeBytes: 32446087168,
    },
    {
      kind: "cpu",
      name: "AMD64 Family 26 Model 68 Stepping 0, AuthenticAMD",
      index: 0,
      memoryTotalBytes: 100453961728,
      memoryFreeBytes: 75783077888,
    },
  ],
};

describe("budgetFromNode", () => {
  it("scores against the card's FREE memory and the host's free memory", () => {
    const budget = budgetFromNode(AMISH_STATION);
    expect(budget?.node).toBe("Amish_Station");
    expect(budget?.gpu?.name).toBe("NVIDIA GeForce RTX 5090");
    expect(budget?.vramBytes).toBe(32446087168);
    expect(budget?.ramBytes).toBe(75783077888);
    expect(budget?.unifiedMemory).toBe(false);
  });

  it("picks the largest single card, never the sum", () => {
    // Two cards. The sum would say a 40 GB model fits; neither card holds it.
    const budget = budgetFromNode({
      enrolled: false,
      devices: [
        { kind: "cuda", name: "small", index: 1, memoryTotalBytes: 12e9, memoryFreeBytes: 11e9 },
        { kind: "cuda", name: "big", index: 0, memoryTotalBytes: 24e9, memoryFreeBytes: 23e9 },
      ],
    });
    expect(budget?.gpu?.name).toBe("big");
    expect(budget?.vramBytes).toBe(23e9);
    expect(budget?.gpuCount).toBe(2);
  });

  it("a CPU-only host is a zero VRAM budget, which the library scores against host memory", () => {
    const budget = budgetFromNode({
      enrolled: true,
      name: "468e3ed662bf",
      devices: [
        { kind: "cpu", name: "x86_64", index: 0, memoryTotalBytes: 100e9, memoryFreeBytes: 79e9 },
      ],
    });
    expect(budget?.gpu).toBeNull();
    expect(budget?.vramBytes).toBe(0);
    expect(budget?.ramBytes).toBe(79e9);
  });

  it("falls back to total when a card reports no free figure, as the library itself does", () => {
    const budget = budgetFromNode({
      enrolled: false,
      devices: [{ kind: "xpu", name: "Arc", index: 0, memoryTotalBytes: 16e9 }],
    });
    expect(budget?.vramBytes).toBe(16e9);
    expect(budget?.ramBytes).toBeNull();
  });

  it("returns null when the agent reported no devices, so the caller keeps the library's numbers", () => {
    // A fabricated zero here would score every model as CPU-only on a
    // host whose detection merely failed.
    expect(budgetFromNode({ enrolled: false, devices: [] })).toBeNull();
    expect(budgetFromNode({ enrolled: false })).toBeNull();
  });

  it("flags Apple silicon, whose one pool the library cannot be told about", () => {
    const budget = budgetFromNode({
      enrolled: false,
      devices: [
        {
          kind: "metal",
          name: "Apple M4 Max",
          index: 0,
          memoryTotalBytes: 128e9,
          memoryFreeBytes: 90e9,
        },
      ],
    });
    expect(budget?.unifiedMemory).toBe(true);
  });
});

describe("fitQuery", () => {
  it("is the two override parameters the library accepts", () => {
    expect(fitQuery(budgetFromNode(AMISH_STATION))).toEqual({
      vramBytes: "32446087168",
      ramBytes: "75783077888",
    });
  });

  it("omits ramBytes when the node reported no host memory", () => {
    const budget = budgetFromNode({
      enrolled: false,
      devices: [{ kind: "cuda", name: "x", index: 0, memoryTotalBytes: 8e9, memoryFreeBytes: 7e9 }],
    });
    expect(fitQuery(budget)).toEqual({ vramBytes: "7000000000" });
  });

  it("is empty with no budget, so a call scores against the library's own host as before", () => {
    expect(fitQuery(null)).toEqual({});
  });
});
