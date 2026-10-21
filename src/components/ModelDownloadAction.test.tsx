import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelDownloadAction } from "./ModelDownloadAction";
import { useDownloads } from "./DownloadsPanel";
import { api } from "@/lib/api";
import { rememberDownloadTarget } from "@/lib/downloadHandoff";
import type { TargetNode } from "@/lib/nodeBudget";
import { refreshRuns, resetRunsForTests, type RunOperation } from "@/lib/oneClickRun";
import type { Download } from "@/lib/types";
import { setSessionToken } from "@/lib/session";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
const PC: TargetNode = {
  name: "PC",
  label: "PC",
  target: "agent",
  local: true,
  reachable: true,
  lastError: null,
  budget: null,
};
const NAS: TargetNode = { ...PC, name: "NAS", label: "NAS", target: "node:NAS", local: false };
const NODES = [PC, NAS];
const SPEC = {
  repo: "org/model",
  file: "model.gguf",
  files: ["model.gguf", "vision.gguf"],
  source: "hub",
  revision: "pinned-commit",
  label: "Model",
};
const MODEL = {
  id: "library-id",
  name: "Model",
  path: "/models/model.gguf",
  format: "gguf",
  status: "present",
  contextLength: null,
};
const DOWNLOAD = {
  id: "download-id",
  repo: SPEC.repo,
  source: "hub",
  state: "done",
  modelId: MODEL.id,
  files: [{ path: SPEC.file, destinationPath: MODEL.path }],
  bytesTotal: 100,
  bytesDownloaded: 100,
} as Download;
let operations: RunOperation[];
let runtimeExtra: Record<string, unknown>;
beforeEach(() => {
  setSessionToken("session");
  resetRunsForTests();
  localStorage.clear();
  operations = [];
  runtimeExtra = {};
  vi.clearAllMocks();
  vi.mocked(api.get).mockImplementation(async (_target, path) => {
    if (path === "/v1/node") return { name: "PC" };
    if (path === "/v1/nodes") return { nodes: [{ name: "NAS" }] };
    if (path === "/v1/run-operations") return { operations: structuredClone(operations) };
    if (path === "/v1/engines")
      return { engines: [{ engine: "llama_cpp", available: true, accepts: [] }] };
    if (path === "/v1/models/library-id") return MODEL;
    if (path === "/v1/apps")
      return {
        apps: [{ id: "workbench", enabled: true, ui: true, uiUrl: "https://workbench.example/" }],
      };
    if (path.startsWith("/v1/runtimes/"))
      return { name: "runtime", status: "ready", modelAlias: "served-model", ...runtimeExtra };
    throw new Error(`Unexpected GET ${path}`);
  });
  vi.mocked(api.post).mockResolvedValue({ models: [] });
  vi.mocked(api.put).mockImplementation(async (_target, path, intent) => {
    const body = intent as RunOperation["intent"];
    const op: RunOperation = {
      id: path.split("/").pop()!,
      node: body.node,
      intent: body,
      step: "ready",
      model: MODEL,
      runtime: "runtime",
      runtimeStatus: "ready",
      engine: "llama_cpp",
      download: body.download ? DOWNLOAD : null,
      install: null,
      error: null,
      failedStep: null,
      startedAt: Date.now(),
      finishedAt: Date.now(),
    };
    operations.push(op);
    return op;
  });
});
afterEach(() => {
  cleanup();
  resetRunsForTests();
});

function show(downloads: Download[] = [], node = NAS, onDownload = vi.fn()) {
  return render(
    <ModelDownloadAction
      spec={SPEC}
      downloads={downloads}
      node={node}
      nodes={NODES}
      busy={false}
      downloadLabel="Download 100 MB"
      onDownload={onDownload}
      onChanged={() => {}}
    />,
  );
}

it("launches a finished download on its remembered NAS, then opens the served model in Workbench", async () => {
  rememberDownloadTarget(DOWNLOAD.id, NAS);
  show([DOWNLOAD], PC);
  fireEvent.click(await screen.findByRole("button", { name: "Run on NAS" }));
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith("library", expect.any(String), {
      node: "NAS",
      modelId: "library-id",
    }),
  );
  expect(await screen.findByRole("link", { name: "Open in Workbench" })).toHaveAttribute(
    "href",
    "https://workbench.example/?model=served-model",
  );
  expect(screen.getByRole("link", { name: "Open in the Library" })).toHaveAttribute(
    "href",
    "/library?model=library-id&node=NAS",
  );
});

