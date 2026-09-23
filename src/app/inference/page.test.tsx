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

import { act, render, screen, waitFor, within } from "@testing-library/react";
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

describe("an external backend's config link", () => {
  /** An Ollama the operator already ran, joined by a driver: no runtime
   * of ours behind it, so the row offers settings rather than start/stop. */
  function withOllama() {
    handlers.set("GET gateway/v1/admin/drivers", () => ({
      status: 200,
      body: {
        drivers: [
          {
            name: "ollama-local",
            modelId: "qwen3-coder:30b",
            reachable: true,
            url: "http://127.0.0.1:8084/",
          },
        ],
      },
    }));
    handlers.set("GET agent/v1/runtimes", () => ({ status: 200, body: { runtimes: [] } }));
  }

  it("opens that driver's settings, on the machine the root places it on", async () => {
    withOllama();
    handlers.set("GET control/v1/components", () => ({
      status: 200,
      body: {
        components: [
          {
            node: "Amish_Station",
            name: "ollama-local",
            kind: "inference-driver",
            status: "running",
          },
        ],
      },
    }));
    const row = await rowFor("qwen3-coder:30b");
    // A bare `/config` carries no `?sel=` and renders "Nothing selected".
    expect(within(row).getByRole("link", { name: "config" })).toHaveAttribute(
      "href",
      "/config?sel=driver%3Aollama-local%40Amish_Station",
    );
  });

  it("names the driver alone when nothing says which machine it is on", async () => {
    // The standalone case: no control root to place it. The tree resolves
    // a bare `driver:<name>` to the first leaf of that name.
    withOllama();
    const row = await rowFor("qwen3-coder:30b");
    expect(within(row).getByRole("link", { name: "config" })).toHaveAttribute(
      "href",
      "/config?sel=driver%3Aollama-local",
    );
  });
});

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
  // Measured from each test's own start: computed once for the block, a
  // slow full-suite run put the third test a second later and "2 min
  // 25 s left" read "2 min 24 s".
  let started = "";
  beforeEach(() => {
    started = new Date(Date.now() - 95_000).toISOString();
  });

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

