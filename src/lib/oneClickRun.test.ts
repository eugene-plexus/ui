/**
 * One-click run, driven against the bodies the components return.
 *
 * `fetch` is mocked at the boundary the api client uses, as Home's test
 * does, so a call's target reads off the URL and the ORDER of calls is
 * what is asserted -- that is where the defects of a flow like this live
 * (a profile saved before the engine exists; a runtime declared after a
 * refused install). Handlers may be stateful: an install that goes
 * resolving → downloading → done, a runtime that goes starting → loading
 * → ready, an engine that becomes available once installed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  answerInstall,
  describeRunDetail,
  dismissRun,
  findRun,
  getRuns,
  resetRunsForTests,
  runTask,
  startRun,
  type RunTask,
} from "./oneClickRun";
import type { TargetNode } from "./nodeBudget";
import type { LibraryModel } from "./types";

interface Call {
  method: string;
  route: string;
  body: Record<string, unknown> | undefined;
}

type Handler = (call: Call) => { status: number; body?: unknown };

let calls: Call[];
let handlers: Map<string, Handler>;

const MODEL: LibraryModel = {
  id: "m1",
  path: "D:\\models\\unsloth\\Qwen3-14B-GGUF\\Qwen3-14B-UD-Q6_K_XL.gguf",
  format: "gguf",
  name: "Qwen3-14B-UD-Q6_K_XL",
  status: "present",
  contextLength: 40960,
};
const RUNTIME = "qwen3-14b-ud-q6-k-xl";

const HERE: TargetNode = {
  name: null,
  label: "this host",
  local: true,
  target: "agent",
  reachable: true,
  lastError: null,
  budget: null,
};

const NODE_B: TargetNode = {
  name: "node-b",
  label: "node-b",
  local: false,
  target: "node:node-b",
  reachable: true,
  lastError: null,
  budget: null,
};

const LLAMA_INSTALLED = {
  engine: "llama_cpp",
  available: true,
  version: "b10948",
  modelFormats: ["gguf"],
  acquisition: { installable: true, policy: "managed" },
};
const LLAMA_MISSING = {
  engine: "llama_cpp",
  available: false,
  modelFormats: ["gguf"],
  acquisition: { installable: true, policy: "managed", version: "b10948" },
};
const ADMIT = {
  decision: "admit",
  fit: "fits",
  basis: "metadata",
  reason: "fits",
  maxContextLength: 32768,
  contextLength: 40960,
};
const PROFILE = {
  id: "p1",
  name: "default",
  default: true,
  engine: "llama_cpp",
  flags: { contextSize: 32768 },
};

/** A runtime that answers with each status in turn, then holds the last. */
function runtimeSequence(...statuses: string[]): Handler {
  let i = 0;
  return () => {
    const status = statuses[Math.min(i, statuses.length - 1)];
    i += 1;
    return {
      status: 200,
      body: { name: RUNTIME, engine: "llama_cpp", modelPath: MODEL.path, status },
    };
  };
}

const FAST = { pollMs: 2, settleMs: 60_000 };

function key(call: Call): string {
  return `${call.method} ${call.route}`;
}

/** The happy path's routes: an engine installed, no profile, nothing declared. */
function fresh(): Map<string, Handler> {
  return new Map<string, Handler>([
    ["GET agent/v1/engines", () => ({ status: 200, body: { engines: [LLAMA_INSTALLED] } })],
    ["GET library/v1/models/m1/profiles", () => ({ status: 200, body: { profiles: [] } })],
    ["POST agent/v1/runtimes/admission", () => ({ status: 200, body: ADMIT })],
    ["POST library/v1/models/m1/profiles", () => ({ status: 201, body: PROFILE })],
    ["GET agent/v1/runtimes", () => ({ status: 200, body: { runtimes: [] } })],
    [
      "POST agent/v1/runtimes",
      (call) => ({ status: 201, body: { ...call.body, status: "starting" } }),
    ],
    [`GET agent/v1/runtimes/${RUNTIME}`, runtimeSequence("starting", "loading", "ready")],
  ]);
}

async function stepIs(id: string, step: RunTask["step"]): Promise<RunTask> {
  await vi.waitFor(() => expect(findRun(MODEL.id, id)?.step).toBe(step), {
    timeout: 4000,
    interval: 2,
  });
  return findRun(MODEL.id, id) as RunTask;
}

function routes(): string[] {
  return calls.map(key);
}