it("preserves all files, source, revision and machine for Download and run, including after refresh", async () => {
  const view = show();
  fireEvent.click(screen.getByRole("button", { name: "Download and run on NAS" }));
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith("library", expect.any(String), {
      node: "NAS",
      download: { repo: SPEC.repo, files: SPEC.files, source: "hub", revision: "pinned-commit" },
    }),
  );
  expect(await screen.findByRole("link", { name: "Open in Workbench" })).toBeVisible();
  view.unmount();
  resetRunsForTests();
  operations[0]!.finishedAt = Date.now() - 120_000;
  show([], PC);
  expect(await screen.findByRole("link", { name: "Open in Workbench" })).toHaveAttribute(
    "href",
    "https://workbench.example/?model=served-model",
  );
  expect(screen.getByText("Run on NAS")).toBeVisible();
  expect(api.put).toHaveBeenCalledTimes(1);
});

it("download-only does not submit a run", () => {
  const download = vi.fn();
  show([], NAS, download);
  fireEvent.click(screen.getByRole("button", { name: "Download only 100 MB" }));
  expect(download).toHaveBeenCalledOnce();
  expect(api.put).not.toHaveBeenCalled();
});

it("does not silently move an unavailable saved destination to this PC", async () => {
  rememberDownloadTarget(DOWNLOAD.id, { ...NAS, name: "missing-NAS", label: "missing-NAS" });
  show([DOWNLOAD], PC);
  expect(await screen.findByRole("button", { name: "Run on missing-NAS" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("not currently available");
  expect(api.put).not.toHaveBeenCalled();
});

it("keeps following an older Library that says done before supplying the model id", async () => {
  let reads = 0;
  vi.mocked(api.get).mockImplementation(async () => ({
    downloads: [{ ...DOWNLOAD, modelId: ++reads < 2 ? null : MODEL.id }],
  }));
  const hook = renderHook(() => useDownloads());
  await waitFor(() => expect(hook.result.current.downloads[0]?.modelId).toBe(MODEL.id), {
    timeout: 3000,
  });
  expect(reads).toBeGreaterThan(1);
});

it("offers a Library scan for a downloaded file, without resuming or launching it", async () => {
  show([
    {
      ...DOWNLOAD,
      modelId: undefined,
      message: "Downloaded, but the Library scan failed: disk unavailable",
    },
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Scan Library again" }));
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith("library", "/v1/scan", { full: false }),
  );
  expect(api.put).not.toHaveBeenCalled();
});

it("a specialist run leads to Documents, not a chat with an embedding model", async () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "Download and run on NAS" }));
  await waitFor(() => expect(operations).toHaveLength(1));
  operations[0]!.model = { ...MODEL, capabilities: { chat: false, embedding: true } };
  await act(async () => {
    await refreshRuns();
  });
  expect(await screen.findByRole("link", { name: "Open Documents in Workbench" })).toHaveAttribute(
    "href",
    "https://workbench.example/documents",
  );
  expect(screen.queryByRole("link", { name: "Open in Workbench" })).not.toBeInTheDocument();
});

it("uses the runtime's actual embedding mode even when the file can chat", async () => {
  runtimeExtra = { mode: "embedding" };
  show();
  fireEvent.click(screen.getByRole("button", { name: "Download and run on NAS" }));
  expect(await screen.findByRole("link", { name: "Open Documents in Workbench" })).toHaveAttribute(
    "href",
    "https://workbench.example/documents",
  );
  expect(screen.queryByRole("link", { name: "Open in Workbench" })).toBeNull();
});

it("does not present an old launch receipt as a currently ready model", async () => {
  runtimeExtra = { status: "stopped" };
  show();
  fireEvent.click(screen.getByRole("button", { name: "Download and run on NAS" }));
  expect(await screen.findByText("Model status on NAS: stopped.")).toBeVisible();
  expect(screen.queryByRole("link", { name: "Open in Workbench" })).toBeNull();
});
