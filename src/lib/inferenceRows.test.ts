/**
 * The Inference screen's join, against what the live install returned.
 *
 * The four bodies below are the worker's own proxy answers on
 * 2026-09-12 -- one Ollama-backed driver on Amish_Station, no supervised
 * runtimes, a gateway that sees it and routes to it. Not invented.
 */

import { describe, expect, it } from "vitest";

import { type Row, type Sources, buildRows, nodeDetails, runtimeOf } from "./inferenceRows";

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

describe("nodeDetails, the half the control root cannot answer", () => {
  it("keys by the node name a row carries, null host included", () => {
    const details = nodeDetails([
      {
        name: null,
        identity: JSON.parse('{"enrolled":false,"devices":[{"kind":"cuda"}]}'),
        runtimes: JSON.parse(
          String.raw`{"runtimes":[{"name":"r1","engine":"llama_cpp",
            "modelPath":"/m/a.gguf","status":"loading",
            "lastRestart":"2026-09-16T13:59:26.000Z",
            "localPath":"\\\\tower\\models\\a.gguf",
            "flags":{"gpuLayers":0}}]}`,
        ),
      },
    ]);
    const detail = details.get(null);
    expect(detail?.devices).toHaveLength(1);
    const runtime = detail?.runtimes.get("r1");
    // The four fields `RuntimePlacement` does not carry, which is the
    // whole reason this read exists.
    expect(runtime?.flags).toEqual({ gpuLayers: 0 });
    expect(runtime?.lastRestart).toBe("2026-09-16T13:59:26.000Z");
    expect(runtime?.localPath).toBe(String.raw`\\tower\models\a.gguf`);
  });

  it("keeps 'did not answer' apart from 'has no accelerator'", () => {
    // `describeCompute` says nothing at all for the first and something
    // definite for the second, so collapsing them would put "on the
    // processor" on every row of a node that is merely slow to reply.
    const details = nodeDetails([
      { name: "down", identity: null, runtimes: null },
      { name: "cpu-only", identity: JSON.parse('{"enrolled":true,"devices":[]}'), runtimes: null },
    ]);
    expect(details.get("down")?.devices).toBeNull();
    expect(details.get("cpu-only")?.devices).toEqual([]);
  });
});

describe("runtimeOf", () => {
  const details = nodeDetails([
    {
      name: "Amish_Station",
      identity: null,
      runtimes: JSON.parse(
        '{"runtimes":[{"name":"r1","engine":"llama_cpp","modelPath":"/m/a.gguf","status":"ready"}]}',
      ),
    },
  ]);

  it("finds a row's runtime on its own node", () => {
    expect(runtimeOf({ node: "Amish_Station", runtime: "r1" }, details)?.status).toBe("ready");
  });

  it("is null for a row with no runtime, or a node that did not answer", () => {
    expect(runtimeOf({ node: "Amish_Station", runtime: null }, details)).toBeNull();
    expect(runtimeOf({ node: "elsewhere", runtime: "r1" }, details)).toBeNull();
    // And never another node's runtime that happens to share a name.
    expect(runtimeOf({ node: null, runtime: "r1" }, details)).toBeNull();
  });
});

describe("one model on two machines", () => {
  // What the Library produces: the runtime is named after the model and
  // its driver after the runtime, on BOTH machines. The gateway keys them
  // by (node, name) since R1.6; this join used to key them by name alone.
  const TWO: Sources = {
    drivers: {
      drivers: [
        {
          name: "qwen-driver",
          url: "http://10.0.0.1:8084/",
          reachable: true,
          modelId: "qwen",
          runtime: "qwen",
        },
        {
          name: "qwen-driver",
          url: "http://10.0.0.2:8084/",
          reachable: true,
          modelId: "qwen",
          runtime: "qwen",
        },
      ],
    },
    routing: {
      slots: [
        {
          model: "qwen",
          tiers: [
            {
              tier: 1,
              backends: [
                {
                  driver: "qwen-driver",
                  url: "http://10.0.0.1:8084/",
                  node: "node-a",
                  runtime: "qwen",
                  eligible: false,
                  in_flight: 0,
                },
                {
                  driver: "qwen-driver",
                  url: "http://10.0.0.2:8084/",
                  node: "node-b",
                  runtime: "qwen",
                  eligible: true,
                  in_flight: 2,
                },
              ],
            },
          ],
        },
      ],
    } as never,
    placement: {
      components: [
        {
          node: "node-a",
          name: "qwen-driver",
          kind: "inference-driver",
          url: "http://10.0.0.1:8084/",
        },
        {
          node: "node-b",
          name: "qwen-driver",
          kind: "inference-driver",
          url: "http://10.0.0.2:8084/",
        },
      ],
    } as never,
    runtimes: {
      runtimes: [
        {
          node: "node-a",
          name: "qwen",
          modelAlias: "qwen",
          status: "stopped",
          engine: "llama_cpp",
        },
        { node: "node-b", name: "qwen", modelAlias: "qwen", status: "ready", engine: "llama_cpp" },
      ],
    } as never,
    localRuntimes: null,
  };

  it("is two rows, each on its own machine with its own state", () => {
    const rows = buildRows(TWO, "node-a");
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.node === "node-a");
    const b = rows.find((r) => r.node === "node-b");
    expect(a?.runtimeStatus).toBe("stopped");
    expect(a?.eligible).toBe(false);
    expect(b?.runtimeStatus).toBe("ready");
    expect(b?.inFlight).toBe(2);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it("adds no third row for either machine's runtime", () => {
    expect(buildRows(TWO, "node-a").filter((r) => r.driver === null)).toHaveLength(0);
  });
});
