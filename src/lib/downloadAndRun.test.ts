/**
 * "Download and run" as one action, and as one that survives the tab.
 *
 * §6.3 of the hobbyist UX plan asks for a single chained task: download,
 * install the engine if absent, make the profile, launch, be ready. The
 * hard half is not the chain — it is that a 16 GB transfer outlives the
 * browser, so the intent lives on the download record and exactly one
 * console picks it up again.
 *
 * Mocked at `fetch`, like `oneClickRun.test.ts`, because the ORDER of
 * calls is where this kind of flow goes wrong: a claim before the scan
 * has named the model, a profile made for a file that never landed, two
 * consoles launching the same thing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  findRunFor,
  getRuns,
  pendingChainedRuns,
  resetRunsForTests,
  resumeClaimedRuns,
  runTask,
  startDownloadAndRun,
  type RunTask,
} from "./oneClickRun";
import { mergeTasks, tasksFrom } from "./tasks";
import type { TargetNode } from "./nodeBudget";
import type { Download } from "./types";

interface Call {
  method: string;
  route: string;
  body: Record<string, unknown> | undefined;
}
type Handler = (call: Call) => { status: number; body?: unknown };

let calls: Call[];
let handlers: Map<string, Handler>;

const HERE: TargetNode = {
  name: null,
  label: "this host",
  local: true,
  target: "agent",
  reachable: true,
  lastError: null,
  budget: null,
};

const MODEL = {
  id: "m1",
  path: "D:\\models\\unsloth\\Qwen3.5-4B-GGUF\\Qwen3.5-4B-Q4_K_M.gguf",
  format: "gguf",
  name: "Qwen3.5-4B-Q4_K_M",
  status: "present",
  contextLength: 262144,
};
const RUNTIME = "qwen3-5-4b-q4-k-m";

const LLAMA_INSTALLED = {
  engine: "llama_cpp",
  available: true,
  version: "b10999",
  modelFormats: ["gguf"],
  acquisition: { installable: true, policy: "managed" },
};
const ADMIT = {
  decision: "admit",
  fit: "fits",
  basis: "metadata",
  reason: "fits",
  maxContextLength: 32768,
  contextLength: 262144,
};
const PROFILE = {
  id: "p1",
  name: "default",
  default: true,
  engine: "llama_cpp",
  flags: { contextSize: 32768 },
};

const SPEC = {
  repo: "unsloth/Qwen3.5-4B-GGUF",
  file: "Qwen3.5-4B-Q4_K_M.gguf",
  label: "Qwen3.5-4B",
  sizeBytes: 2_740_937_888,
};

function record(over: Partial<Download> = {}): Download {
  return {
    id: "d1",
    state: "downloading",
    repo: SPEC.repo,
    files: [{ path: SPEC.file, destinationPath: `D:\\models\\${SPEC.file}`, state: "downloading" }],
    bytesTotal: SPEC.sizeBytes,
    bytesDownloaded: 0,
    runWhenReady: true,
    ...over,
  } as unknown as Download;
}

const FAST = { pollMs: 2, settleMs: 60_000 };

function key(call: Call): string {
  return `${call.method} ${call.route}`;
}
function routes(): string[] {
  return calls.map(key);
}

/** The download answers `downloading` once, then `done` with the model. */
function downloadSequence(...states: Download[]): Handler {
  let i = 0;
  return () => ({ status: 200, body: states[Math.min(i++, states.length - 1)] });
}

function fresh(): Map<string, Handler> {
  return new Map<string, Handler>([
    ["POST library/v1/downloads", () => ({ status: 202, body: record() })],
    [
      "GET library/v1/downloads/d1",
      downloadSequence(record(), record({ state: "done", modelId: "m1" } as Partial<Download>)),
    ],
    ["POST library/v1/downloads/d1/claim", () => ({ status: 200, body: { claimed: true } })],
    ["GET library/v1/models/m1", () => ({ status: 200, body: MODEL })],
    ["GET agent/v1/engines", () => ({ status: 200, body: { engines: [LLAMA_INSTALLED] } })],
    ["GET library/v1/models/m1/profiles", () => ({ status: 200, body: { profiles: [] } })],
    ["POST agent/v1/runtimes/admission", () => ({ status: 200, body: ADMIT })],
    ["POST library/v1/models/m1/profiles", () => ({ status: 201, body: PROFILE })],
    ["GET agent/v1/runtimes", () => ({ status: 200, body: { runtimes: [] } })],
    [
      "POST agent/v1/runtimes",
      (call) => ({ status: 201, body: { ...call.body, status: "starting" } }),
    ],
    [
      `GET agent/v1/runtimes/${RUNTIME}`,
      () => ({
        status: 200,
        body: { name: RUNTIME, engine: "llama_cpp", modelPath: MODEL.path, status: "ready" },
      }),
    ],
  ]);
}

