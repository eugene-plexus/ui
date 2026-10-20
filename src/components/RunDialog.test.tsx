/**
 * The one question, driven: Install is the default and focused, Skip
 * carries its warning, Escape only closes, and the words are the person's.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RunTask } from "@/lib/oneClickRun";

import { RunDialogView } from "./RunDialog";

const ASKING: RunTask = {
  id: "run:m1@agent",
  model: { id: "m1", name: "Qwen3-14B", path: "x", format: "gguf", contextLength: null },
  node: { target: "agent", label: "this machine", name: null, local: true },
  step: "awaiting-install",
  failedStep: null,
  engine: "llama_cpp",
  install: null,
  preparing: null,
  preparation: null,
  preparedFrom: null,
  download: null,
  runtime: null,
  runtimeStatus: null,
  error: null,
  startedAt: 0,
  finishedAt: null,
  generation: 1,
};

describe("RunDialogView for a preparation (LS5)", () => {
  it("offers no Skip: without the engine nothing can be prepared", () => {
    const onAnswer = vi.fn();
    render(
      <RunDialogView
        task={{ ...ASKING, engine: "strata", preparing: { engine: "strata", contextSize: null } }}
        onAnswer={onAnswer}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("run-skip")).toBeNull();
    expect(screen.getByTestId("run-dialog")).toHaveTextContent(
      "Strata is the program that prepares Qwen3-14B and then runs it.",
    );
    fireEvent.click(screen.getByTestId("run-install"));
    expect(onAnswer).toHaveBeenCalledWith(ASKING.id, "install");
  });
});

describe("RunDialogView", () => {
  it("asks in the person's words, with Install focused as the default", () => {
    render(<RunDialogView task={ASKING} onAnswer={vi.fn()} onCancel={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("I could not find llama.cpp on this machine. Install it now?");
    expect(dialog).toHaveTextContent("Skip is for advanced users");
    expect(screen.getByTestId("run-install")).toHaveFocus();
    const text = (dialog.textContent ?? "").toLowerCase();
    for (const word of ["runtime", "companion", "declaration", "admission", "binary"]) {
      expect(text, `the dialog says "${word}"`).not.toContain(word);
    }
  });

  it("answers install and skip by id", () => {
    const onAnswer = vi.fn();
    render(<RunDialogView task={ASKING} onAnswer={onAnswer} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByTestId("run-install"));
    expect(onAnswer).toHaveBeenCalledWith("run:m1@agent", "install");
    fireEvent.click(screen.getByTestId("run-skip"));
    expect(onAnswer).toHaveBeenCalledWith("run:m1@agent", "skip");
  });

  it("only closes on Escape and Later; Cancel the run cancels it (CX3)", () => {
    const onCancel = vi.fn();
    const onClose = vi.fn();
    render(
      <RunDialogView task={ASKING} onAnswer={vi.fn()} onCancel={onCancel} onClose={onClose} />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByTestId("run-later"));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("run-cancel"));
    expect(onCancel).toHaveBeenCalledWith(ASKING.id);
  });

  it("asks at the click before anything starts; Escape there starts nothing (CX3)", () => {
    const onAsked = vi.fn();
    render(
      <RunDialogView
        task={{ ...ASKING, step: "downloading", confirming: true }}
        onAnswer={vi.fn()}
        onAsked={onAsked}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Install llama.cpp too?");
    expect(dialog).toHaveTextContent("then installs llama.cpp and starts it");
    expect(screen.queryByTestId("run-skip")).toBeNull();
    expect(screen.getByTestId("run-install")).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onAsked).toHaveBeenLastCalledWith(ASKING.id, "cancel");
    fireEvent.click(screen.getByTestId("run-install"));
    expect(onAsked).toHaveBeenLastCalledWith(ASKING.id, "install");
  });

  it("names the node it is about when the run is on another machine", () => {
    render(
      <RunDialogView
        task={{
          ...ASKING,
          node: { target: "node:node-b", label: "node-b", name: "node-b", local: false },
        }}
        onAnswer={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("I could not find llama.cpp on node-b.");
  });
});