describe("a model being copied to the machine that runs it", () => {
  it("draws a real bar, because a copy always has bytes", async () => {
    // Unlike a load, which llama.cpp makes invisible by mapping the
    // file, a copy is made by the agent itself -- so there is always a
    // number, and the bar is never a decoration.
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: {
        runtimes: [
          nodeRuntime({
            status: "copying",
            copyProgress: {
              bytesCopied: 6_000_000_000,
              totalBytes: 24_000_000_000,
              bytesPerSecond: 113_600_000,
            },
          }),
        ],
      },
    }));
    const row = await rowFor("gemma-3-27b");
    const line = await within(row).findByTestId("copying-detail");
    expect(line).toHaveTextContent("copying to this machine");
    expect(within(row).getByTestId("copying-bar")).toHaveAttribute("aria-valuenow", "25");
    // The status is its own word, not `starting`: nothing is spawned.
    expect(within(row).getByText("copying")).toBeInTheDocument();
  });

  it("says the model is opened from the local copy once it is made", async () => {
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: {
        runtimes: [
          nodeRuntime({
            status: "ready",
            localPathSource: "copy",
            localPath: String.raw`D:\eugene-models\gemma.gguf`,
          }),
        ],
      },
    }));
    const row = await rowFor("gemma-3-27b");
    expect(await within(row).findByTestId("model-source")).toHaveTextContent(
      "reading a local copy on this machine",
    );
  });

  it("prints the reason a copy was asked for and not made", async () => {
    // The feature's failure mode: the model serves anyway, and the only
    // other symptom is a start minutes slower than the person asked
    // for. Unsaid, it is unfindable.
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: {
        runtimes: [
          nodeRuntime({
            status: "ready",
            localPathSource: "inherited",
            localPath: String.raw`\192.168.16.252\models\gemma.gguf`,
            localPathNote:
              "not copied to this machine: 12.0 GB more free space is needed to keep 50 GB free.",
          }),
        ],
      },
    }));
    const row = await rowFor("gemma-3-27b");
    expect(await within(row).findByTestId("model-source-note")).toHaveTextContent(
      "more free space is needed",
    );
  });

  it("says nothing about the source when nothing is known about it", async () => {
    // The union view carries no `localPathSource`, and a row built from
    // it must not claim the model is read from anywhere in particular.
    const row = await rowFor("gemma-3-27b");
    await within(row).findByText("ready");
    expect(within(row).queryByTestId("model-source")).toBeNull();
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

describe("how long a model has sat idle", () => {
  it("says it in minutes and hours, not a count of seconds", async () => {
    handlers.set("GET gateway/v1/admin/routing", () => ({
      status: 200,
      body: {
        unreachable_drivers: [],
        slots: [
          {
            model: "gemma-3-27b",
            tiers: [
              {
                target: "gemma-3-27b",
                backends: [
                  {
                    driver: "gemma-a-driver",
                    eligible: true,
                    in_flight: 0,
                    idle_seconds: 5423,
                  },
                ],
              },
            ],
          },
        ],
      },
    }));
    const row = await rowFor("gemma-3-27b");
    await waitFor(() => expect(row).toHaveTextContent("idle 1 h 30 min"));
    expect(row).not.toHaveTextContent("5423s");
  });
});

describe("removing a row", () => {
  it("asks inline, not with the browser's dialog, and removes on the second click", async () => {
    const confirm = vi.spyOn(window, "confirm");
    let deleted = 0;
    handlers.set("DELETE agent/v1/runtimes/gemma-a", () => {
      deleted += 1;
      return { status: 204 };
    });
    const row = await rowFor("gemma-3-27b");
    await act(async () => {
      within(row).getByTestId("remove-row").click();
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(deleted).toBe(0);
    expect(row).toHaveTextContent("The engine stops; the model files stay.");
    await act(async () => {
      within(row).getByTestId("remove-row-confirm").click();
    });
    await waitFor(() => expect(deleted).toBe(1));
    confirm.mockRestore();
  });
});

describe("a hidden tab", () => {
  it("stops asking, and asks once when it is shown again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const hidden = vi.spyOn(document, "hidden", "get");
    try {
      await rowFor("gemma-3-27b");
      const driverReads = () =>
        (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) =>
          String(c[0]).endsWith("gateway/v1/admin/drivers"),
        ).length;
      hidden.mockReturnValue(true);
      const before = driverReads();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9_000);
      });
      // Four endpoints every three seconds, behind a game, for nobody.
      expect(driverReads()).toBe(before);
      hidden.mockReturnValue(false);
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(driverReads()).toBe(before + 1);
    } finally {
      hidden.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("an engine install", () => {
  beforeEach(() => {
    handlers.set("GET agent/v1/engines", () => ({
      status: 200,
      body: {
        engines: [
          {
            engine: "llama_cpp",
            available: false,
            modelFormats: ["gguf"],
            acquisition: { installable: true },
          },
        ],
      },
    }));
  });

  it("that failed says why, and offers to try again", async () => {
    handlers.set("GET agent/v1/engines/llama_cpp/install", () => ({
      status: 200,
      body: { engine: "llama_cpp", state: "failed", error: "checksum mismatch" },
    }));
    render(<InferencePage />);
    // It fell back to "not installed" and the same button, the reason
    // on the record and nowhere on screen.
    expect(
      await screen.findByTestId("engine-install-failed", {}, { timeout: 5000 }),
    ).toHaveTextContent("install failed: checksum mismatch");
    expect(screen.getByRole("button", { name: "try again" })).toBeInTheDocument();
  });

  it("started somewhere else shows here, with how far it has got", async () => {
    handlers.set("GET agent/v1/engines/llama_cpp/install", () => ({
      status: 200,
      body: {
        engine: "llama_cpp",
        state: "downloading",
        bytesDownloaded: 500_000_000,
        bytesTotal: 1_000_000_000,
      },
    }));
    render(<InferencePage />);
    expect(
      await screen.findByTestId("engine-install-progress", {}, { timeout: 5000 }),
    ).toHaveTextContent("downloading 50% of 1.0 GB");
  });
});
