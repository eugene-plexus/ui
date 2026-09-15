/**
 * The tasks tray's list, from the bodies the components return.
 *
 * The download record is the shape `DownloadsPanel` renders and the live
 * library produces; the runtimes are the shapes `inferenceRows.test.ts`
 * took from the two-machine install; the install is the agent contract's
 * `EngineInstall`. The words asserted are the person's, not ours.
 */

import { describe, expect, it } from "vitest";

import {
  basename,
  formatBytesShort,
  formatDuration,
  mergeTasks,
  tasksFrom,
  type Task,
  type TaskSources,
} from "./tasks";
import type { Download } from "./types";

const NOTHING: TaskSources = {
  downloads: null,
  scan: null,
  runtimes: null,
  localRuntimes: null,
  installs: null,
};

const DOWNLOADING: Download = {
  id: "dl-1",
  state: "downloading",
  repo: "unsloth/Qwen3-14B-GGUF",
  revision: "main",
  destinationDirectory: "D:\\models\\unsloth\\Qwen3-14B-GGUF",
  files: [
    {
      path: "Qwen3-14B-UD-Q6_K_XL.gguf",
      destinationPath: "D:\\models\\unsloth\\Qwen3-14B-GGUF\\Qwen3-14B-UD-Q6_K_XL.gguf",
      sizeBytes: 12_300_000_000,
      bytesDownloaded: 5_166_000_000,
      state: "downloading",
    },
  ],
  bytesTotal: 12_300_000_000,
  bytesDownloaded: 5_166_000_000,
  bytesPerSecond: 38_000_000,
  etaSeconds: 188,
  attempts: 1,
};

describe("tasksFrom with nothing answering", () => {
  it("is an empty list, not an error", () => {
    expect(tasksFrom(NOTHING)).toEqual([]);
  });

  it("is empty when every source answered and nothing is happening", () => {
    expect(
      tasksFrom({
        downloads: { downloads: [] },
        scan: { state: "done" },
        runtimes: { runtimes: [], unreachableNodes: [] },
        localRuntimes: null,
        installs: [{ engine: "llama_cpp", state: "done", version: "b10948" }],
      }),
    ).toEqual([]);
  });
});

describe("downloads", () => {
  it("names the repo and the file, and says how far along in the person's units", () => {
    const [task] = tasksFrom({ ...NOTHING, downloads: { downloads: [DOWNLOADING] } });
    expect(task?.kind).toBe("download");
    expect(task?.title).toBe("Downloading unsloth/Qwen3-14B-GGUF Qwen3-14B-UD-Q6_K_XL.gguf");
    expect(task?.detail).toBe("42% · 38 MB/s · 3 min left");
    expect(task?.progress).toBeCloseTo(0.42, 2);
    expect(task?.href).toBe("/discover");
  });

  it("keeps a paused download in the list, marked paused, with no rate", () => {
    const [task] = tasksFrom({
      ...NOTHING,
      downloads: { downloads: [{ ...DOWNLOADING, state: "paused", bytesPerSecond: 0 }] },
    });
    expect(task?.detail).toBe("paused · 42%");
    expect(task?.progress).toBeCloseTo(0.42, 2);
  });

  it("has no progress before the total is known", () => {
    const [task] = tasksFrom({
      ...NOTHING,
      downloads: {
        downloads: [
          { ...DOWNLOADING, state: "resolving", bytesTotal: undefined, bytesDownloaded: 0 },
        ],
      },
    });
    expect(task?.progress).toBeUndefined();
    expect(task?.detail).toBe("asking where the file is");
  });

  it("drops finished, failed and cancelled downloads", () => {
    const tasks = tasksFrom({
      ...NOTHING,
      downloads: {
        downloads: [
          { ...DOWNLOADING, id: "a", state: "done" },
          { ...DOWNLOADING, id: "b", state: "failed" },
          { ...DOWNLOADING, id: "c", state: "cancelled" },
          { ...DOWNLOADING, id: "d", state: "queued" },
        ],
      },
    });
    expect(tasks.map((t) => t.id)).toEqual(["download:d"]);
    expect(tasks[0]?.detail).toBe("waiting its turn");
  });

  it("says how many files a sharded download has rather than naming one", () => {
    const [task] = tasksFrom({
      ...NOTHING,
      downloads: {
        downloads: [
          {
            ...DOWNLOADING,
            files: [
              { ...DOWNLOADING.files[0]!, path: "a-00001-of-00002.gguf" },
              { ...DOWNLOADING.files[0]!, path: "a-00002-of-00002.gguf" },
            ],
          },
        ],
      },
    });
    expect(task?.title).toBe("Downloading unsloth/Qwen3-14B-GGUF (2 files)");
  });
});

