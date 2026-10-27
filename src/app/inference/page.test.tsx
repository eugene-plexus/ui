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

import {
  act,
  cleanup as cleanupRender,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetLoadsForTests, loadKey, rememberLoadSeconds } from "@/lib/loadMemory";
import { checkVisibleCopy } from "@/lib/vocabulary";

import InferencePage from "./page";

let search = new URLSearchParams();
const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/inference",
  useSearchParams: () => search,
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
  search = new URLSearchParams();
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
      const result = handler
        ? handler()
        : key.endsWith("/v1/serving-measurements")
          ? { status: 200, body: { measurements: [] } }
          : { status: 418, body: { detail: `unhandled: ${key}` } };
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

describe("opened from the tree on one backend", () => {
  // ui-settings-reorganisation.md decision #1: a backend's Overview is
  // this page opened on it. Troy's report was that the leaf held only
  // config while start and stop were on the install root.
  it("marks that backend's row, names it, and offers everything", async () => {
    search = new URLSearchParams("sel=driver:gemma-a-driver@Amish_Station");
    const row = await rowFor("gemma-3-27b");
    expect(row).toHaveAttribute("data-marked", "true");
    expect(screen.getByTestId("inference-scope")).toHaveTextContent(
      "Showing gemma-a-driver on Amish_Station.",
    );
    expect(screen.getByRole("link", { name: "Show everything" })).toHaveAttribute(
      "href",
      "/inference?sel=backends",
    );
    // The actions are on the marked row, which is the point.
    expect(within(row).getByRole("button", { name: "Stop gemma-3-27b" })).toBeInTheDocument();
  });

  it("marks nothing and says nothing about scope when the whole branch is selected", async () => {
    search = new URLSearchParams("sel=backends");
    const row = await rowFor("gemma-3-27b");
    expect(row).not.toHaveAttribute("data-marked");
    expect(screen.queryByTestId("inference-scope")).toBeNull();
  });

  it("keeps a backend's machine on the page even when no row carries it yet", async () => {
    // The gateway's routing refresh is its own cadence; a backend declared
    // a moment ago has a machine, and the page shows that machine's
    // section -- whatever it is serving, nothing marked -- rather than
    // showing nothing at all.
    search = new URLSearchParams("sel=driver:brand-new@Amish_Station");
    const row = await rowFor("gemma-3-27b");
    expect(screen.getByTestId("inference-scope")).toHaveTextContent("brand-new on Amish_Station");
    expect(row).not.toHaveAttribute("data-marked");
  });

  it("shows only that backend's machine when the install has two", async () => {
    // The sabotage that escaped the one-machine fixture: a scope that
    // never narrowed the machines was invisible with one machine.
    handlers.set("GET control/v1/nodes", () => ({
      status: 200,
      body: {
        nodes: [
          { name: "Amish_Station", reachable: true, devices: CUDA },
          { name: "nas", reachable: true },
        ],
      },
    }));
    search = new URLSearchParams("sel=backends");
    await rowFor("gemma-3-27b");
    expect(await screen.findByRole("heading", { name: "nas" })).toBeInTheDocument();
    cleanupRender();
    search = new URLSearchParams("sel=driver:gemma-a-driver@Amish_Station");
    await rowFor("gemma-3-27b");
    expect(screen.queryByRole("heading", { name: "nas" })).toBeNull();
    expect(screen.getByRole("heading", { name: /Amish_Station/ })).toBeInTheDocument();
  });
});

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
    expect(within(row).getByRole("link", { name: /^Settings for / })).toHaveAttribute(
      "href",
      "/config?sel=driver%3Aollama-local%40Amish_Station",
    );
  });

  it("names the driver alone when nothing says which machine it is on", async () => {
    // The standalone case: no control root to place it. The tree resolves
    // a bare `driver:<name>` to the first leaf of that name.
    withOllama();
    const row = await rowFor("qwen3-coder:30b");
    expect(within(row).getByRole("link", { name: /^Settings for / })).toHaveAttribute(
      "href",
      "/config?sel=driver%3Aollama-local",
    );
  });
});

