/**
 * The tasks tray, driven.
 *
 * The list itself is `tasks.ts` and is tested as data. What is left for
 * a render test is the disclosure: the count on the button, the popover
 * opening and closing the ways a person closes one, a task being a link
 * with a bar when it has a known total, and the empty sentence.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Task } from "@/lib/tasks";

import { TasksTrayView } from "./TasksTray";

const DOWNLOAD: Task = {
  id: "download:1",
  kind: "download",
  title: "Downloading unsloth/Qwen3-14B-GGUF Qwen3-14B-UD-Q6_K_XL.gguf",
  detail: "42% · 38 MB/s · 3 min left",
  progress: 0.42,
  href: "/discover",
};

const LOAD: Task = {
  id: "load:a/r",
  kind: "load",
  title: "Loading qwen3-27b on Amish_Station",
  detail: "reading the model into memory",
  href: "/inference",
};

describe("TasksTrayView", () => {
  it("shows no count when nothing is running, and says so when opened", () => {
    render(<TasksTrayView tasks={[]} />);
    const button = screen.getByTestId("tasks-tray");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("tasks-count")).toBeNull();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("tasks-popover")).toHaveTextContent(
      "Nothing is running in the background.",
    );
  });

  it("counts the tasks on the button and lists each as a link to where it can be acted on", () => {
    render(<TasksTrayView tasks={[DOWNLOAD, LOAD]} />);
    expect(screen.getByTestId("tasks-count")).toHaveTextContent("2");
    fireEvent.click(screen.getByTestId("tasks-tray"));
    const links = screen.getByTestId("tasks-popover").querySelectorAll("a");
    expect(Array.from(links).map((a) => a.getAttribute("href"))).toEqual([
      "/discover",
      "/inference",
    ]);
    expect(links[0]).toHaveTextContent("Downloading unsloth/Qwen3-14B-GGUF");
    expect(links[0]).toHaveTextContent("42% · 38 MB/s · 3 min left");
  });

  it("draws a bar only for a task whose total is known", () => {
    render(<TasksTrayView tasks={[DOWNLOAD, LOAD]} />);
    fireEvent.click(screen.getByTestId("tasks-tray"));
    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(1);
    expect(bars[0]).toHaveAttribute("aria-valuenow", "42");
  });

  it("closes on Escape and returns focus to the button", () => {
    render(<TasksTrayView tasks={[DOWNLOAD]} />);
    const button = screen.getByTestId("tasks-tray");
    fireEvent.click(button);
    expect(screen.getByTestId("tasks-popover")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("tasks-popover")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("closes on a click outside, and stays open on a click inside", () => {
    render(
      <div>
        <TasksTrayView tasks={[DOWNLOAD]} />
        <button type="button" data-testid="elsewhere">
          elsewhere
        </button>
      </div>,
    );
    fireEvent.click(screen.getByTestId("tasks-tray"));
    fireEvent.mouseDown(screen.getByTestId("tasks-popover"));
    expect(screen.getByTestId("tasks-popover")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("elsewhere"));
    expect(screen.queryByTestId("tasks-popover")).toBeNull();
  });

  it("gives a finished run a dismiss beside the link, and colours a failure", () => {
    const dismiss = vi.fn();
    const failed: Task = {
      id: "run:m1@agent",
      kind: "run",
      title: "Run Qwen3-14B on this machine",
      detail: "Installing llama.cpp failed: release b10931 has no asset for 'win-cuda-13.3-x64'",
      href: "/inference",
      tone: "error",
      dismiss,
    };
    render(<TasksTrayView tasks={[failed, DOWNLOAD]} />);
    fireEvent.click(screen.getByTestId("tasks-tray"));
    const popover = screen.getByTestId("tasks-popover");
    // The failure is the component's sentence: it must not truncate.
    const row = popover.querySelector('a[data-task-kind="run"]');
    expect(row).toHaveAttribute("data-task-tone", "error");
    expect(row).toHaveTextContent("has no asset for 'win-cuda-13.3-x64'");
    // Exactly one dismiss — the download is not the browser's to dismiss.
    const dismisses = screen.getAllByTestId("task-dismiss");
    expect(dismisses).toHaveLength(1);
    // A sibling of the link, not inside it.
    expect(dismisses[0]!.closest("a")).toBeNull();
    fireEvent.click(dismisses[0]!);
    expect(dismiss).toHaveBeenCalledTimes(1);
    // Dismissing does not follow the link: the popover stays open.
    expect(screen.getByTestId("tasks-popover")).toBeInTheDocument();
  });
});
