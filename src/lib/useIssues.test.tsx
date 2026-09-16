/**
 * The Issues poll, driven.
 *
 * `issues.test.ts` covers the rules; what is left here is everything the
 * pure module cannot see — which endpoints are asked, on which node,
 * with which credential, and **whether the identity read is bracketed**.
 * That last one is the reason this file exists: a `useIssues` that
 * forgets the two `Date.now()` marks produces an empty `readWindow`,
 * `skewBetween` returns null for every pair, and no clock issue is ever
 * raised — with nothing failing anywhere. So the skew case here is
 * driven end to end, against two hosts that really disagree.
 *
 * `fetch` is mocked at the boundary the api client uses, as
 * `app/page.test.tsx` does, so a call's target reads off the URL.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useIssues } from "./useIssues";

interface Call {
  method: string;
  route: string;
  headers: Headers;
}

type Handler = () => { status: number; body?: unknown; delayMs?: number };

let calls: Call[];
let handlers: Map<string, Handler>;

const CUDA = [
  {
    kind: "cuda",
    name: "NVIDIA GeForce RTX 5090",
    index: 0,
    memoryTotalBytes: 34190917632,
    memoryFreeBytes: 32446087168,
  },
  { kind: "cpu", name: "AMD64", index: 0, memoryTotalBytes: 100453961728 },
];

/** A healthy standalone box: enrolled to nothing, one engine, one folder
 * it can open, nothing running. The state a finished wizard leaves. */
function standalone(): Map<string, Handler> {
  return new Map<string, Handler>([
    [
      "GET gateway/v1/admin/routing",
      () => ({ status: 200, body: { slots: [], unreachable_drivers: [] } }),
    ],
    [
      "GET agent/v1/node",
      () => ({
        status: 200,
        body: {
          enrolled: true,
          name: "Amish_Station",
          devices: CUDA,
          time: new Date().toISOString(),
        },
      }),
    ],
    // No control root reachable from a standalone host.
    ["GET control/v1/nodes", () => ({ status: 503, body: { detail: { title: "Unavailable" } } })],
    ["GET agent/v1/runtimes", () => ({ status: 200, body: { runtimes: [] } })],
    [
      "GET agent/v1/engines",
      () => ({
        status: 200,
        body: {
          engines: [
            {
              engine: "llama_cpp",
              available: true,
              version: "b10990",
              modelFormats: ["gguf"],
              acquisition: { policy: "managed", installable: true },
            },
            {
              engine: "vllm",
              available: false,
              modelFormats: ["safetensors"],
              acquisition: {
                policy: "manual",
                installable: false,
                reason: "vLLM installs into a Python environment this project does not own.",
              },
            },
          ],
        },
      }),
    ],
    [
      "POST agent/v1/library/folders/check",
      () => ({
        status: 200,
        body: {
          libraryConsulted: true,
          folderListAgeSeconds: 0,
          folders: [
            {
              path: "/models",
              localPath: "/models",
              source: "same_path",
              exists: true,
              isDirectory: true,
              modelsUnder: 1,
              modelsReachable: 1,
            },
          ],
        },
      }),
    ],
  ]);
}

/** Adds a second machine, and the control root that knows about it. */
function withWorkshop(routes: Map<string, Handler>, aheadMs: number): Map<string, Handler> {
  routes.set("GET control/v1/nodes", () => ({
    status: 200,
    body: {
      nodes: [
        { name: "Amish_Station", reachable: true, lastError: null, devices: CUDA },
        { name: "workshop", reachable: true, lastError: null, devices: CUDA },
      ],
    },
  }));
  routes.set("GET node:workshop/v1/node", () => ({
    status: 200,
    body: {
      enrolled: true,
      name: "workshop",
      devices: CUDA,
      // Read at request time, so the offset from this browser's clock is
      // exactly what the test asked for.
      time: new Date(Date.now() + aheadMs).toISOString(),
    },
  }));
  routes.set("GET node:workshop/v1/runtimes", () => ({ status: 200, body: { runtimes: [] } }));
  routes.set("GET node:workshop/v1/engines", () => ({ status: 200, body: { engines: [] } }));
  routes.set("POST node:workshop/v1/library/folders/check", () => ({
    status: 200,
    body: { libraryConsulted: true, folderListAgeSeconds: 0, folders: [] },
  }));
  return routes;
}