describe("which profile a runtime came from", () => {
  it("is said on its row, read from the node's own record", async () => {
    // Two runtimes of one model, one per profile, read the same until
    // this line existed (Troy's first profile build, 2026-10-01).
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: {
        runtimes: [nodeRuntime({ profile: { id: "p7", name: "Built for Amish_Station" } })],
      },
    }));
    const row = await rowFor("gemma-3-27b");
    expect(await within(row).findByTestId("runtime-profile")).toHaveTextContent(
      "profile Built for Amish_Station",
    );
  });

  it("says nothing for a runtime declared before profiles were recorded", async () => {
    const row = await rowFor("gemma-3-27b");
    await within(row).findByText("ready");
    expect(within(row).queryByTestId("runtime-profile")).toBeNull();
  });
});

describe("removing a runtime asks without widening its row (ui#14)", () => {
  it("steps start, stop and restart aside while asking, and brings them back", async () => {
    const row = await rowFor("gemma-3-27b");
    await within(row).findByText("ready");
    expect(within(row).getByRole("button", { name: "Restart gemma-3-27b" })).toBeInTheDocument();
    fireEvent.click(within(row).getByTestId("remove-row"));
    expect(within(row).getByText("The engine stops; the model files stay.")).toBeInTheDocument();
    for (const name of ["Start", "Stop", "Restart"]) {
      expect(within(row).queryByRole("button", { name: new RegExp(`^${name} `) })).toBeNull();
    }
    fireEvent.click(within(row).getByTestId("remove-row-cancel"));
    for (const name of ["Start", "Stop", "Restart"]) {
      expect(
        within(row).getByRole("button", { name: new RegExp(`^${name} `) }),
      ).toBeInTheDocument();
    }
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

describe("an install with nothing serving", () => {
  it("points each way in at the page that does it, in short sentences", async () => {
    handlers.set("GET gateway/v1/admin/drivers", () => ({ status: 200, body: { drivers: [] } }));
    handlers.set("GET agent/v1/runtimes", () => ({ status: 200, body: { runtimes: [] } }));
    render(<InferencePage />);
    // Found by its words, not its test id, so the old screen fails on
    // what it said rather than on a missing attribute.
    const heading = await screen.findByText("Nothing is serving yet.", {}, { timeout: 5000 });
    const empty = heading.parentElement as HTMLElement;
    expect(within(empty).getByRole("link", { name: "Add an external backend" })).toHaveAttribute(
      "href",
      "/backends/add",
    );
    expect(within(empty).getByRole("link", { name: "Launch a model" })).toHaveAttribute(
      "href",
      "/library",
    );
    expect(empty).not.toHaveTextContent("Config page");
    const blocks = Array.from(empty.querySelectorAll("p, li"), (e) => e.textContent ?? "");
    expect(checkVisibleCopy(blocks)).toEqual([]);
  });
});

describe("a row's buttons say what they act on and what is happening", () => {
  it("names the model in each button and says Restarting… while it works", async () => {
    const row = await rowFor("gemma-3-27b");
    await within(row).findByText("ready");
    for (const name of ["Start gemma-3-27b", "Stop gemma-3-27b", "Restart gemma-3-27b"]) {
      expect(within(row).getByRole("button", { name })).toBeInTheDocument();
    }
    const real = fetch as unknown as typeof fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).endsWith("/runtimes/gemma-a/restart")
          ? new Promise<Response>(() => {})
          : real(input, init),
      ),
    );
    await act(async () => {
      within(row).getByRole("button", { name: "Restart gemma-3-27b" }).click();
    });
    expect(within(row).getByRole("button", { name: "Restarting gemma-3-27b" })).toHaveTextContent(
      "Restarting…",
    );
  });
});

describe("an action that fails", () => {
  it("names the action, the model and the machine, and can be dismissed", async () => {
    handlers.set("POST agent/v1/runtimes/gemma-a/restart", () => ({
      status: 409,
      body: { detail: { title: "Conflict", detail: "The engine is still loading.", status: 409 } },
    }));
    const row = await rowFor("gemma-3-27b");
    await act(async () => {
      within(row).getByRole("button", { name: "Restart gemma-3-27b" }).click();
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Could not restart gemma-a on Amish_Station: The engine is still loading.",
    );
    await act(async () => {
      within(alert).getByRole("button", { name: "Dismiss" }).click();
    });
    expect(screen.queryByRole("alert")).toBeNull();
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
      // Once for this page's own poll and once for the Issues poll, which
      // reads the same list for an account's model-list status (P1).
      expect(driverReads()).toBe(before + 2);
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
    expect(screen.getByTestId("engine-install-failed")).toHaveAttribute("role", "alert");
    await waitFor(() => expect(screen.getByTestId("engine-management")).toHaveAttribute("open"));
    expect(screen.getByRole("button", { name: "Try again llama.cpp" })).toHaveTextContent(
      "Try again",
    );
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

describe("model overview and engine setup", () => {
  it("keeps manual instructions closed until requested without hiding model controls", async () => {
    handlers.set("GET agent/v1/engines", () => ({
      status: 200,
      body: {
        engines: [
          {
            engine: "kev",
            available: false,
            experimental: true,
            acquisition: {
              policy: "manual",
              installable: false,
              reason: "Use the checkout's own interpreter and download the matching base model.",
              manualInstall: {
                command: "uv sync --extra serve",
                docsUrl: "https://example.invalid/kev",
              },
            },
          },
        ],
      },
    }));
    const row = await rowFor("gemma-3-27b");
    const management = await screen.findByTestId("engine-management");
    expect(management).not.toHaveAttribute("open");
    expect(screen.getByText("uv sync --extra serve")).not.toBeVisible();
    expect(within(row).getByRole("button", { name: "Stop gemma-3-27b" })).toBeVisible();
    await act(async () => {
      management.querySelector("summary")!.click();
    });
    await waitFor(() => expect(management).toHaveAttribute("open"));
    expect(screen.getByText("uv sync --extra serve")).not.toBeVisible();
    await act(async () => {
      screen.getByLabelText("Setup details for Kev").click();
    });
    expect(screen.getByText("uv sync --extra serve")).toBeVisible();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([url, init]) =>
            init?.method === "POST" && !String(url).endsWith("/library/folders/check"),
        ),
    ).toBe(false);
  });

  it("does not repeat the model identity as an engine process name", async () => {
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: { runtimes: [nodeRuntime({ name: "gemma-a", modelAlias: "gemma-a" })] },
    }));
    handlers.set("GET gateway/v1/admin/drivers", () => ({
      status: 200,
      body: {
        drivers: [
          { name: "gemma-a-driver", runtime: "gemma-a", modelId: "gemma-a", reachable: true },
        ],
      },
    }));
    render(<InferencePage />);
    const model = await screen.findByTestId("backend-model");
    const row = model.closest("tr") as HTMLElement;
    await within(row).findByText("Managed by Eugene", { exact: false });
    expect(row.textContent?.split("gemma-a").length).toBe(2);
  });
});

describe("a runtime that stopped", () => {
  // 2026-09-26: a fresh Windows had no Visual C++ runtime, llama-server died
  // at start, and this screen said only "crashed" while the agent had the
  // reason on `lastError` the whole time.
  const WHY =
    "qwen3-5-4b-q4-k-m exited: it could not start: Windows could not find a DLL it needs (0xC0000135).";

  it("says why, in the agent's own words", async () => {
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: { runtimes: [nodeRuntime({ status: "crashed", lastError: WHY })] },
    }));
    const row = await rowFor("gemma-3-27b");
    const line = await within(row).findByTestId("runtime-failure");
    expect(line).toHaveTextContent("Windows could not find a DLL it needs");
    expect(line).toBeVisible();
  });

  it("says nothing once the runtime is serving again", async () => {
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: { runtimes: [nodeRuntime({ status: "ready", lastError: WHY })] },
    }));
    const row = await rowFor("gemma-3-27b");
    await within(row).findByText("ready");
    expect(within(row).queryByTestId("runtime-failure")).toBeNull();
  });
});

