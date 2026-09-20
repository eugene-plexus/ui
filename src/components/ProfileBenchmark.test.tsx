import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import type { TargetNode } from "@/lib/nodeBudget";
import { tasksFrom } from "@/lib/tasks";
import type { Benchmark, LibraryModel, ModelProfile } from "@/lib/types";
import { readBenchmarks } from "@/lib/useTasks";

import { ProfileBenchmark, BenchmarkResults } from "./ProfileBenchmark";

afterEach(() => vi.restoreAllMocks());

const model: LibraryModel = {
  id: "m",
  name: "Example",
  path: "/models/m.gguf",
  format: "gguf",
  status: "present",
  sizeBytes: 10,
  files: [],
};
const profile: ModelProfile = {
  id: "p",
  name: "Tuned",
  engine: "llama_cpp",
  default: true,
  flags: { contextSize: 4096, gpuLayers: 99 },
  temperature: 0.7,
};
const node: TargetNode = {
  name: "worker",
  label: "Worker",
  target: "node:worker",
  local: false,
  reachable: true,
  lastError: null,
  budget: null,
};
const job: Benchmark = {
  id: "job",
  node: "worker",
  state: "running",
  progress: 0.5,
  detail: "Depth 1984 tokens · repetition 2/3",
  startedAt: "2026-09-20T00:00:00Z",
  depths: [0, 1984, 3968],
  points: [],
  request: {
    modelId: "m",
    profileId: "p",
    profileName: "Tuned",
    repetitions: 3,
    tokens: 128,
    runtime: {
      name: "m",
      engine: "llama_cpp",
      modelPath: "/models/m.gguf",
      host: "127.0.0.1",
      autoStart: true,
      autoDriver: true,
      startOnDemand: false,
      flags: profile.flags,
    },
  },
};

it("starts on the selected remote node, persists through navigation and cancels there", async () => {
  let jobs: Benchmark[] = [];
  vi.spyOn(api, "get").mockImplementation(async () => ({ benchmarks: jobs }));
  const post = vi.spyOn(api, "post").mockImplementation(async (_target, path) => {
    jobs = [{ ...job, state: path.endsWith("cancel") ? "cancelled" : "running" }];
    return jobs[0];
  });
  const props = { model, profile, node };
  const view = render(<ProfileBenchmark {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Benchmark" }));
  fireEvent.click(await screen.findByRole("button", { name: "Start benchmark" }));
  await screen.findByRole("button", { name: "Cancel benchmark" });
  expect(post).toHaveBeenCalledWith(
    "node:worker",
    "/v1/benchmarks",
    expect.objectContaining({
      modelId: "m",
      profileId: "p",
      tokens: 128,
      repetitions: 3,
      runtime: expect.objectContaining({ flags: profile.flags }),
    }),
  );
  expect((post.mock.calls[0]![2] as { runtime: object }).runtime).not.toHaveProperty("temperature");
  expect(screen.getByRole("progressbar", { name: "Benchmark progress" })).toHaveAttribute(
    "value",
    "0.5",
  );
  view.unmount();
  expect(post).toHaveBeenCalledTimes(1);
  render(<ProfileBenchmark {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Benchmark" }));
  fireEvent.click(await screen.findByRole("button", { name: "Cancel benchmark" }));
  await screen.findByText("cancelled");
  expect(post).toHaveBeenLastCalledWith("node:worker", "/v1/benchmarks/job/cancel", {});
});

it("shows exact measurements and partial results without relabeling historical settings", () => {
  render(
    <BenchmarkResults
      job={{
        ...job,
        state: "failed",
        points: [
          { depth: 0, tokensPerSecond: 100, standardDeviation: 2, samples: [98, 100, 102] },
          { depth: 1984, tokensPerSecond: 40, standardDeviation: 1, samples: [39, 40, 41] },
        ],
      }}
    />,
  );
  expect(screen.getByRole("img", { name: /Decode speed by context depth/ })).toBeVisible();
  const table = screen.getByRole("table", { name: "Partial results" });
  expect(within(table).getByText("40% ".trim())).toBeInTheDocument();
  expect(within(table).getByText("40.0")).toBeInTheDocument();
  expect(within(table).getAllByText("3")).toHaveLength(2);
});

it("keeps agent refusal actionable and prevents invalid sample requests", async () => {
  vi.spyOn(api, "get").mockResolvedValue({ benchmarks: [] });
  const post = vi
    .spyOn(api, "post")
    .mockRejectedValue(new Error("Stop this node's runtimes before benchmarking: qwen"));
  render(<ProfileBenchmark model={model} profile={profile} node={node} />);
  fireEvent.click(screen.getByRole("button", { name: "Benchmark" }));
  fireEvent.change(screen.getByLabelText("Repetitions"), { target: { value: "2.5" } });
  expect(screen.getByRole("button", { name: "Start benchmark" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Repetitions"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Start benchmark" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Stop this node's runtimes");
  expect(post).toHaveBeenCalledTimes(1);
});

it("drops a stale read when the selected node changes", async () => {
  let resolveOld!: (value: unknown) => void;
  vi.spyOn(api, "get").mockImplementation(async (target) =>
    target === "node:worker"
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : { benchmarks: [] },
  );
  const view = render(<ProfileBenchmark model={model} profile={profile} node={node} />);
  fireEvent.click(screen.getByRole("button", { name: "Benchmark" }));
  view.rerender(
    <ProfileBenchmark
      model={model}
      profile={profile}
      node={{ ...node, target: "agent", label: "Local" }}
    />,
  );
  resolveOld({ benchmarks: [job] });
  await waitFor(() => expect(screen.getByText(/No recorded benchmarks/)).toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "Cancel benchmark" })).not.toBeInTheDocument();
});

it("discovers another console's remote work, deduplicates local records and tolerates a down node", async () => {
  vi.spyOn(api, "get").mockImplementation(async (target, path) => {
    if (path === "/v1/nodes") return { nodes: [{ name: "worker" }, { name: "down" }] };
    if (target === "node:down") throw new Error("unreachable");
    return { benchmarks: [job] };
  });
  const benchmarks = await readBenchmarks();
  expect(benchmarks).toHaveLength(1);
  const tasks = tasksFrom({
    benchmarks,
    downloads: null,
    scan: null,
    runtimes: null,
    localRuntimes: null,
    installs: null,
  });
  expect(tasks).toEqual([
    expect.objectContaining({
      kind: "benchmark",
      progress: 0.5,
      href: "/library?model=m&node=worker",
    }),
  ]);
});