beforeEach(() => {
  calls = [];
  handlers = fresh();
  resetRunsForTests();
  sessionStorage.setItem("eugene-session-token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? "GET",
        route: String(input).replace(/^\/api\/proxy\//, ""),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const handler = handlers.get(key(call));
      const result = handler
        ? handler(call)
        : { status: 418, body: { detail: { title: `unhandled route: ${key(call)}` } } };
      return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
        status: result.status,
        statusText: String(result.status),
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  resetRunsForTests();
  vi.unstubAllGlobals();
});

describe("Run with an engine installed", () => {
  it("makes `default` at the context that fits, declares the runtime, and ends ready", async () => {
    startRun(MODEL, HERE, FAST);
    const task = await stepIs("agent", "ready");

    expect(routes()).toEqual([
      "GET agent/v1/engines",
      "GET library/v1/models/m1/profiles",
      "POST agent/v1/runtimes/admission",
      "POST library/v1/models/m1/profiles",
      "GET agent/v1/runtimes",
      "POST agent/v1/runtimes",
      `GET agent/v1/runtimes/${RUNTIME}`,
      `GET agent/v1/runtimes/${RUNTIME}`,
      `GET agent/v1/runtimes/${RUNTIME}`,
    ]);
    // The profile is the one the profile form would have made.
    const saved = calls.find((c) => key(c) === "POST library/v1/models/m1/profiles");
    expect(saved?.body).toEqual({
      name: "default",
      engine: "llama_cpp",
      default: true,
      flags: { contextSize: 32768 },
      extraArgs: [],
      env: {},
    });
    // The admission probe is asked with the flags the profile would start
    // empty, and never starts anything.
    const probe = calls.find((c) => key(c) === "POST agent/v1/runtimes/admission");
    expect(probe?.body).toMatchObject({
      engine: "llama_cpp",
      modelPath: MODEL.path,
      autoStart: false,
    });
    // The declaration is exactly the profile editor's composition.
    const declared = calls.find((c) => key(c) === "POST agent/v1/runtimes");
    expect(declared?.body).toEqual({
      name: RUNTIME,
      engine: "llama_cpp",
      modelPath: MODEL.path,
      flags: { contextSize: 32768 },
      autoStart: true,
    });
    expect(task.runtime).toBe(RUNTIME);
    expect(task.engine).toBe("llama_cpp");
    expect(describeRunDetail(task).detail).toBe("ready — try it on Home");
    expect(runTask(task).href).toBe("/");
    // Nothing was installed and nothing was asked.
    expect(routes().some((r) => r.includes("/install"))).toBe(false);
  });

  it("uses the model's default profile when one exists and saves none", async () => {
    handlers.set("GET library/v1/models/m1/profiles", () => ({
      status: 200,
      body: {
        profiles: [
          {
            id: "p2",
            name: "fast",
            default: false,
            engine: "llama_cpp",
            flags: { contextSize: 8192 },
          },
          { ...PROFILE, flags: { contextSize: 16384, gpuLayers: 99 } },
        ],
      },
    }));
    startRun(MODEL, HERE, FAST);
    await stepIs("agent", "ready");
    expect(routes()).not.toContain("POST library/v1/models/m1/profiles");
    expect(routes()).not.toContain("POST agent/v1/runtimes/admission");
    const declared = calls.find((c) => key(c) === "POST agent/v1/runtimes");
    expect(declared?.body).toMatchObject({
      name: RUNTIME,
      flags: { contextSize: 16384, gpuLayers: 99 },
    });
  });

  it("leaves the context to the engine when the model's own context fits", async () => {
    handlers.set("POST agent/v1/runtimes/admission", () => ({
      status: 200,
      body: { ...ADMIT, maxContextLength: 131072 },
    }));
    startRun(MODEL, HERE, FAST);
    await stepIs("agent", "ready");
    const saved = calls.find((c) => key(c) === "POST library/v1/models/m1/profiles");
    expect(saved?.body).toMatchObject({ flags: {} });
  });

  it("starts a runtime this file already has rather than declaring a second", async () => {
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: {
        runtimes: [
          {
            name: RUNTIME,
            engine: "llama_cpp",
            modelPath: MODEL.path,
            status: "stopped",
            stopReason: "autoStart",
          },
        ],
      },
    }));
    handlers.set("GET library/v1/models/m1/profiles", () => ({
      status: 200,
      body: { profiles: [PROFILE] },
    }));
    handlers.set(`POST agent/v1/runtimes/${RUNTIME}/start`, () => ({
      status: 202,
      body: { scheduled: true, delayMs: 0, message: "Start scheduled" },
    }));
    startRun(MODEL, HERE, FAST);
    await stepIs("agent", "ready");
    expect(routes()).toContain(`POST agent/v1/runtimes/${RUNTIME}/start`);
    expect(routes()).not.toContain("POST agent/v1/runtimes");
  });

  it("is ready at once when the runtime is already serving", async () => {
    handlers.set("GET agent/v1/runtimes", () => ({
      status: 200,
      body: {
        runtimes: [{ name: RUNTIME, engine: "llama_cpp", modelPath: MODEL.path, status: "ready" }],
      },
    }));
    handlers.set("GET library/v1/models/m1/profiles", () => ({
      status: 200,
      body: { profiles: [PROFILE] },
    }));
    startRun(MODEL, HERE, FAST);
    await stepIs("agent", "ready");
    expect(routes().filter((r) => r.startsWith("POST agent/v1/runtimes"))).toEqual([]);
  });

  it("names the load step and relays the engine's last error when it crashes", async () => {
    handlers.set(`GET agent/v1/runtimes/${RUNTIME}`, () => ({
      status: 200,
      body: {
        name: RUNTIME,
        engine: "llama_cpp",
        modelPath: MODEL.path,
        status: "crashed",
        lastError: "llama-server exited with code 1: failed to load model",
      },
    }));
    startRun(MODEL, HERE, FAST);
    const task = await stepIs("agent", "failed");
    expect(task.failedStep).toBe("load");
    expect(describeRunDetail(task).detail).toBe(
      "Loading failed: llama-server exited with code 1: failed to load model",
    );
    expect(runTask(task).tone).toBe("error");
    expect(runTask(task).href).toBe("/inference");
  });

  it("relays a refused launch in the agent's own words, naming the start step", async () => {
    handlers.set("POST agent/v1/runtimes", () => ({
      status: 422,
      body: {
        detail: {
          title: "Admission refused",
          detail:
            "Qwen3-14B needs 41.1 GiB at 262,144 context and 29.7 GiB is free. It fits up to 75,520 context on this device. Set contextSize to 75,520 or below.",
        },
      },
    }));
    startRun(MODEL, HERE, FAST);
    const task = await stepIs("agent", "failed");
    expect(task.failedStep).toBe("launch");
    expect(task.error).toContain("Set contextSize to 75,520 or below");
    expect(describeRunDetail(task).detail.startsWith("Starting failed: ")).toBe(true);
  });

  it("is one run per model per node while in progress", async () => {
    const first = startRun(MODEL, HERE, FAST);
    const second = startRun(MODEL, HERE, FAST);
    expect(second).toBe(first);
    expect(getRuns()).toHaveLength(1);
    await stepIs("agent", "ready");
  });
});