async function stepIs(step: RunTask["step"]): Promise<RunTask> {
  await vi.waitFor(() => expect(getRuns()[0]?.step).toBe(step), { timeout: 4000, interval: 2 });
  return getRuns()[0] as RunTask;
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

// --- the chain, in one tab ---------------------------------------------

describe("Download and run", () => {
  it("asks for the download, waits for it, and carries on into the run", async () => {
    startDownloadAndRun(SPEC, HERE, FAST);
    await stepIs("ready");

    expect(routes()).toEqual([
      "POST library/v1/downloads",
      "GET library/v1/downloads/d1",
      "GET library/v1/downloads/d1",
      "POST library/v1/downloads/d1/claim",
      "GET library/v1/models/m1",
      "GET agent/v1/engines",
      "GET library/v1/models/m1/profiles",
      "POST agent/v1/runtimes/admission",
      "POST library/v1/models/m1/profiles",
      "GET agent/v1/runtimes",
      "POST agent/v1/runtimes",
      `GET agent/v1/runtimes/${RUNTIME}`,
    ]);
  });

  it("marks the download so the intent outlives this tab", async () => {
    startDownloadAndRun(SPEC, HERE, FAST);
    await stepIs("ready");
    const post = calls.find((c) => key(c) === "POST library/v1/downloads");
    expect(post?.body).toMatchObject({ runWhenReady: true, files: [SPEC.file] });
  });

  it("claims its own download, so tomorrow's console does not start it again", async () => {
    // The tab that started it cannot lose the claim, but it must still
    // take the flag down: otherwise a console opening after the operator
    // stops this runtime on purpose would launch it a second time.
    startDownloadAndRun(SPEC, HERE, FAST);
    await stepIs("ready");
    expect(routes()).toContain("POST library/v1/downloads/d1/claim");
  });

  it("is one task-tray entry, not two", async () => {
    // §6.3's actual words. While the run is downloading it CLAIMS the
    // tray's own download row, so one thing happening is one line.
    // The transfer never finishes here: the claim only exists WHILE the
    // run is waiting, and at FAST poll speeds a completing download is
    // past that window before `waitFor` can look.
    handlers.set("GET library/v1/downloads/d1", () => ({ status: 200, body: record() }));
    startDownloadAndRun(SPEC, HERE, FAST);
    await vi.waitFor(() => expect(getRuns()[0]?.download?.id).toBe("d1"), { timeout: 4000 });
    const run = runTask(getRuns()[0] as RunTask);
    expect(run.claims?.download).toBe("d1");

    const endpoint = tasksFrom({
      downloads: { downloads: [record()] },
      scan: null,
      runtimes: null,
      localRuntimes: null,
      installs: null,
    });
    expect(endpoint.map((t) => t.id)).toContain("download:d1");
    expect(mergeTasks(endpoint, [run]).map((t) => t.id)).not.toContain("download:d1");
  });

  it("says what it is doing in the person's words while it downloads", async () => {
    handlers.set("GET library/v1/downloads/d1", () => ({
      status: 200,
      body: record({ bytesDownloaded: 1_370_468_944 } as Partial<Download>),
    }));
    startDownloadAndRun(SPEC, HERE, FAST);
    await vi.waitFor(() => expect(getRuns()[0]?.download?.id).toBe("d1"), { timeout: 4000 });
    const task = runTask(getRuns()[0] as RunTask);
    expect(task.title).toContain("Qwen3.5-4B");
    expect(task.detail).toContain("downloading");
    // The bar, and the percentage, from the record rather than invented.
    expect(task.detail).toContain("50%");
    expect(task.progress).toBeCloseTo(0.5, 2);
  });

  it("stops at the download when the download fails, and says which step", async () => {
    handlers.set("GET library/v1/downloads/d1", () => ({
      status: 200,
      body: record({ state: "failed", message: "connection reset" } as Partial<Download>),
    }));
    startDownloadAndRun(SPEC, HERE, FAST);
    const task = await stepIs("failed");
    expect(task.failedStep).toBe("download");
    expect(task.error).toContain("connection reset");
    // Nothing downstream was attempted.
    expect(routes()).not.toContain("GET agent/v1/engines");
  });

  it("does not run a model the library never catalogued", async () => {
    // The file landed and the scan produced no entry. There is nothing
    // to launch, and saying so beats launching a path that has no id.
    handlers.set("GET library/v1/downloads/d1", () => ({
      status: 200,
      body: record({ state: "done" } as Partial<Download>),
    }));
    startDownloadAndRun(SPEC, { ...HERE }, { pollMs: 1, settleMs: 60_000 });
    const task = await stepIs("failed");
    expect(task.failedStep).toBe("download");
    expect(task.error).toContain("catalogued");
  });

  it("is findable by the model id the moment it has one", async () => {
    // Otherwise the Library and Home would both offer Run for a model
    // the task above them is already running.
    startDownloadAndRun(SPEC, HERE, FAST);
    await stepIs("ready");
    expect(findRunFor("m1", "agent")).not.toBeNull();
  });

  it("does not start a second chain for the same file on the same node", async () => {
    const first = startDownloadAndRun(SPEC, HERE, FAST);
    const second = startDownloadAndRun(SPEC, HERE, FAST);
    expect(second).toBe(first);
    expect(getRuns()).toHaveLength(1);
  });
});

// --- picking it up in another tab --------------------------------------

describe("pendingChainedRuns", () => {
  const done = record({ state: "done", modelId: "m1" } as Partial<Download>);

  it("finds a finished download nobody is running", () => {
    expect(pendingChainedRuns([done], [], "agent")).toHaveLength(1);
  });

  it("ignores one that was never meant to be run", () => {
    const plain = record({
      state: "done",
      modelId: "m1",
      runWhenReady: false,
    } as Partial<Download>);
    expect(pendingChainedRuns([plain], [], "agent")).toHaveLength(0);
  });

  it("ignores one that is still downloading", () => {
    expect(pendingChainedRuns([record()], [], "agent")).toHaveLength(0);
  });

  it("ignores one whose model has not been catalogued yet", () => {
    const nameless = record({ state: "done" } as Partial<Download>);
    expect(pendingChainedRuns([nameless], [], "agent")).toHaveLength(0);
  });

  it("ignores one this tab is already running", async () => {
    startDownloadAndRun(SPEC, HERE, FAST);
    await stepIs("ready");
    // `ready` is terminal, so it no longer blocks -- but mid-flight it must.
    const midFlight = [{ ...(getRuns()[0] as RunTask), step: "loading" as const }];
    expect(pendingChainedRuns([done], midFlight, "agent")).toHaveLength(0);
  });

  it("does not confuse one node's run with another's", async () => {
    startDownloadAndRun(SPEC, HERE, FAST);
    await stepIs("ready");
    const midFlight = [{ ...(getRuns()[0] as RunTask), step: "loading" as const }];
    expect(pendingChainedRuns([done], midFlight, "node:node-b")).toHaveLength(1);
  });
});

describe("resumeClaimedRuns", () => {
  const done = record({ state: "done", modelId: "m1" } as Partial<Download>);

  it("claims first, and runs only what it won", async () => {
    const started = await resumeClaimedRuns([done], [], HERE, FAST);
    expect(started).toHaveLength(1);
    expect(routes()[0]).toBe("POST library/v1/downloads/d1/claim");
    await stepIs("ready");
  });

  it("does nothing when another console got there first", async () => {
    // The whole reason the claim exists: two browsers polling the same
    // install both see this record, and only one may launch.
    handlers.set("POST library/v1/downloads/d1/claim", () => ({
      status: 200,
      body: { claimed: false },
    }));
    expect(await resumeClaimedRuns([done], [], HERE, FAST)).toHaveLength(0);
    expect(getRuns()).toHaveLength(0);
    expect(routes()).toEqual(["POST library/v1/downloads/d1/claim"]);
  });

  it("does nothing when the claim itself fails", async () => {
    // A library that did not answer is not permission to launch.
    handlers.set("POST library/v1/downloads/d1/claim", () => ({ status: 503 }));
    expect(await resumeClaimedRuns([done], [], HERE, FAST)).toHaveLength(0);
    expect(getRuns()).toHaveLength(0);
  });

  it("resumes at the run, not at the download", async () => {
    await resumeClaimedRuns([done], [], HERE, FAST);
    await stepIs("ready");
    // No POST to /v1/downloads: the file is already here.
    expect(routes()).not.toContain("POST library/v1/downloads");
    expect(routes()).toContain("GET agent/v1/engines");
  });
});
