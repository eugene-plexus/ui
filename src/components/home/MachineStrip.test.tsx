/**
 * Home's machine strip, rendered.
 *
 * `lib/home.ts` writes the words and is tested there. What this checks
 * is the one thing the component decides: a box with two identical cards
 * prints two identical lines, and each must be its own child.
 */

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MachineStrip } from "./MachineStrip";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MachineStrip", () => {
  it("renders two identical cards as two lines, with no duplicate key", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const line = "NVIDIA GeForce RTX 3090 · 25.8 GB · 24.9 GB free";
    render(
      <MachineStrip
        strip={{
          name: "gpu-box",
          devices: [line, line],
          engine: "llama.cpp b10948",
          models: "2 models on disk",
        }}
      />,
    );
    expect(screen.getAllByText(line)).toHaveLength(2);
    // React reports a key collision through console.error; the lines
    // were keyed on their own text, so two twin cards collided.
    const collisions = errors.mock.calls.filter((args) =>
      args.some((a) => typeof a === "string" && /same key/i.test(a)),
    );
    expect(collisions).toEqual([]);
  });
});