describe("engine installs", () => {
  it("shows a download in flight with its share of the total", () => {
    const [task] = tasksFrom({
      ...NOTHING,
      installs: [
        {
          engine: "llama_cpp",
          state: "downloading",
          version: "b10948",
          bytesTotal: 400_000_000,
          bytesDownloaded: 100_000_000,
        },
      ],
    });
    expect(task?.kind).toBe("install");
    expect(task?.title).toBe("Installing llama.cpp b10948");
    expect(task?.detail).toBe("25% of 400 MB");
    expect(task?.progress).toBeCloseTo(0.25, 2);
    expect(task?.href).toBe("/inference");
  });

  it("has no bar while unpacking, when bytes would read as 100% and stuck", () => {
    const [task] = tasksFrom({
      ...NOTHING,
      installs: [
        {
          engine: "llama_cpp",
          state: "extracting",
          bytesTotal: 400_000_000,
          bytesDownloaded: 400_000_000,
        },
      ],
    });
    expect(task?.progress).toBeUndefined();
    expect(task?.detail).toBe("unpacking");
  });

  it("ignores installs that have ended", () => {
    expect(
      tasksFrom({
        ...NOTHING,
        installs: [
          { engine: "llama_cpp", state: "failed", error: "x" },
          { engine: "vllm", state: "cancelled" },
        ],
      }),
    ).toEqual([]);
  });
});

describe("model loads", () => {
  it("names the model and the machine from the control root's list", () => {
    const tasks = tasksFrom({
      ...NOTHING,
      runtimes: {
        runtimes: [
          {
            node: "Amish_Station",
            name: "qwen3-27b",
            modelAlias: "qwen3-27b",
            status: "loading",
            engine: "llama_cpp",
          },
          { node: "Amish_Station", name: "ready-one", modelAlias: "small", status: "ready" },
          { node: "nas", name: "stopped-one", modelAlias: "old", status: "stopped" },
        ],
        unreachableNodes: [],
      },
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.kind).toBe("load");
    expect(tasks[0]?.title).toBe("Loading qwen3-27b on Amish_Station");
    expect(tasks[0]?.detail).toBe("reading the model into memory");
    expect(tasks[0]?.progress).toBeUndefined();
  });

  it("falls back to this agent's own list, and calls the machine this one", () => {
    const tasks = tasksFrom({
      ...NOTHING,
      localRuntimes: {
        runtimes: [
          {
            name: "llama-1",
            engine: "llama_cpp",
            modelPath: "/models/q.gguf",
            modelAlias: "q",
            status: "starting",
          },
        ],
      },
    });
    expect(tasks[0]?.title).toBe("Loading q on this machine");
    expect(tasks[0]?.detail).toBe("starting the engine");
  });

  it("prefers the root's list when both are present, so a load is not listed twice", () => {
    const tasks = tasksFrom({
      ...NOTHING,
      runtimes: {
        runtimes: [{ node: "a", name: "r", modelAlias: "m", status: "loading" }],
        unreachableNodes: [],
      },
      localRuntimes: {
        runtimes: [
          { name: "r", engine: "llama_cpp", modelPath: "/m", modelAlias: "m", status: "loading" },
        ],
      },
    });
    expect(tasks).toHaveLength(1);
  });
});

describe("the library scan", () => {
  it("is one task while scanning, with the count so far", () => {
    const [task] = tasksFrom({
      ...NOTHING,
      scan: { state: "scanning", filesScanned: 1240, currentPath: "/models/unsloth/x.gguf" },
    });
    expect(task?.kind).toBe("scan");
    expect(task?.title).toBe("Scanning your model folders");
    expect(task?.detail).toBe("1,240 files so far · x.gguf");
    expect(task?.href).toBe("/library");
  });

  it("is nothing once the scan has finished", () => {
    expect(tasksFrom({ ...NOTHING, scan: { state: "done", modelsFound: 3 } })).toEqual([]);
  });
});

describe("ordering", () => {
  it("lists downloads, then installs, then loads, then the scan, stably", () => {
    const tasks = tasksFrom({
      downloads: { downloads: [DOWNLOADING] },
      scan: { state: "scanning" },
      runtimes: {
        runtimes: [{ node: "a", name: "r", modelAlias: "m", status: "loading" }],
        unreachableNodes: [],
      },
      localRuntimes: null,
      installs: [{ engine: "llama_cpp", state: "resolving" }],
    });
    expect(tasks.map((t) => t.kind)).toEqual(["download", "install", "load", "scan"]);
  });
});

describe("the words", () => {
  it("never uses the architecture's nouns in a title or detail", () => {
    const tasks = tasksFrom({
      downloads: { downloads: [DOWNLOADING, { ...DOWNLOADING, id: "p", state: "paused" }] },
      scan: { state: "scanning", filesScanned: 1 },
      runtimes: {
        runtimes: [
          { node: "a", name: "r1", modelAlias: "m1", status: "loading" },
          { node: "a", name: "r2", modelAlias: "m2", status: "starting" },
        ],
        unreachableNodes: [],
      },
      localRuntimes: null,
      installs: [
        { engine: "llama_cpp", state: "resolving" },
        { engine: "vllm", state: "extracting" },
      ],
    });
    const text = tasks.map((t) => `${t.title} ${t.detail}`).join(" ");
    for (const banned of [
      "runtime",
      "companion driver",
      "declaration",
      "admission",
      "mint",
      "epoch",
      "advertiseUrl",
      "trust root",
      "topology",
      "routing table",
      "control plane",
    ]) {
      expect(text.toLowerCase(), `tray text contains "${banned}"`).not.toContain(banned);
    }
  });
});

describe("formatting", () => {
  it("takes the last segment of a path however it is spelled", () => {
    expect(basename("D:\\models\\a\\b.gguf")).toBe("b.gguf");
    expect(basename("/models/a/b.gguf")).toBe("b.gguf");
    expect(basename("b.gguf")).toBe("b.gguf");
    expect(basename("/models/a/")).toBe("a");
  });

  it("formats bytes in decimal units the way a download speed is quoted", () => {
    expect(formatBytesShort(38_000_000)).toBe("38 MB");
    expect(formatBytesShort(1_234_000_000)).toBe("1.2 GB");
    expect(formatBytesShort(512)).toBe("512 B");
    expect(formatBytesShort(0)).toBe("0 B");
  });

  it("formats an estimate the way a person reads one", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(240)).toBe("4 min");
    expect(formatDuration(4800)).toBe("1 h 20 min");
    expect(formatDuration(7200)).toBe("2 h");
  });
});

