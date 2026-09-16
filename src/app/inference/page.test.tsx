/**
 * The Inference screen's two honest states, driven.
 *
 * `describeCompute` and `describeLoading` are pure and tested in
 * `issues.test.ts`; `nodeDetails` is tested in `inferenceRows.test.ts`.
 * What is left — and what step 4 of this slice learned to test by
 * driving the page rather than the component — is the **wiring**: that
 * the fields these lines need actually arrive, from the node's own
 * `/v1/runtimes` rather than from the control root's union view, which
 * carries none of them.
 *
 * The first test of this screen in jsdom, so the fixture is a whole
 * two-machine install: the shapes are the ones `inferenceRows.test.ts`
 * took off the live worker.
 */

import { act, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetLoadsForTests, loadKey, rememberLoadSeconds } from "@/lib/loadMemory";

import InferencePage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/inference",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div data-testid="shell">{children}</div>,
}));

type Handler = () => { status: number; body?: unknown };
let handlers: Map<string, Handler>;

const CUDA = [
  { kind: "cuda", name: "NVIDIA GeForce RTX 5090", index: 0, memoryTotalBytes: 34190917632 },
  { kind: "cpu", name: "AMD64", index: 0, memoryTotalBytes: 100453961728 },
];

/** The runtime as the NODE reports it — with the three fields the
 * control root's `RuntimePlacement` does not carry. */
function nodeRuntime(over: Record<string, unknown> = {}) {
  return {
    name: "gemma-a",
    engine: "llama_cpp",
    modelPath: "/models/gemma-27b-Q6_K_L.gguf",
    modelAlias: "gemma-3-27b",
    status: "ready",
    ...over,
  };
}

/** One box, one model, a card in it. */
function install(): Map<string, Handler> {
  return new Map<string, Handler>([
    [
      "GET gateway/v1/admin/drivers",
      () => ({
        status: 200,
        body: {
          drivers: [
            {
              name: "gemma-a-driver",
              runtime: "gemma-a",
              modelId: "gemma-3-27b",
              reachable: true,
              url: "http://127.0.0.1:8081/",
            },
          ],
        },
      }),
    ],
    [
      "GET gateway/v1/admin/routing",
      () => ({ status: 200, body: { slots: [], unreachable_drivers: [] } }),
    ],
    ["GET control/v1/components", () => ({ status: 503, body: { detail: "no root" } })],
    ["GET control/v1/runtimes", () => ({ status: 503, body: { detail: "no root" } })],
    ["GET control/v1/nodes", () => ({ status: 503, body: { detail: "no root" } })],
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
    ["GET agent/v1/runtimes", () => ({ status: 200, body: { runtimes: [nodeRuntime()] } })],
    ["GET agent/v1/engines", () => ({ status: 200, body: { engines: [] } })],
    [
      "POST agent/v1/library/folders/check",
      () => ({ status: 200, body: { libraryConsulted: true, folders: [] } }),
    ],
  ]);
}

beforeEach(() => {
  handlers = install();
  sessionStorage.clear();
  localStorage.clear();
  forgetLoadsForTests();
  sessionStorage.setItem("eugene-session-token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const route = String(input).replace(/^\/api\/proxy\//, "");
      const key = `${init?.method ?? "GET"} ${route}`;
      const handler = handlers.get(key);
      const result = handler ? handler() : { status: 418, body: { detail: `unhandled: ${key}` } };
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

async function rowFor(model: string) {
  render(<InferencePage />);
  const cell = await screen.findByText(model, {}, { timeout: 5000 });
  return cell.closest("tr") as HTMLElement;
}

describe("a model running on the processor while the machine has a card", () => {
  it("says so, and says where the claim comes from", async () => {
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: { runtimes: [nodeRuntime({ flags: { gpuLayers: 0 } })] },
    }));
    const row = await rowFor("gemma-3-27b");
    const line = await within(row).findByTestId("compute-detail");
    expect(line).toHaveTextContent("on the processor");
    expect(line).toHaveTextContent("no layers on the card");
    // `flags` is on the node's own runtime record and on nothing the
    // control root serves, so this line arriving at all is the wiring.
    expect(line).toHaveAttribute("title", expect.stringContaining("read from what it was started"));
  });

  it("says nothing about a model that is using the card", async () => {
    const row = await rowFor("gemma-3-27b");
    await within(row).findByText("ready");
    expect(within(row).queryByTestId("compute-detail")).toBeNull();
  });

  it("states the permanent case on a machine with no accelerator", async () => {
    handlers.set("GET agent/v1/node", () => ({
      status: 200,
      body: { enrolled: true, name: "Amish_Station", devices: [{ kind: "cpu", name: "Xeon" }] },
    }));
    const row = await rowFor("gemma-3-27b");
    const line = await within(row).findByTestId("compute-detail");
    expect(line).toHaveTextContent("on the processor");
    // Not a fault, and not a warning: it is what this machine is.
    expect(line).not.toHaveTextContent("no layers on the card");
  });

  it("says nothing at all when the node did not report its devices", async () => {
    handlers.set("GET agent/v1/node", () => ({ status: 502, body: null }));
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: { runtimes: [nodeRuntime({ flags: { gpuLayers: 0 } })] },
    }));
    const row = await rowFor("gemma-3-27b");
    await within(row).findByText("ready");
    // "Did not answer" is not "has no accelerator". Collapsing them puts
    // "on the processor" on every row of a node that is merely slow.
    await new Promise((r) => setTimeout(r, 50));
    expect(within(row).queryByTestId("compute-detail")).toBeNull();
  });
});