describe("another build of an engine", () => {
  // 2026-09-27: an Intel Arc mini PC ran the Vulkan build, the default for
  // it, and nobody here has run that on an Arc. The other builds upstream
  // publishes for the machine are the expert's way past that default.
  beforeEach(() => {
    handlers.set("GET agent/v1/engines", () => ({
      status: 200,
      body: {
        engines: [
          {
            engine: "llama_cpp",
            available: true,
            version: "b11211",
            modelFormats: ["gguf"],
            managed: {
              version: "b11211",
              binaryPath: "C:/Eugene/engines/llama_cpp/b11211/llama-server.exe",
              variant: "win-vulkan-x64",
            },
            acquisition: {
              installable: true,
              variant: "win-vulkan-x64",
              alternatives: ["win-cpu-x64", "win-sycl-x64", "win-vulkan-x64"],
            },
          },
        ],
      },
    }));
    handlers.set("GET agent/v1/engines/llama_cpp/install", () => ({
      status: 404,
      body: { detail: "no install yet" },
    }));
    handlers.set("POST agent/v1/engines/llama_cpp/install", () => ({
      status: 202,
      body: { engine: "llama_cpp", state: "downloading", variant: "win-sycl-x64" },
    }));
  });

  function installBodies(): unknown[] {
    return vi
      .mocked(fetch)
      .mock.calls.filter(([, init]) => init?.method === "POST")
      .filter(([url]) => String(url).endsWith("/v1/engines/llama_cpp/install"))
      .map(([, init]) => JSON.parse(String(init?.body ?? "{}")));
  }

  it("names the build that is installed", async () => {
    render(<InferencePage />);
    expect(await screen.findByTestId("engine-variant", {}, { timeout: 5000 })).toHaveTextContent(
      "win-vulkan-x64",
    );
  });

  it("installs the build chosen, not the default", async () => {
    render(<InferencePage />);
    const choice = await screen.findByTestId("engine-build-choice", {}, { timeout: 5000 });
    // The default is first and is not repeated below it.
    const options = Array.from(choice.querySelectorAll("option"), (o) => o.value);
    expect(options).toEqual(["", "win-cpu-x64", "win-sycl-x64"]);
    await act(async () => {
      fireEvent.change(choice, { target: { value: "win-sycl-x64" } });
    });
    await act(async () => {
      screen.getByRole("button", { name: "Install llama.cpp" }).click();
    });
    await waitFor(() => expect(installBodies()).toEqual([{ variant: "win-sycl-x64" }]));
  });

  it("left on the default, asks for the default", async () => {
    render(<InferencePage />);
    await screen.findByTestId("engine-build-choice", {}, { timeout: 5000 });
    await act(async () => {
      screen.getByRole("button", { name: "Update llama.cpp" }).click();
    });
    await waitFor(() => expect(installBodies()).toEqual([{}]));
  });

  it("a build the agent refuses says why", async () => {
    handlers.set("POST agent/v1/engines/llama_cpp/install", () => ({
      status: 422,
      body: {
        detail: {
          title: "Nothing installable for this host",
          detail: "'win-sycl-x64' is not a build release b11211 publishes for windows on x64.",
          status: 422,
        },
      },
    }));
    render(<InferencePage />);
    const choice = await screen.findByTestId("engine-build-choice", {}, { timeout: 5000 });
    await act(async () => {
      fireEvent.change(choice, { target: { value: "win-sycl-x64" } });
    });
    await act(async () => {
      screen.getByRole("button", { name: "Install llama.cpp" }).click();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("is not a build release b11211");
  });
});

describe("a served model's context window", () => {
  /** What the gateway lists: the one model, with or without its window. */
  function listed(model: Record<string, unknown>) {
    handlers.set("GET gateway/v1/models", () => ({
      status: 200,
      body: { object: "list", data: [{ id: "gemma-3-27b", object: "model", ...model }] },
    }));
  }

  async function modelCell() {
    render(<InferencePage />);
    const context = await screen.findByTestId("model-context", {}, { timeout: 5000 });
    return context.closest('[data-testid="backend-model"]') as HTMLElement;
  }

  it("sits beside the model's name, as the gateway reports it", async () => {
    listed({ x_eugene_plexus: { context_length: 32768 } });
    expect(await modelCell()).toHaveTextContent(/^gemma-3-27b · 32k context$/);
  });

  it("says it is unknown when the gateway serves the model and gives no window", async () => {
    listed({ x_eugene_plexus: {} });
    expect(await modelCell()).toHaveTextContent(/^gemma-3-27b · context unknown$/);
  });

  it("says nothing when the gateway does not answer, and the name still shows", async () => {
    const row = await rowFor("gemma-3-27b");
    expect(row).toBeInTheDocument();
    expect(screen.queryByTestId("model-context")).toBeNull();
  });
});

describe("why the gateway routes nothing to a row (2026-10-10)", () => {
  function driver(over: Record<string, unknown>) {
    handlers.set("GET gateway/v1/admin/drivers", () => ({
      status: 200,
      body: {
        drivers: [
          {
            name: "gemma-a-driver",
            runtime: "gemma-a",
            url: "http://192.168.16.75:8093/",
            ...over,
          },
        ],
      },
    }));
  }

  it("says the gateway cannot reach a runtime's driver, and why, on its row", async () => {
    driver({
      reachable: false,
      error:
        "no answer within 10 s connecting to 192.168.16.75:8093: the machine is off the " +
        "network, or a firewall there is dropping connections to port 8093",
    });
    const row = await rowFor("gemma-3-27b");
    expect(within(row).getByTestId("driver-unreachable")).toHaveTextContent(
      "The gateway cannot reach its driver: no answer within 10 s connecting to 192.168.16.75:8093",
    );
  });

  it("says what a driver that answers but serves nothing said", async () => {
    driver({ reachable: true, error: "answers, but serves nothing: no backend configured" });
    const row = await rowFor("gemma-3-27b");
    expect(within(row).getByTestId("driver-error")).toHaveTextContent(
      "Its driver answers, but serves nothing: no backend configured",
    );
  });
});

describe("a selection that is not here any more", () => {
  it("says so instead of showing it", async () => {
    search = new URLSearchParams("sel=driver:gone-driver@Amish_Station");
    await rowFor("gemma-3-27b");
    await waitFor(() =>
      expect(screen.getByTestId("inference-scope")).toHaveTextContent(
        "Nothing named gone-driver on Amish_Station is listed; showing Amish_Station.",
      ),
    );
  });

  it("moves to the machine when the selected backend is removed", async () => {
    nav.replace.mockClear();
    search = new URLSearchParams("sel=driver:gemma-a-driver@Amish_Station");
    handlers.set("DELETE agent/v1/runtimes/gemma-a", () => ({ status: 204 }));
    const row = await rowFor("gemma-3-27b");
    await act(async () => {
      within(row).getByTestId("remove-row").click();
    });
    await act(async () => {
      within(row).getByTestId("remove-row-confirm").click();
    });
    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith(
        `/inference?sel=${encodeURIComponent("backends:node:Amish_Station")}`,
      ),
    );
  });
});

describe("a stop that outlives a reboot, and whether a model starts with Eugene (agent#11)", () => {
  it("says why a runtime is stopped, in words", async () => {
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: { runtimes: [nodeRuntime({ status: "stopped", stopReason: "operator" })] },
    }));
    const row = await rowFor("gemma-3-27b");
    await waitFor(() =>
      expect(within(row).getByTestId("stop-reason")).toHaveTextContent(
        "someone stopped it, and it stays stopped until it is started",
      ),
    );
  });

  it("saves Start when Eugene starts without restarting the model", async () => {
    // The node's own read is slower than this screen: it still says true
    // after the save, and the box shows what was saved.
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: { runtimes: [nodeRuntime({ autoStart: true })] },
    }));
    handlers.set("PUT agent/v1/runtimes/gemma-a/auto-start", () => ({
      status: 200,
      body: nodeRuntime({ autoStart: false }),
    }));
    const row = await rowFor("gemma-3-27b");
    const box = (await within(row).findByTestId("auto-start")) as HTMLInputElement;
    expect(box.checked).toBe(true);
    await act(async () => {
      fireEvent.click(box);
    });
    await waitFor(() => expect(box.checked).toBe(false));
    const calls = vi.mocked(fetch).mock.calls.map(([input, init]) => ({
      route: String(input),
      method: init?.method ?? "GET",
      body: init?.body,
    }));
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.route).toContain("agent/v1/runtimes/gemma-a/auto-start");
    expect(JSON.parse(String(put?.body))).toEqual({ autoStart: false });
    // Nothing was stopped, started or restarted to save it.
    expect(calls.some((c) => c.method === "POST" && /\/(start|stop|restart)$/.test(c.route))).toBe(
      false,
    );
  });

  it("keeps the box as it was, and says why, when the node refuses", async () => {
    handlers.set("PUT agent/v1/runtimes/gemma-a/auto-start", () => ({
      status: 500,
      body: { detail: "disk full" },
    }));
    const row = await rowFor("gemma-3-27b");
    const box = (await within(row).findByTestId("auto-start")) as HTMLInputElement;
    await act(async () => {
      fireEvent.click(box);
    });
    await waitFor(() =>
      expect(
        screen.getByText(/Could not change whether Eugene starts gemma-a/),
      ).toBeInTheDocument(),
    );
    expect(box.checked).toBe(true);
  });
});

