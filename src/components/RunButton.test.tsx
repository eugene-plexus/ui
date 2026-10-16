/**
 * Run's progress line, heard as well as seen.
 *
 * The line under Run changes on its own as a run moves through its steps,
 * and a screen reader was told none of it: not "Loading", not "Ready", not
 * the failure. The step is a polite live region and a failure an alert.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RunTask } from "@/lib/oneClickRun";

import { RunStatus } from "./RunButton";

function task(over: Partial<RunTask>): RunTask {
  return {
    id: "run:m1@agent",
    model: { id: "m1", name: "Qwen3-14B", path: "x", format: "gguf", contextLength: null },
    node: { target: "agent", label: "this machine", name: null, local: true },
    step: "loading",
    failedStep: null,
    engine: "llama_cpp",
    install: null,
    preparing: null,
    preparation: null,
    preparedFrom: null,
    download: null,
    runtime: "qwen",
    runtimeStatus: "loading",
    error: null,
    startedAt: 0,
    finishedAt: null,
    generation: 1,
    ...over,
  };
}

describe("RunStatus", () => {
  it("says each step in a live region", () => {
    render(<RunStatus task={task({})} onRetry={vi.fn()} />);
    const line = screen.getByRole("status");
    expect(line).toHaveTextContent(/\S/);
    expect(screen.getByTestId("run-status")).toContainElement(line);
  });

  it("sends a chat model's person to Home when it is ready, as it always has", () => {
    render(<RunStatus task={task({ step: "ready" })} onRetry={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Launch completed on this machine");
    expect(screen.getByTestId("run-try-it")).toHaveAttribute("href", "/");
  });

  it("does not send a search model's person to Home: nothing there can chat with it (MR3)", () => {
    const search = task({
      step: "ready",
      model: {
        id: "e1",
        name: "Qwen3-Embedding-0.6B-Q8_0",
        path: "x",
        format: "gguf",
        contextLength: null,
        capabilities: { chat: false, embedding: true },
      },
    });
    render(<RunStatus task={search} onRetry={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Launch completed on this machine");
    expect(screen.queryByTestId("run-try-it")).toBeNull();
    expect(screen.getByRole("link", { name: "See it on Backends" })).toHaveAttribute(
      "href",
      "/inference",
    );
  });

  it("says the same for a result sorter", () => {
    const sorter = task({
      step: "ready",
      model: {
        id: "r1",
        name: "Qwen3-Reranker",
        path: "x",
        format: "gguf",
        contextLength: null,
        capabilities: { chat: false, rerank: true },
      },
    });
    render(<RunStatus task={sorter} onRetry={vi.fn()} />);
    expect(screen.queryByTestId("run-try-it")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Launch completed on");
  });

  it("announces a failure as an alert", () => {
    render(
      <RunStatus
        task={task({ step: "failed", failedStep: "launch", error: "The engine exited." })}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("The engine exited.");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
