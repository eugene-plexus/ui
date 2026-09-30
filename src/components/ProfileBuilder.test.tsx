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
    expect(stop).toHaveTextContent("About 30 words a second · holds about 101 pages · suggested");
    expect(stop).toHaveTextContent(
      "Picks the same next word as Max 96 times in 100, on this model.",
    );
    fireEvent.change(screen.getByTestId("build-slider"), { target: { value: "0" } });
    expect(screen.getByTestId("build-stop")).toHaveTextContent("holds about 13 pages");
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
        flashAttention: true,
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
    expect(row).toHaveTextContent("Measured on Amish_Station: about 30 words a second");
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
