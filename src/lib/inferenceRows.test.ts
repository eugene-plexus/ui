/**
 * The Inference screen's join, against what the live install returned.
 *
 * The four bodies below are the worker's own proxy answers on
 * 2026-09-12 -- one Ollama-backed driver on Amish_Station, no supervised
 * runtimes, a gateway that sees it and routes to it. Not invented.
 */

import { describe, expect, it } from "vitest";

import { type Row, type Sources, buildRows } from "./inferenceRows";

/** `noUncheckedIndexedAccess`: say what an empty result means. */
function first(rows: Row[]): Row {
  const row = rows[0];
  if (row === undefined) throw new Error("expected at least one row");
  return row;
}

const LIVE: Sources = {
  drivers: {
    drivers: [
      {
        name: "ollama-qwen",
        reachable: true,
        url: "http://192.168.16.75:8081/",
        backend: "openai_compat_http",
        modelId: "qwen3-coder:30b",
        runtime: undefined,
        version: "0.1.0",
        error: undefined,
      },
    ],
  },
  routing: {
    refreshed_at: "2026-09-12T20:42:42.250973Z",
    load_balancing: "least_busy",
    slots: [
      {
        model: "qwen3-coder:30b",
        configured: false,
        tiers: [
          {
            target: "qwen3-coder:30b",
            backends: [
              {
                driver: "ollama-qwen",
                url: "http://192.168.16.75:8081/",
                eligible: true,
                in_flight: 0,
                parallel_slots: 1,
              },
            ],
          },
        ],
      },
    ],
    unreachable_drivers: [],
  } as unknown as Sources["routing"],
  placement: {
    components: [
      {
        node: "468e3ed662bf",
        name: "control",
        kind: "control",
        url: "http://127.0.0.1:8083/",
        status: "running",
      },
      {
        node: "468e3ed662bf",
        name: "gateway",
        kind: "gateway",
        url: "http://127.0.0.1:8080/",
        status: "running",
      },
      {
        node: "468e3ed662bf",
        name: "library",
        kind: "library",
        url: "http://127.0.0.1:8082/",
        status: "running",
      },
      {
        node: "Amish_Station",
        name: "ollama-qwen",
        kind: "inference-driver",
        url: "http://127.0.0.1:8081/",
        status: "running",
      },
    ],
    unreachableNodes: [],
  },
  runtimes: { runtimes: [], unreachableNodes: [] },
  localRuntimes: null,
};

describe("buildRows against the live install", () => {
  it("puts the Ollama-backed driver on the node the control root places it on", () => {
    const rows = buildRows(LIVE, "Amish_Station");
    expect(rows).toHaveLength(1);
    const row = first(rows);
    // The row the old Runtimes page had no category for.
    expect(row.node).toBe("Amish_Station");
    expect(row.driver).toBe("ollama-qwen");
    expect(row.model).toBe("qwen3-coder:30b");
    expect(row.backend).toBe("openai_compat_http");
    expect(row.runtime).toBeNull();
    expect(row.reachable).toBe(true);
    expect(row.eligible).toBe(true);
    expect(row.inFlight).toBe(0);
  });

  it("does not turn the control plane's own components into rows", () => {
    // control, gateway and library are placed too; none of them serves.
    expect(buildRows(LIVE, "Amish_Station").every((r) => r.driver === "ollama-qwen")).toBe(true);
  });
});

describe("buildRows joins and fallbacks", () => {
  it("a driver that follows a runtime takes the runtime's node, engine and state", () => {
    const rows = buildRows(
      {
        ...LIVE,
        drivers: {
          drivers: [
            {
              name: "qwen-driver",
              reachable: true,
              backend: "openai_compat_http",
              modelId: "qwen",
              runtime: "qwen",
            },
          ],
        },
        routing: null,
        placement: {
          components: [{ node: "gpu-box", name: "qwen-driver", kind: "inference-driver" }],
        },
        runtimes: {
          runtimes: [
            {
              node: "gpu-box",
              name: "qwen",
              modelAlias: "qwen",
              status: "loading",
              engine: "llama_cpp",
            },
          ],
        },
      },
      null,
    );
    expect(rows).toHaveLength(1);
    expect(first(rows).runtime).toBe("qwen");
    expect(first(rows).engine).toBe("llama_cpp");
    expect(first(rows).runtimeStatus).toBe("loading");
    expect(first(rows).node).toBe("gpu-box");
  });

  it("a declared driver the gateway never mentioned is still a row, marked unknown to the gateway", () => {
    const rows = buildRows({ ...LIVE, drivers: { drivers: [] }, routing: null }, "Amish_Station");
    expect(rows).toHaveLength(1);
    expect(first(rows).driver).toBe("ollama-qwen");
    expect(first(rows).reachable).toBeNull();
    expect(first(rows).node).toBe("Amish_Station");
  });

  it("a runtime with no driver yet is a row from the control root's side", () => {
    const rows = buildRows(
      {
        ...LIVE,
        drivers: { drivers: [] },
        routing: null,
        placement: null,
        runtimes: {
          runtimes: [{ node: "gpu-box", name: "fresh", status: "starting", engine: "vllm" }],
        },
      },
      null,
    );
    expect(rows.map((r) => [r.runtime, r.node, r.runtimeStatus])).toEqual([
      ["fresh", "gpu-box", "starting"],
    ]);
  });

  it("without a control root, runtimes come from the local agent and are placed on this node", () => {
    const rows = buildRows(
      {
        drivers: null,
        routing: null,
        placement: null,
        runtimes: null,
        localRuntimes: {
          runtimes: [{ name: "solo", status: "ready", engine: "llama_cpp", modelAlias: "m" }],
        } as Sources["localRuntimes"],
      },
      "this-box",
    );
    expect(rows).toHaveLength(1);
    expect(first(rows).node).toBe("this-box");
    expect(first(rows).runtime).toBe("solo");
  });
});