describe("a row says its state in a sentence (CX1)", () => {
  it("says a crashed engine gave up, in words, and offers Try again", async () => {
    let started = 0;
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: { runtimes: [nodeRuntime({ status: "crashed", lastError: "exit code 3" })] },
    }));
    handlers.set("POST agent/v1/runtimes/gemma-a/start", () => {
      started += 1;
      return { status: 202, body: {} };
    });
    const row = await rowFor("gemma-3-27b");
    const line = await within(row).findByTestId("status-sentence", {}, { timeout: 5000 });
    expect(line).toHaveTextContent("failed to start several times, so Eugene stopped trying");
    fireEvent.click(within(row).getByTestId("status-retry"));
    await waitFor(() => expect(started).toBe(1));
  });

  it("installs a missing engine and starts the model from one button", async () => {
    let installs = 0;
    let started = 0;
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: { runtimes: [nodeRuntime({ status: "stopped" })] },
    }));
    handlers.set("GET agent/v1/engines", () => ({
      status: 200,
      body: {
        engines: [
          {
            engine: "llama_cpp",
            available: installs > 0,
            modelFormats: ["gguf"],
            acquisition: { installable: true },
          },
        ],
      },
    }));
    handlers.set("POST agent/v1/engines/llama_cpp/install", () => {
      installs += 1;
      return { status: 202, body: { engine: "llama_cpp", state: "done" } };
    });
    handlers.set("GET agent/v1/engines/llama_cpp/install", () => ({
      status: 200,
      body: installs > 0 ? { engine: "llama_cpp", state: "done" } : { state: "idle" },
    }));
    handlers.set("POST agent/v1/runtimes/gemma-a/start", () => {
      started += 1;
      return { status: 202, body: {} };
    });
    const row = await rowFor("gemma-3-27b");
    const button = await within(row).findByTestId("install-and-start", {}, { timeout: 5000 });
    expect(button).toHaveTextContent("Install llama.cpp and start");
    fireEvent.click(button);
    await waitFor(() => expect(started).toBe(1));
    expect(installs).toBe(1);
  });
});