describe("mergeTasks", () => {
  const install: Task = {
    id: "install:llama_cpp",
    kind: "install",
    title: "Installing llama.cpp b10948",
    detail: "50% of 500 MB",
    progress: 0.5,
    href: "/inference",
  };
  const load: Task = {
    id: "load:Amish_Station/qwen3-14b",
    kind: "load",
    title: "Loading qwen3-14b on Amish_Station",
    detail: "reading the model into memory",
    href: "/inference",
  };
  const otherLoad: Task = { ...load, id: "load:node-b/gemma", title: "Loading gemma on node-b" };
  const run = (claims: Task["claims"]): Task => ({
    id: "run:m1@agent",
    kind: "run",
    title: "Run Qwen3-14B on this machine",
    detail: "installing llama.cpp",
    href: "/inference",
    claims,
  });

  it("puts the browser's own runs first and keeps every endpoint task it does not claim", () => {
    expect(mergeTasks([install, load], [run({})]).map((t) => t.id)).toEqual([
      "run:m1@agent",
      "install:llama_cpp",
      "load:Amish_Station/qwen3-14b",
    ]);
  });

  it("drops the tray's own install row while a run installs that engine", () => {
    expect(mergeTasks([install, load], [run({ engine: "llama_cpp" })]).map((t) => t.id)).toEqual([
      "run:m1@agent",
      "load:Amish_Station/qwen3-14b",
    ]);
  });

  it("drops the tray's own load row for the runtime a run is starting, whichever node it is on", () => {
    expect(
      mergeTasks([install, load, otherLoad], [run({ runtime: "qwen3-14b" })]).map((t) => t.id),
    ).toEqual(["run:m1@agent", "install:llama_cpp", "load:node-b/gemma"]);
  });

  it("is the endpoint list when there are no runs", () => {
    expect(mergeTasks([install, load], [])).toEqual([install, load]);
  });
});