describe("a model that is loading", () => {
  const started = new Date(Date.now() - 95_000).toISOString();

  it("reports elapsed, which is the only exact thing there is", async () => {
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: { runtimes: [nodeRuntime({ status: "loading", lastRestart: started })] },
    }));
    const row = await rowFor("gemma-3-27b");
    const line = await within(row).findByTestId("loading-detail");
    expect(line).toHaveTextContent("1 min 35 s so far");
  });

  it("names the share the bytes are crossing, which is what explains the wait", async () => {
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: {
        runtimes: [
          nodeRuntime({
            status: "loading",
            lastRestart: started,
            localPath: String.raw`\\192.168.16.252\downloads\models\gemma.gguf`,
          }),
        ],
      },
    }));
    const row = await rowFor("gemma-3-27b");
    // The live install re-reads 23.8 GB over a gigabit link on every
    // start, and four silent minutes reads as a broken product.
    expect(await within(row).findByTestId("loading-detail")).toHaveTextContent(
      String.raw`reading from \\192.168.16.252`,
    );
  });

  it("estimates only from a load this browser has watched finish before", async () => {
    rememberLoadSeconds(loadKey("Amish_Station", "gemma-3-27b"), 240);
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: { runtimes: [nodeRuntime({ status: "loading", lastRestart: started })] },
    }));
    const row = await rowFor("gemma-3-27b");
    expect(await within(row).findByTestId("loading-detail")).toHaveTextContent(
      "about 2 min 25 s left, going by last time",
    );
  });

  it("says nothing when the model is not loading", async () => {
    const row = await rowFor("gemma-3-27b");
    await within(row).findByText("ready");
    expect(within(row).queryByTestId("loading-detail")).toBeNull();
  });
});

describe("the node's own read, not the root's union view", () => {
  it("asks each node for its runtimes even when the control root answered", async () => {
    handlers.set("GET control/v1/nodes", () => ({
      status: 200,
      body: { nodes: [{ name: "Amish_Station", reachable: true, devices: CUDA }] },
    }));
    handlers.set("GET control/v1/runtimes", () => ({
      status: 200,
      // The union view: no flags, no lastRestart, no localPath. Every
      // field the two lines need is absent by design.
      body: {
        runtimes: [
          {
            node: "Amish_Station",
            name: "gemma-a",
            modelAlias: "gemma-3-27b",
            status: "ready",
            engine: "llama_cpp",
          },
        ],
        unreachableNodes: [],
      },
    }));
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: { runtimes: [nodeRuntime({ flags: { gpuLayers: 0 } })] },
    }));
    const row = await rowFor("gemma-3-27b");
    // Rendered from the root's rows, but this line can only have come
    // from the node's own record.
    expect(await within(row).findByTestId("compute-detail")).toHaveTextContent(
      "no layers on the card",
    );
  });

  it("takes the loading STATE from the fast poll, not from the slow per-node read", async () => {
    // The two reads run at different cadences -- this screen every 3 s,
    // the Issues poll every 30 -- so they disagree for up to half a
    // minute after a model finishes loading. The state has to come from
    // the fast one or a ready model keeps saying "loading" for half a
    // minute; only the fields the fast one does not carry come from the
    // slow one.
    handlers.set("GET control/v1/nodes", () => ({
      status: 200,
      body: { nodes: [{ name: "Amish_Station", reachable: true, devices: CUDA }] },
    }));
    handlers.set("GET control/v1/runtimes", () => ({
      status: 200,
      body: {
        runtimes: [
          {
            node: "Amish_Station",
            name: "gemma-a",
            modelAlias: "gemma-3-27b",
            status: "ready",
            engine: "llama_cpp",
          },
        ],
        unreachableNodes: [],
      },
    }));
    // The node's own record is a poll behind and still says loading.
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: {
        runtimes: [
          nodeRuntime({
            status: "loading",
            lastRestart: new Date(Date.now() - 95_000).toISOString(),
          }),
        ],
      },
    }));
    const row = await rowFor("gemma-3-27b");
    await within(row).findByText("ready");
    await new Promise((r) => setTimeout(r, 80));
    expect(within(row).queryByTestId("loading-detail")).toBeNull();
  });
});

describe("elapsed counts up", () => {
  it("does not freeze at whatever it was when the screen opened", async () => {
    // The per-node read is every 30 s; without a clock of its own this
    // screen would show one frozen number for half a minute at a time,
    // during the exact wait it exists to explain.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      handlers.set("GET agent/v1/runtimes", () => ({
        status: 200,
        body: {
          runtimes: [
            nodeRuntime({
              status: "loading",
              lastRestart: new Date(Date.now() - 95_000).toISOString(),
            }),
          ],
        },
      }));
      render(<InferencePage />);
      const cell = await screen.findByText("gemma-3-27b", {}, { timeout: 5000 });
      const row = cell.closest("tr") as HTMLElement;
      expect(await within(row).findByTestId("loading-detail")).toHaveTextContent("1 min 35 s");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      // The exact second is not the subject and drifts by one under
      // `shouldAdvanceTime`; that it MOVED is the subject.
      const after = within(row).getByTestId("loading-detail").textContent ?? "";
      expect(after).not.toContain("1 min 35 s");
      expect(after).toMatch(/1 min 4\d s so far/);
    } finally {
      vi.useRealTimers();
    }
  });
});