describe("a program Eugene's own account will not run (row 8)", () => {
  it("names it, and one button runs Eugene's own build instead", async () => {
    let installs = 0;
    let patched = 0;
    let started = 0;
    const refused = "/opt/homebrew/bin/llama-server";
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: {
        runtimes: [
          nodeRuntime({
            status: "crashed",
            binary: refused,
            refusedBinary: refused,
            lastError: `${refused} belongs to troy; Eugene's own account runs programs only from folders it or root owns. Move it, or let Eugene fetch its own build`,
          }),
        ],
      },
    }));
    handlers.set("GET agent/v1/engines", () => ({
      status: 200,
      body: {
        engines: [
          {
            engine: "llama_cpp",
            available: installs > 0,
            modelFormats: ["gguf"],
            acquisition: { installable: true },
          },
        ],
      },
    }));
    handlers.set("POST agent/v1/engines/llama_cpp/install", () => {
      installs += 1;
      return { status: 202, body: { engine: "llama_cpp", state: "done" } };
    });
    handlers.set("PATCH agent/v1/runtimes/gemma-a", () => {
      patched += 1;
      return { status: 200, body: nodeRuntime({ status: "starting" }) };
    });
    handlers.set("POST agent/v1/runtimes/gemma-a/start", () => {
      started += 1;
      return { status: 202, body: {} };
    });
    const row = await rowFor("gemma-3-27b");
    const said = await within(row).findByTestId("refused-binary", {}, { timeout: 5000 });
    expect(said).toHaveTextContent(`Eugene won't run ${refused}: someone else can change it.`);
    const button = within(said).getByTestId("use-own-build");
    expect(button).toHaveTextContent("Use Eugene's own llama.cpp");
    fireEvent.click(button);
    await waitFor(() => expect(started).toBe(1));
    expect(installs).toBe(1);
    expect(patched).toBe(1);
    const calls = vi.mocked(fetch).mock.calls;
    const patch = calls.find(([, init]) => init?.method === "PATCH");
    const body = JSON.parse(String(patch?.[1]?.body));
    expect(body.name).toBe("gemma-a");
    expect(body.modelPath).toBe("/models/gemma-27b-Q6_K_L.gguf");
    expect("binary" in body).toBe(false);
    expect("refusedBinary" in body).toBe(false);
  });

  it("says nothing of the kind for a runtime Eugene runs", async () => {
    const row = await rowFor("gemma-3-27b");
    await within(row).findByTestId("backend-model");
    expect(within(row).queryByTestId("refused-binary")).toBeNull();
    expect(within(row).queryByTestId("exec-approval")).toBeNull();
  });

  // Part 8c (call R8-EXEC-TRUST): a program only one other account can
  // change runs once the owner says so; the console asks, plainly.
  const program = "/home/ada/bin/llama-server";
  const asking = (kind: "needs_approval" | "refused") =>
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: {
        runtimes: [
          nodeRuntime({
            status: "crashed",
            binary: program,
            refusedBinary: program,
            // The kind decides, whatever else a node sends.
            execTrust: { kind, path: program, account: "ada", sha256: "ab".repeat(32) },
            lastError: `Eugene's own account runs ${program} only once an owner approves it`,
          }),
        ],
      },
    }));

  it("asks before running a program one other account can change, and runs it once approved", async () => {
    let started = 0;
    asking("needs_approval");
    handlers.set("POST agent/v1/exec-approvals", () => ({ status: 201, body: {} }));
    handlers.set("POST agent/v1/runtimes/gemma-a/start", () => {
      started += 1;
      return { status: 202, body: {} };
    });
    const row = await rowFor("gemma-3-27b");
    const ask = await within(row).findByTestId("exec-approval", {}, { timeout: 5000 });
    expect(ask).toHaveTextContent(
      "Run llama-server from /home/ada/bin as Eugene's account? Anyone who can change this file (ada) can then act as Eugene.",
    );
    // Eugene's own build stays on offer beside the question.
    expect(within(ask).getByTestId("use-own-build")).toHaveTextContent(
      "Use Eugene's own llama.cpp",
    );
    expect(within(row).queryByTestId("refused-binary")).toBeNull();
    fireEvent.click(within(ask).getByTestId("exec-approve"));
    await waitFor(() => expect(started).toBe(1));
    const approval = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url, init]) => init?.method === "POST" && String(url).includes("exec-approvals"),
      );
    expect(JSON.parse(String(approval?.[1]?.body))).toEqual({
      path: program,
      sha256: "ab".repeat(32),
    });
  });

  it("Not now approves nothing", async () => {
    asking("needs_approval");
    const row = await rowFor("gemma-3-27b");
    const ask = await within(row).findByTestId("exec-approval", {}, { timeout: 5000 });
    fireEvent.click(within(ask).getByTestId("exec-not-now"));
    await waitFor(() => expect(within(row).queryByTestId("exec-approval")).toBeNull());
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls.some(([url]) => String(url).includes("exec-approvals"))).toBe(false);
  });

  it("does not offer to approve a program others can change", async () => {
    asking("refused");
    const row = await rowFor("gemma-3-27b");
    await within(row).findByTestId("refused-binary", {}, { timeout: 5000 });
    expect(within(row).queryByTestId("exec-approval")).toBeNull();
  });
});

