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