describe("Run with no engine installed", () => {
  beforeEach(() => {
    // An install that goes resolving → downloading → done, after which
    // the agent reports the engine available.
    let installed = false;
    const states = ["resolving", "downloading", "done"];
    let i = 0;
    handlers.set("GET agent/v1/engines", () => ({
      status: 200,
      body: { engines: [installed ? LLAMA_INSTALLED : LLAMA_MISSING] },
    }));
    handlers.set("POST agent/v1/engines/llama_cpp/install", () => ({
      status: 202,
      body: { engine: "llama_cpp", state: "resolving" },
    }));
    handlers.set("GET agent/v1/engines/llama_cpp/install", () => {
      const state = states[Math.min(i, states.length - 1)];
      i += 1;
      if (state === "done") installed = true;
      return {
        status: 200,
        body: {
          engine: "llama_cpp",
          state,
          version: "b10948",
          bytesTotal: 500_000_000,
          bytesDownloaded: state === "downloading" ? 250_000_000 : 0,
        },
      };
    });
  });

  it("asks first, and Install runs the agent's install to done before anything is saved", async () => {
    startRun(MODEL, HERE, FAST);
    const asking = await stepIs("agent", "awaiting-install");
    expect(asking.engine).toBe("llama_cpp");
    expect(describeRunDetail(asking).detail).toBe("waiting for your answer: install llama.cpp?");
    // Nothing beyond the engines read has happened: no profile, no runtime.
    expect(routes()).toEqual(["GET agent/v1/engines"]);

    answerInstall(asking.id, "install");
    const task = await stepIs("agent", "ready");

    const order = routes();
    expect(order.indexOf("POST agent/v1/engines/llama_cpp/install")).toBeLessThan(
      order.indexOf("POST library/v1/models/m1/profiles"),
    );
    expect(order.filter((r) => r === "GET agent/v1/engines/llama_cpp/install")).toHaveLength(3);
    // The engines were re-read after the install and found available.
    expect(order.filter((r) => r === "GET agent/v1/engines")).toHaveLength(2);
    expect(task.runtime).toBe(RUNTIME);
    // The declaration started the engine: Install is the default path.
    const declared = calls.find((c) => key(c) === "POST agent/v1/runtimes");
    expect(declared?.body).toMatchObject({ autoStart: true });
  });

  it("reports the install's bytes while it downloads, and claims the tray's own install row", async () => {
    // Hold the install at `downloading` so the state can be observed.
    let i = 0;
    handlers.set("GET agent/v1/engines/llama_cpp/install", () => {
      i += 1;
      return {
        status: 200,
        body: {
          engine: "llama_cpp",
          state: "downloading",
          version: "b10948",
          bytesTotal: 500_000_000,
          bytesDownloaded: 250_000_000,
        },
      };
    });
    startRun(MODEL, HERE, FAST);
    const asking = await stepIs("agent", "awaiting-install");
    answerInstall(asking.id, "install");
    await vi.waitFor(() => expect(i).toBeGreaterThan(1), { timeout: 2000, interval: 2 });
    const task = findRun(MODEL.id, "agent") as RunTask;
    expect(task.step).toBe("installing");
    const line = describeRunDetail(task);
    expect(line.detail).toBe("installing llama.cpp b10948 · 50% of 500 MB");
    expect(line.progress).toBe(0.5);
    const tray = runTask(task);
    expect(tray.title).toBe("Run Qwen3-14B-UD-Q6_K_XL on this machine");
    expect(tray.claims).toEqual({ engine: "llama_cpp" });
    expect(tray.dismiss).toBeUndefined();
  });

  it("Skip declares the runtime stopped, starts nothing, and says where it is listed", async () => {
    startRun(MODEL, HERE, FAST);
    const asking = await stepIs("agent", "awaiting-install");
    answerInstall(asking.id, "skip");
    const task = await stepIs("agent", "skipped");

    expect(routes()).not.toContain("POST agent/v1/engines/llama_cpp/install");
    const declared = calls.find((c) => key(c) === "POST agent/v1/runtimes");
    expect(declared?.body).toMatchObject({ name: RUNTIME, autoStart: false });
    // The default profile is still made: the flags are right when an
    // engine arrives, and the number came from admission, not the binary.
    expect(routes()).toContain("POST library/v1/models/m1/profiles");
    expect(routes().some((r) => r.endsWith("/start"))).toBe(false);
    expect(describeRunDetail(task).detail).toBe(
      "not started: llama.cpp is not installed on this machine. It is listed on Inference as stopped; install the engine there and press start.",
    );
    expect(runTask(task).href).toBe("/inference");
    expect(runTask(task).dismiss).toBeDefined();
  });

  it("a failed install names the install step and declares nothing", async () => {
    let i = 0;
    handlers.set("GET agent/v1/engines/llama_cpp/install", () => {
      i += 1;
      return {
        status: 200,
        body:
          i < 2
            ? { engine: "llama_cpp", state: "downloading" }
            : {
                engine: "llama_cpp",
                state: "failed",
                error: "release b10931 has no asset for 'win-cuda-13.3-x64'",
              },
      };
    });
    startRun(MODEL, HERE, FAST);
    const asking = await stepIs("agent", "awaiting-install");
    answerInstall(asking.id, "install");
    const task = await stepIs("agent", "failed");
    expect(task.failedStep).toBe("install");
    expect(describeRunDetail(task).detail).toBe(
      "Installing llama.cpp failed: release b10931 has no asset for 'win-cuda-13.3-x64'",
    );
    expect(routes()).not.toContain("POST agent/v1/runtimes");
    expect(routes()).not.toContain("POST library/v1/models/m1/profiles");
  });

  it("Cancel while asking forgets the run and touches nothing", async () => {
    const id = startRun(MODEL, HERE, FAST);
    await stepIs("agent", "awaiting-install");
    dismissRun(id);
    await vi.waitFor(() => expect(getRuns()).toHaveLength(0));
    // Give the orchestrator a tick to notice; it must not continue.
    await new Promise((r) => setTimeout(r, 10));
    expect(routes()).toEqual(["GET agent/v1/engines"]);
  });

  it("an engine that cannot be installed here fails at the check with the agent's reason", async () => {
    handlers.set("GET agent/v1/engines", () => ({
      status: 200,
      body: {
        engines: [
          {
            engine: "llama_cpp",
            available: false,
            modelFormats: ["gguf"],
            acquisition: {
              installable: false,
              policy: "managed",
              reason: "upstream publishes no CUDA build for Linux",
            },
          },
        ],
      },
    }));
    startRun(MODEL, HERE, FAST);
    const task = await stepIs("agent", "failed");
    expect(task.failedStep).toBe("check");
    expect(task.error).toBe(
      "llama.cpp is not installed on this machine, and Eugene cannot install it there: upstream publishes no CUDA build for Linux",
    );
    expect(routes()).toEqual(["GET agent/v1/engines"]);
  });

  it("a hand-installed engine's command is relayed when it is missing", async () => {
    const safetensors: LibraryModel = { ...MODEL, format: "safetensors" };
    handlers.set("GET agent/v1/engines", () => ({
      status: 200,
      body: {
        engines: [
          LLAMA_MISSING,
          {
            engine: "vllm",
            available: false,
            modelFormats: ["safetensors"],
            acquisition: {
              installable: false,
              policy: "manual",
              reason: "vLLM is installed by hand",
              manualInstall: { command: "uv pip install vllm --torch-backend=auto" },
            },
          },
        ],
      },
    }));
    startRun(safetensors, HERE, FAST);
    const task = await stepIs("agent", "failed");
    expect(task.error).toContain("vLLM is not installed on this machine");
    expect(task.error).toContain("uv pip install vllm --torch-backend=auto");
  });
});