describe("a running model's repeatable answers (row 20)", () => {
  it.each([true, false])("shows the effective launch setting: %s", async (enabled) => {
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: { runtimes: [nodeRuntime({ flags: { sameAnswerEveryTime: enabled } })] },
    }));
    const row = await rowFor("gemma-3-27b");
    const line = await within(row).findByTestId("same-answer");
    expect(line).toHaveTextContent(
      enabled
        ? "Same answer every time: on; one request at a time; others wait."
        : "Same answer every time: off.",
    );
  });
});

describe("a running model's prompt cache (row 9)", () => {
  it("says the size it was started with and where it came from", async () => {
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: {
        runtimes: [
          nodeRuntime({
            promptCache: { bytes: 24 * 1024 ** 3, source: "profile", note: null },
          }),
        ],
      },
    }));
    const row = await rowFor("gemma-3-27b");
    expect(await within(row).findByTestId("prompt-cache")).toHaveTextContent(
      "Prompt cache: 24 GiB of system memory, set on the profile.",
    );
  });

  it("says why a size is not what the profile asked for", async () => {
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: {
        runtimes: [
          nodeRuntime({
            promptCache: {
              bytes: null,
              source: "unsupported",
              note: "This llama.cpp build has no --cache-ram, so Prompt cache in system memory is not passed.",
            },
          }),
        ],
      },
    }));
    const row = await rowFor("gemma-3-27b");
    const line = await within(row).findByTestId("prompt-cache");
    expect(line).toHaveTextContent("Prompt cache: not set");
    expect(line).toHaveTextContent("This llama.cpp build has no --cache-ram");
  });

  it("says nothing for a runtime that reports none", async () => {
    const row = await rowFor("gemma-3-27b");
    expect(within(row).queryByTestId("prompt-cache")).toBeNull();
  });
});