function key(call: Call): string {
  return `${call.method} ${call.route}`;
}

function routes(): string[] {
  return calls.map(key);
}

beforeEach(() => {
  calls = [];
  handlers = standalone();
  sessionStorage.clear();
  sessionStorage.setItem("eugene-session-token", "test-token");

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? "GET",
        route: String(input).replace(/^\/api\/proxy\//, ""),
        headers: new Headers(init?.headers),
      };
      calls.push(call);
      const handler = handlers.get(key(call));
      const result = handler
        ? handler()
        : { status: 418, body: { detail: { title: `unhandled route: ${key(call)}` } } };
      if (result.delayMs) await new Promise((r) => setTimeout(r, result.delayMs));
      return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
        status: result.status,
        statusText: String(result.status),
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function poll() {
  const { result } = renderHook(() => useIssues());
  await waitFor(() => expect(result.current.loaded).toBe(true));
  return result;
}

describe("useIssues on a healthy standalone install", () => {
  it("reports nothing, and says it has actually looked", async () => {
    const result = await poll();
    expect(result.current.issues).toEqual([]);
    expect(result.current.worst).toBeNull();
  });

  it("asks the four per-node reads, plus the routing view and the roster", async () => {
    await poll();
    expect(routes().sort()).toEqual([
      "GET agent/v1/engines",
      "GET agent/v1/node",
      "GET agent/v1/runtimes",
      "GET control/v1/nodes",
      "GET gateway/v1/admin/routing",
      "POST agent/v1/library/folders/check",
    ]);
  });

  it("does not raise vLLM, which is uninstallable on every host by decision", async () => {
    const result = await poll();
    expect(result.current.issues.map((i) => i.kind)).not.toContain("engine-unavailable");
  });

  it("does nothing at all when nobody is signed in", async () => {
    sessionStorage.clear();
    const { result } = renderHook(() => useIssues());
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual([]);
    expect(result.current.loaded).toBe(false);
  });
});

describe("the identity read is bracketed, and the skew rule depends on it", () => {
  it("finds two machines that disagree about the time", async () => {
    handlers = withWorkshop(standalone(), 45_000);
    const result = await poll();
    const skew = result.current.issues.find((i) => i.kind === "clock-skew");
    // THE TEST THIS FILE EXISTS FOR. Remove either `Date.now()` from
    // `readIdentity` and `readWindow` is null, `skewBetween` is null for
    // every pair, and this is undefined — while `issues.test.ts` stays
    // entirely green, because the rules are fine and nothing measures.
    expect(skew).toBeDefined();
    expect(skew!.severity).toBe("warning");
    expect(skew!.title).toContain("workshop and Amish_Station");
    expect(skew!.title).toContain("45 seconds");
  });

  it("says nothing when the two agree", async () => {
    handlers = withWorkshop(standalone(), 0);
    const result = await poll();
    expect(result.current.issues.map((i) => i.kind)).not.toContain("clock-skew");
  });

  it("does not invent a skew out of a slow hop", async () => {
    handlers = withWorkshop(standalone(), 0);
    const answer = handlers.get("GET node:workshop/v1/node")!;
    handlers.set("GET node:workshop/v1/node", () => ({ ...answer(), delayMs: 300 }));
    const result = await poll();
    expect(result.current.issues.map((i) => i.kind)).not.toContain("clock-skew");
  });

  it("says nothing when the second machine does not report a time", async () => {
    handlers = withWorkshop(standalone(), 45_000);
    handlers.set("GET node:workshop/v1/node", () => ({
      status: 200,
      body: { enrolled: true, name: "workshop", devices: CUDA },
    }));
    const result = await poll();
    expect(result.current.issues.map((i) => i.kind)).not.toContain("clock-skew");
  });
});

describe("reaching the other machines", () => {
  it("asks each node's own agent through the node hop, never the root", async () => {
    handlers = withWorkshop(standalone(), 0);
    await poll();
    // `one-console-never-hop-nodes`: the console reads the far node from
    // here. The local machine is `agent`, not `node:Amish_Station`.
    expect(routes()).toContain("GET node:workshop/v1/runtimes");
    expect(routes()).toContain("GET node:workshop/v1/engines");
    expect(routes()).toContain("POST node:workshop/v1/library/folders/check");
    expect(routes()).toContain("GET agent/v1/runtimes");
    expect(routes()).not.toContain("GET node:Amish_Station/v1/runtimes");
    // And exactly once. The roster lists this machine too, and
    // `targetFor` resolves its own name back to `agent` — so a roster
    // that is not de-duplicated against the local node reads it twice
    // and files two issues under one id, which React renders as a key
    // collision rather than as anything a person would notice.
    expect(routes().filter((r) => r === "GET agent/v1/runtimes")).toHaveLength(1);
    expect(routes().filter((r) => r === "GET agent/v1/node")).toHaveLength(1);
  });

  it("still asks a node the root calls unreachable, and reports it as down", async () => {
    handlers = withWorkshop(standalone(), 0);
    handlers.set("GET control/v1/nodes", () => ({
      status: 200,
      body: {
        nodes: [
          { name: "Amish_Station", reachable: true, devices: CUDA },
          {
            name: "workshop",
            reachable: false,
            lastError: "Unauthorized: The token is not yet valid (iat)",
          },
        ],
      },
    }));
    for (const route of [
      "GET node:workshop/v1/node",
      "GET node:workshop/v1/runtimes",
      "GET node:workshop/v1/engines",
      "POST node:workshop/v1/library/folders/check",
    ]) {
      handlers.set(route, () => ({ status: 502, body: { detail: { title: "unreachable" } } }));
    }
    const result = await poll();
    // Asked anyway: the root's verdict is its own probe from its own
    // position, and this browser may be somewhere else.
    expect(routes()).toContain("GET node:workshop/v1/node");
    const down = result.current.issues.find((i) => i.kind === "node-down");
    expect(down!.detail).toContain("not yet valid (iat)");
    expect(result.current.worst).toBe("blocking");
  });
});

describe("a sealed control root", () => {
  it("is read off the 503 the roster call comes back with", async () => {
    handlers.set("GET control/v1/nodes", () => ({
      status: 503,
      body: {
        detail: {
          type: "https://eugeneplexus.com/problems/control#locked",
          title: "Locked",
          status: 503,
          detail: "The control root is sealed.",
        },
      },
    }));
    const result = await poll();
    const sealed = result.current.issues.find((i) => i.kind === "control-sealed");
    expect(sealed).toBeDefined();
    expect(sealed!.action).toBe("unlock-control-root");
    expect(result.current.worst).toBe("blocking");
  });

  it("is not raised by the 503 of a root that was never set up", async () => {
    // The standalone fixture's roster already answers a bare 503. The
    // root separates "locked" from "uninitialized" on purpose, and
    // advising an unlock for the second is advising a person to open a
    // lock that is not there.
    const result = await poll();
    expect(result.current.issues.map((i) => i.kind)).not.toContain("control-sealed");
  });
});

describe("the poll is not the thing that ends a session", () => {
  it("keeps the session when the control root refuses this token", async () => {
    handlers.set("GET control/v1/nodes", () => ({
      status: 401,
      body: { detail: { title: "Unauthorized" } },
    }));
    const result = await poll();
    // M9's shape, and S4 hit it live: root initialized, local agent not
    // enrolled, so the root refuses every session the agent minted. With
    // the ambient token `api.ts` clears the session and bounces to
    // /login — from every page, every thirty seconds.
    expect(sessionStorage.getItem("eugene-session-token")).toBe("test-token");
    expect(result.current.loaded).toBe(true);
  });

  it("sends the session token explicitly, which is what buys that exemption", async () => {
    await poll();
    const control = calls.find((c) => c.route.startsWith("control/"));
    expect(control!.headers.get("authorization")).toBe("Bearer test-token");
  });
});

describe("every read is soft", () => {
  it("still reports what it could reach when the gateway is down", async () => {
    handlers.set("GET gateway/v1/admin/routing", () => ({ status: 500, body: null }));
    handlers.set("GET agent/v1/engines", () => ({
      status: 200,
      body: {
        engines: [
          {
            engine: "llama_cpp",
            available: false,
            modelFormats: ["gguf"],
            acquisition: {
              policy: "managed",
              installable: false,
              reason: "Upstream publishes no CUDA build for Linux.",
            },
          },
        ],
      },
    }));
    const result = await poll();
    expect(result.current.issues.map((i) => i.kind)).toEqual(["engine-unavailable"]);
  });

  it("reports nothing rather than everything when every read fails", async () => {
    handlers = new Map();
    const result = await poll();
    expect(result.current.issues).toEqual([]);
  });
});