describe("Run on a model nothing can load", () => {
  it("fails at the check and names the format", async () => {
    const safetensors: LibraryModel = { ...MODEL, format: "safetensors" };
    startRun(safetensors, HERE, FAST);
    const task = await stepIs("agent", "failed");
    expect(task.failedStep).toBe("check");
    expect(task.error).toBe(
      "Nothing on this machine can load a safetensors model (it has llama.cpp). A safetensors model needs vLLM, which is installed by hand; GGUF files run on llama.cpp.",
    );
    expect(runTask(task).href).toBe("/library?model=m1");
  });
});

describe("Run on another node", () => {
  it("declares through the control root and watches through that node's agent", async () => {
    handlers = new Map<string, Handler>([
      ["GET node:node-b/v1/engines", () => ({ status: 200, body: { engines: [LLAMA_INSTALLED] } })],
      ["GET library/v1/models/m1/profiles", () => ({ status: 200, body: { profiles: [PROFILE] } })],
      ["GET node:node-b/v1/runtimes", () => ({ status: 200, body: { runtimes: [] } })],
      [
        "POST control/v1/runtimes",
        (call) => ({ status: 201, body: { node: "node-b", ...(call.body?.spec as object) } }),
      ],
      [`GET node:node-b/v1/runtimes/${RUNTIME}`, runtimeSequence("loading", "ready")],
    ]);
    startRun(MODEL, NODE_B, FAST);
    const task = await stepIs("node:node-b", "ready");
    const placed = calls.find((c) => key(c) === "POST control/v1/runtimes");
    expect(placed?.body).toEqual({
      node: "node-b",
      spec: {
        name: RUNTIME,
        engine: "llama_cpp",
        modelPath: MODEL.path,
        flags: { contextSize: 32768 },
        autoStart: true,
      },
    });
    expect(routes()).not.toContain("POST agent/v1/runtimes");
    expect(task.node.label).toBe("node-b");
    expect(runTask(task).title).toBe("Run Qwen3-14B-UD-Q6_K_XL on node-b");
  });
});

