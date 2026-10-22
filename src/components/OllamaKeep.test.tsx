import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { KeepModel, OtherOllama, ReportOllama } from "./OllamaKeep";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  describeError: String,
}));
afterEach(() => vi.resetAllMocks());

it("keeps a worker model through its digest and reports completion", async () => {
  vi.mocked(api.get).mockImplementation(async (_target, path) => {
    if (path === "/v1/folders") return { folders: [{ path: "D:/models", kind: "folder" }] };
    return {
      id: "j",
      state: "done",
      method: "copy",
      target: "D:/models/ollama/llama/llama.gguf",
      model: { id: "kept" },
    };
  });
  vi.mocked(api.post).mockResolvedValue({ id: "j", state: "running", bytesDone: 2, bytesTotal: 3 });
  const changed = vi.fn();
  render(<KeepModel node="worker" digest={"sha256:" + "a".repeat(64)} onChanged={changed} />);
  await userEvent.click(screen.getByRole("button", { name: "Keep in the Library" }));
  expect(api.post).toHaveBeenCalledWith("library", "/v1/nodes/worker/ollama/keep", {
    digest: "sha256:" + "a".repeat(64),
  });
  expect(await screen.findByText(/Kept in D:\/models/)).toBeInTheDocument();
  expect(changed).toHaveBeenCalled();
});

it("lists a remote report as metadata with no Run action", async () => {
  vi.mocked(api.get).mockResolvedValue({
    nodes: [
      {
        node: "worker",
        readAt: new Date().toISOString(),
        stores: [
          {
            path: "/ollama",
            skipped: [],
            models: [
              {
                tags: ["llama3:8b"],
                digest: "sha256:" + "a".repeat(64),
                sizeBytes: 5e9,
                runner: "llamacpp",
                libraryModel: "kept",
              },
            ],
          },
        ],
      },
    ],
  });
  render(<OtherOllama onChanged={vi.fn()} />);
  expect(await screen.findByText("llama3:8b")).toBeInTheDocument();
  expect(screen.getByText("Already in the Library")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Run/i })).toBeNull();
});

it("shows the effective reporting setting and patches this machine", async () => {
  vi.mocked(api.get).mockResolvedValue({ reportOllama: true });
  vi.mocked(api.patch).mockResolvedValue({ rejected: [], applied: ["reportOllama"] });
  render(<ReportOllama node="worker" />);
  const toggle = await screen.findByRole("checkbox", { name: "Report Ollama models" });
  expect(toggle).toBeChecked();
  vi.mocked(api.get).mockResolvedValue({ reportOllama: false });
  await userEvent.click(toggle);
  expect(api.patch).toHaveBeenCalledWith("node:worker", "/v1/config", { reportOllama: false });
  expect(toggle).not.toBeChecked();
});
