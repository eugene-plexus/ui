/**
 * PB2, driven through the profile page (`ProfileEditor`), not the panel
 * alone: the button has to be on the page, the build has to be read from
 * the node the page is looking at, and Save has to reach the library.
 *
 * `fetch` is stubbed at the boundary the api client uses, keyed by method
 * and route, and a finished build is PB1's REAL Medium run on this box.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import medium from "@/lib/__fixtures__/profile-build-medium.json";
import type { TargetNode } from "@/lib/nodeBudget";
import type { LibraryModel, ModelProfile, ProfileBuild } from "@/lib/types";

import { ProfileEditor } from "./ProfileEditor";

const MODEL: LibraryModel = {
  id: "qwen3-30b-a3b",
  name: "Qwen3-30B-A3B-Instruct-2507-Q4_K_M",
  path: "D:/models/Qwen3-30B-A3B-Instruct-2507-Q4_K_M.gguf",
  format: "gguf",
  status: "present",
  sizeBytes: 18556686752,
  contextLength: 262144,
  files: [],
};

const NODE: TargetNode = {
  name: "Amish_Station",
  label: "Amish_Station",
  local: false,
  target: "node:Amish_Station",
  reachable: true,
  lastError: null,
  budget: null,
};

const ENGINES = [
  { engine: "llama_cpp", available: true, modelFormats: ["gguf"] },
] as unknown as Parameters<typeof ProfileEditor>[0]["engines"];

const BASE: ModelProfile = {
  id: "p1",
  name: "default",
  default: true,
  engine: "llama_cpp",
  flags: { contextSize: 4096, gpuLayers: 99, threads: 8 },
};

const FINISHED = medium as unknown as ProfileBuild;

interface Call {
  method: string;
  route: string;
  body: Record<string, unknown> | undefined;
}
type Handler = (call: Call) => { status: number; body?: unknown };

let calls: Call[];
let handlers: Map<string, Handler>;
let builds: ProfileBuild[];
let profiles: ModelProfile[];

function key(call: Call) {
  return `${call.method} ${call.route}`;
}

beforeEach(() => {
  calls = [];
  builds = [];
  profiles = [BASE];
  sessionStorage.setItem("eugene-session-token", "test-token");
  handlers = new Map<string, Handler>([
    ["GET library/v1/models/qwen3-30b-a3b/profiles", () => ({ status: 200, body: { profiles } })],
    ["GET node:Amish_Station/v1/profile-builds", () => ({ status: 200, body: { builds } })],
    [
      "POST node:Amish_Station/v1/profile-builds/preflight",
      () => ({
        status: 200,
        body: { runningRuntimes: ["gemma-4-12b"], problems: [], estimateSeconds: 420 },
      }),
    ],
    [
      "POST node:Amish_Station/v1/profile-builds",
      (call) => {
        const build = {
          ...FINISHED,
          id: "new-build",
          state: "running",
          phase: "quality",
          progress: 0.1,
          detail: "8-bit cache: chunk 1 of 4",
          startedAt: "2026-09-30T20:00:00Z",
          finishedAt: null,
          accuracy: call.body?.accuracy,
          profileId: call.body?.profileId ?? null,
          restarts: [{ name: "gemma-4-12b", state: "pending" }],
        } as unknown as ProfileBuild;
        builds = [build];
        return { status: 202, body: build };
      },
    ],
    [
      "POST node:Amish_Station/v1/runtimes/admission",
      () => ({ status: 200, body: { decision: "admit", fit: "split", reason: "ok" } }),
    ],
    [
      "POST library/v1/models/qwen3-30b-a3b/profiles",
      (call) => {
        const saved = { ...(call.body as object), id: "p2" } as ModelProfile;
        profiles = [...profiles, saved];
        return { status: 201, body: saved };
      },
    ],
    [
      "PUT library/v1/models/qwen3-30b-a3b/profiles/p1",
      (call) => {
        const saved = { ...(call.body as object), id: "p1" } as ModelProfile;
        profiles = [saved];
        return { status: 200, body: saved };
      },
    ],
  ]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? "GET",
        route: String(input).replace(/^\/api\/proxy\//, ""),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const handler =
        handlers.get(key(call)) ?? handlers.get(key({ ...call, route: call.route.split("?")[0]! }));
      const result = handler ? handler(call) : { status: 404, body: { detail: "unhandled" } };
      return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
        status: result.status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderPage(model: LibraryModel = MODEL) {
  return render(<ProfileEditor model={model} engines={ENGINES} node={NODE} onChanged={() => {}} />);
}

async function openBuilder() {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Build settings for this machine" }));
}

describe("the button on the model's profile page (call 6)", () => {
  it("is there, and reads the builds of the node the page is looking at", async () => {
    await openBuilder();
    await waitFor(() =>
      expect(calls.map(key)).toContain("GET node:Amish_Station/v1/profile-builds"),
    );
    expect(calls.map(key)).not.toContain("GET agent/v1/profile-builds");
  });

  it("is not offered for a model llama.cpp cannot load", async () => {
    renderPage({ ...MODEL, format: "safetensors" });
    expect(
      await screen.findByRole("button", { name: "Build settings for this machine" }),
    ).toBeDisabled();
    expect(
      screen.getByText("The settings builder works with GGUF models on llama.cpp."),
    ).toBeVisible();
  });
});

describe("starting a build", () => {
  it("starts at Max, asks before stopping, and stops exactly what it named", async () => {
    await openBuilder();
    expect(await screen.findByTestId("accuracy-promise")).toHaveTextContent(
      "Answers exactly as this file allows.",
    );
    expect(await screen.findByTestId("stop-question")).toHaveTextContent(
      "Stop gemma-4-12b while this runs? It starts again when it finishes. Apps using it get an error until then.",
    );
    expect(screen.getByTestId("measurement-estimate")).toHaveTextContent("About 7 minutes.");
    fireEvent.click(screen.getByLabelText("Medium"));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.route.endsWith("/profile-builds/preflight") && c.body?.accuracy === "medium",
        ),
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop it and start the build" }));
    await waitFor(() =>
      expect(calls.map(key)).toContain("POST node:Amish_Station/v1/profile-builds"),
    );
    const started = calls.find((c) => key(c) === "POST node:Amish_Station/v1/profile-builds")!;
    expect(started.body).toMatchObject({
      modelId: "qwen3-30b-a3b",
      profileId: "p1",
      accuracy: "medium",
      stopRuntimes: ["gemma-4-12b"],
      restartAfter: true,
      evaluationText: null,
      memoryMarginMiB: null,
      runtime: { engine: "llama_cpp", modelPath: MODEL.path, flags: BASE.flags },
    });
    // And the page shows it running, with its stopped model named.
    expect(await screen.findByTestId("build-progress")).toHaveTextContent(
      "Measuring how each setting changes answers",
    );
    expect(screen.getByTestId("build-progress")).toHaveTextContent(
      "gemma-4-12b is stopped while this runs.",
    );
  });

  it("asks again when a model started between the question and the click", async () => {
    let running = ["gemma-4-12b"];
    handlers.set("POST node:Amish_Station/v1/profile-builds/preflight", () => ({
      status: 200,
      body: { runningRuntimes: running, problems: [] },
    }));
    handlers.set("POST node:Amish_Station/v1/profile-builds", () => {
      running = ["gemma-4-12b", "late-starter"];
      return { status: 409, body: { detail: { title: "late-starter is running" } } };
    });
    await openBuilder();
    fireEvent.click(await screen.findByRole("button", { name: "Stop it and start the build" }));
    await waitFor(() =>
      expect(screen.getByTestId("stop-question")).toHaveTextContent(
        "Stop gemma-4-12b and late-starter while this runs?",
      ),
    );
  });

  it("does not offer Start while the node says it would refuse", async () => {
    handlers.set("POST node:Amish_Station/v1/profile-builds/preflight", () => ({
      status: 200,
      body: {
        runningRuntimes: [],
        problems: ["llama-fit-params is missing beside llama-server b11215."],
      },
    }));
    await openBuilder();
    expect(
      await screen.findByText("llama-fit-params is missing beside llama-server b11215."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Start the build" })).toBeDisabled();
  });

  it("sends the memory margin and the person's own text", async () => {
    await openBuilder();
    fireEvent.click(await screen.findByLabelText("High"));
    fireEvent.click(screen.getByText("More options"));
    fireEvent.change(screen.getByLabelText("Leave this much graphics memory free (MiB)"), {
      target: { value: "4096" },
    });
    fireEvent.change(screen.getByLabelText("Your own text to measure answers on"), {
      target: { value: "Some text of my own." },
    });
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.route.endsWith("/preflight") &&
            c.body?.memoryMarginMiB === 4096 &&
            c.body?.evaluationText === "Some text of my own.",
        ),
      ).toBe(true),
    );
  });

  it("does not ask the node again when the page hands it the same model anew", async () => {
    const view = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Build settings for this machine" }));
    await screen.findByTestId("stop-question");
    const asked = calls.filter((c) => c.route.endsWith("/preflight")).length;
    view.rerender(
      <ProfileEditor model={{ ...MODEL }} engines={ENGINES} node={NODE} onChanged={() => {}} />,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(calls.filter((c) => c.route.endsWith("/preflight")).length).toBe(asked);
  });
});

describe("a build in flight", () => {
  it("is found again on the node and can be cancelled there", async () => {
    builds = [{ ...FINISHED, state: "running", phase: "measuring", progress: 0.6, restarts: [] }];
    handlers.set(`POST node:Amish_Station/v1/profile-builds/${FINISHED.id}/cancel`, () => ({
      status: 200,
      body: { ...FINISHED, state: "cancelled" },
    }));
    await openBuilder();
    expect(await screen.findByTestId("build-progress")).toHaveTextContent("Measuring speed");
    fireEvent.click(screen.getByRole("button", { name: "Cancel the build" }));
    await waitFor(() =>
      expect(calls.map(key)).toContain(
        `POST node:Amish_Station/v1/profile-builds/${FINISHED.id}/cancel`,
      ),
    );
  });
});

describe("a finished build", () => {
  beforeEach(() => {
    builds = [{ ...FINISHED, profileId: "p1" }];
  });

  it("puts the slider on the suggestion and says what it gives", async () => {
    await openBuilder();
    const stop = await screen.findByTestId("build-stop");
    expect(stop).toHaveTextContent("40 tok/s · 65,536 tokens of context · suggested");
    expect(stop).toHaveTextContent(
      "Picks the same next token as Max 96 times in 100, on this model.",
    );
    fireEvent.change(screen.getByTestId("build-slider"), { target: { value: "0" } });
    expect(screen.getByTestId("build-stop")).toHaveTextContent("8,192 tokens of context");
    expect(screen.getByTestId("build-stop")).not.toHaveTextContent("suggested");
    expect(screen.getByTestId("build-stop")).toHaveTextContent(
      "Answers exactly as this file allows.",
    );
  });

  it("saves the choice as a new profile, with its record", async () => {
    await openBuilder();
    fireEvent.click(await screen.findByTestId("build-save"));
    await waitFor(() =>
      expect(calls.map(key)).toContain("POST library/v1/models/qwen3-30b-a3b/profiles"),
    );
    const saved = calls.find((c) => key(c) === "POST library/v1/models/qwen3-30b-a3b/profiles")!;
    expect(saved.body).toMatchObject({
      name: "Built for Amish_Station",
      engine: "llama_cpp",
      default: false,
      flags: {
        threads: 8,
        contextSize: 65536,
        cacheType: "q8_0",
        flashAttention: "on",
        memoryMargin: 23499,
      },
      builtBy: { buildId: FINISHED.id, node: "Amish_Station", accuracy: "medium" },
    });
    expect((saved.body as { flags: object }).flags).not.toHaveProperty("gpuLayers");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Saved as Built for Amish_Station.",
    );
    // The page re-read its profiles, and the new one says it was built.
    const row = await screen.findByTestId("profile-measured");
    expect(row).toHaveTextContent("Measured on Amish_Station: 40 tok/s");
  });

  it("replaces the profile it started from only after asking", async () => {
    await openBuilder();
    const result = await screen.findByTestId("build-result");
    fireEvent.click(within(result).getByRole("button", { name: "Replace default" }));
    expect(calls.map(key)).not.toContain("PUT library/v1/models/qwen3-30b-a3b/profiles/p1");
    const confirm = await within(result).findByRole("button", { name: /replace|confirm|yes/i });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(calls.map(key)).toContain("PUT library/v1/models/qwen3-30b-a3b/profiles/p1"),
    );
    const put = calls.find((c) => key(c) === "PUT library/v1/models/qwen3-30b-a3b/profiles/p1")!;
    expect(put.body).toMatchObject({ name: "default", default: true });
  });

  it("offers a new build", async () => {
    await openBuilder();
    fireEvent.click(await screen.findByRole("button", { name: "Build again" }));
    expect(await screen.findByTestId("build-choice")).toBeVisible();
  });
});

describe("a built profile on the page (settings never lie)", () => {
  const built: ModelProfile = {
    id: "p2",
    name: "Built for Amish_Station",
    default: false,
    engine: "llama_cpp",
    flags: { contextSize: 65536, cacheType: "q8_0", flashAttention: true },
    builtBy: {
      buildId: "b",
      node: "Amish_Station",
      accuracy: "medium",
      builtAt: "2026-09-30T16:33:13Z",
      flags: { contextSize: 65536, cacheType: "q8_0", flashAttention: true },
      deepDecodeTokensPerSecond: 39.85,
      sameTopTokenPercent: 96.32,
    },
  };

  it("names it built, and its measured numbers", async () => {
    profiles = [BASE, built];
    renderPage();
    expect(await screen.findByText("built")).toBeVisible();
    expect(screen.getByTestId("profile-measured")).toHaveAttribute("data-edited", "false");
  });

  it("labels the numbers, not deletes them, once a builder field was edited", async () => {
    profiles = [BASE, { ...built, flags: { ...built.flags, contextSize: 16384 } }];
    renderPage();
    expect(await screen.findByText("built, edited since")).toBeVisible();
    expect(screen.getByTestId("profile-measured")).toHaveTextContent(
      "before this profile was edited",
    );
  });
});

describe("the tray", () => {
  it("shows a build running on any node, found from any console", async () => {
    vi.unstubAllGlobals();
    const running = {
      ...FINISHED,
      state: "running",
      phase: "measuring",
      progress: 0.4,
      detail: "Candidate 3 of 14",
    } as unknown as ProfileBuild;
    const { api } = await import("@/lib/api");
    const { readProfileBuilds } = await import("@/lib/useTasks");
    const { tasksFrom } = await import("@/lib/tasks");
    const get = vi.spyOn(api, "get").mockImplementation(async (target, path) => {
      if (path === "/v1/nodes") return { nodes: [{ name: "Amish_Station" }, { name: "down" }] };
      if (target === "node:down") throw new Error("unreachable");
      // Only the other node has it: a tray that read this machine alone
      // would show nothing.
      if (target === "agent") return { builds: [] };
      return { builds: [running] };
    });
    const found = await readProfileBuilds();
    expect(found).toHaveLength(1);
    const tasks = tasksFrom({
      builds: found,
      downloads: null,
      scan: null,
      runtimes: null,
      localRuntimes: null,
      installs: null,
    });
    expect(tasks).toEqual([
      expect.objectContaining({
        kind: "build",
        title: `Building settings for ${running.runtime.name} on Amish_Station`,
        detail: "Measuring speed · Candidate 3 of 14",
        progress: 0.4,
        href: "/library?model=qwen3-30b-a3b&node=Amish_Station",
      }),
    ]);
    // A finished build is not background work.
    expect(
      tasksFrom({
        builds: [FINISHED],
        downloads: null,
        scan: null,
        runtimes: null,
        localRuntimes: null,
        installs: null,
      }),
    ).toEqual([]);
    get.mockRestore();
  });
});

/**
 * A3d: after a build at Low, a smaller file of the same model, when the
 * one on disk does not fit entirely at the chosen context. Driven through
 * the page, with the model's own download record naming its repository.
 */