describe("the words", () => {
  const BANNED = [
    "runtime",
    "companion",
    "declaration",
    "declared",
    "admission",
    "mint",
    "epoch",
    "topology",
    "routing",
  ];
  const base: RunTask = {
    id: "run:m1@agent",
    model: { id: "m1", name: "Qwen3-14B", path: "x", format: "gguf", contextLength: null },
    node: { target: "agent", label: "this machine", name: null, local: true },
    step: "checking",
    failedStep: null,
    engine: "llama_cpp",
    install: { engine: "llama_cpp", state: "downloading", bytesTotal: 10, bytesDownloaded: 5 },
    download: null,
    runtime: "qwen3-14b",
    runtimeStatus: "loading",
    error: null,
    startedAt: 0,
    finishedAt: null,
    generation: 1,
  };

  it("are the person's, on every step this module writes itself", () => {
    const steps: RunTask["step"][] = [
      "checking",
      "awaiting-install",
      "installing",
      "settings",
      "launching",
      "loading",
      "ready",
      "skipped",
    ];
    for (const step of steps) {
      const line = `${runTask({ ...base, step }).title} ${describeRunDetail({ ...base, step }).detail}`;
      for (const word of BANNED) {
        expect(line.toLowerCase(), `step ${step} says "${word}": ${line}`).not.toContain(word);
      }
    }
  });
});