describe("Low's smaller file", () => {
  const GB = 1e9;
  const GIB = 1024 ** 3;
  const LOW = { ...FINISHED, accuracy: "low", profileId: "p1" } as unknown as ProfileBuild;
  const REPO = "unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF";
  const candidates = [
    { label: "Q4_K_M", sizeBytes: 18.56 * GB, verdict: "split" },
    { label: "UD-Q3_K_XL", sizeBytes: 13.8 * GB, verdict: "fits" },
    { label: "Q2_K", sizeBytes: 11.3 * GB, verdict: "fits" },
  ].map((c) => ({
    label: c.label,
    format: "gguf",
    files: [{ path: `${c.label}.gguf`, sizeBytes: c.sizeBytes }],
    sizeBytes: c.sizeBytes,
    fit: { verdict: c.verdict, contextLength: 65536 },
  }));

  beforeEach(() => {
    builds = [LOW];
    // The file on disk's own fit at the chosen stop (64k, 8-bit cache) with
    // 18 GiB free: 3.2 GiB of cache and 1 GiB of overhead leave 13.8 GiB
    // (14.8 GB) for weights, so UD-Q3_K_XL (13.8 GB) is the largest that
    // fits and Q4_K_M, the file on disk, is not smaller.
    handlers.set("GET library/v1/models/qwen3-30b-a3b/fit", () => ({
      status: 200,
      body: {
        fit: {
          verdict: "split",
          contextLength: 65536,
          kvCacheBytes: 3.2 * GIB,
          overheadBytes: GIB,
          budget: { vramFreeBytes: 18 * GIB },
        },
      },
    }));
    handlers.set("GET library/v1/downloads", () => ({
      status: 200,
      body: {
        downloads: [
          { id: "d1", state: "done", repo: REPO, revision: "main", modelId: MODEL.id, files: [] },
        ],
      },
    }));
    handlers.set("GET library/v1/catalogue/model", () => ({
      status: 200,
      body: { repo: REPO, candidates },
    }));
  });

  it("offers the largest smaller file that fits, at the chosen context, and downloads it", async () => {
    handlers.set("POST library/v1/downloads", (call) => ({
      status: 201,
      body: {
        id: "d2",
        state: "downloading",
        repo: REPO,
        files: call.body?.files,
        bytesTotal: 100,
        bytesDownloaded: 40,
      },
    }));
    handlers.set("GET library/v1/downloads/d2", () => ({
      status: 200,
      body: { id: "d2", state: "done", repo: REPO, files: [], modelId: "smaller-model" },
    }));
    await openBuilder();
    const offer = await screen.findByTestId("smaller-file", {}, { timeout: 3000 });
    expect(offer).toHaveAttribute("data-state", "offer");
    expect(offer).toHaveTextContent(
      "A smaller version, UD-Q3_K_XL (13.8 GB), fits entirely on the card at 64k.",
    );
    expect(offer).toHaveTextContent("does not measure how much");
    // The file's own fit, at the chosen context and cache type; then only
    // the repository its download names, for the sizes.
    const fit = calls.find((c) => c.route.startsWith("library/v1/models/qwen3-30b-a3b/fit?"))!;
    expect(fit.route).toContain("contextLength=65536");
    expect(fit.route).toContain("kvCacheType=q8_0");
    const catalogue = calls.find((c) => c.route.startsWith("library/v1/catalogue/model?"))!;
    expect(catalogue.route).toContain(`repo=${encodeURIComponent(REPO)}`);
    fireEvent.click(screen.getByTestId("smaller-file-download"));
    await waitFor(() => expect(calls.map(key)).toContain("POST library/v1/downloads"));
    const posted = calls.find((c) => key(c) === "POST library/v1/downloads")!;
    expect(posted.body).toEqual({ repo: REPO, revision: "main", files: ["UD-Q3_K_XL.gguf"] });
    expect(
      within(screen.getByTestId("smaller-file-progress")).getByRole("progressbar"),
    ).toHaveAttribute("aria-valuenow", "40");
    // Never rebuilt for the person: once it lands, a link to build it.
    const build = await screen.findByTestId("smaller-file-build", {}, { timeout: 5000 });
    expect(build).toHaveAttribute("href", "/library?model=smaller-model");
    expect(
      calls.filter((c) => key(c) === "POST node:Amish_Station/v1/profile-builds"),
    ).toHaveLength(0);
  });

  it("offers nothing when the file on disk already fits", async () => {
    handlers.set("GET library/v1/models/qwen3-30b-a3b/fit", () => ({
      status: 200,
      body: { fit: { verdict: "fits", contextLength: 65536 } },
    }));
    await openBuilder();
    await screen.findByTestId("build-stop");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    expect(screen.queryByTestId("smaller-file")).toBeNull();
    expect(calls.some((c) => c.route.startsWith("library/v1/catalogue/model"))).toBe(false);
  });

  it("does not guess a repository for a file copied in by hand", async () => {
    handlers.set("GET library/v1/downloads", () => ({ status: 200, body: { downloads: [] } }));
    await openBuilder();
    const offer = await screen.findByTestId("smaller-file", {}, { timeout: 3000 });
    expect(offer).toHaveAttribute("data-state", "unknown-origin");
    expect(offer).toHaveTextContent("This file was not downloaded here");
    expect(calls.some((c) => c.route.startsWith("library/v1/catalogue/model"))).toBe(false);
  });

  it("links to a smaller file that is already on disk instead of downloading it", async () => {
    handlers.set("GET library/v1/catalogue/model", () => ({
      status: 200,
      body: {
        repo: REPO,
        candidates: candidates.map((c) =>
          c.label === "UD-Q3_K_XL"
            ? {
                ...c,
                alreadyOwned: {
                  modelId: "owned-q3",
                  path: "D:/models/q3.gguf",
                  matchedOn: "name_and_size",
                },
              }
            : c,
        ),
      },
    }));
    await openBuilder();
    const owned = await screen.findByTestId("smaller-file-owned", {}, { timeout: 3000 });
    expect(owned).toHaveAttribute("href", "/library?model=owned-q3");
    expect(screen.queryByTestId("smaller-file-download")).toBeNull();
  });

  it("is only Low's: a Medium build offers no smaller file", async () => {
    builds = [{ ...LOW, accuracy: "medium" } as ProfileBuild];
    await openBuilder();
    await screen.findByTestId("build-stop");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    expect(screen.queryByTestId("smaller-file")).toBeNull();
  });
});
