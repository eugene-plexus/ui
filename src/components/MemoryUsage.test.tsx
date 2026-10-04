import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MemoryUsage } from "./MemoryUsage";

describe("MemoryUsage", () => {
  it.each([0, 8e9, 32e9])("shows measured free memory %s as used capacity", (free) => {
    render(
      <MemoryUsage
        device={{ kind: "cuda", name: "GPU 0", memoryTotalBytes: 32e9, memoryFreeBytes: free }}
      />,
    );
    const meter = screen.getByRole("meter", { name: "GPU 0 memory used" });
    expect(meter).toHaveAttribute("aria-valuenow", String(32e9 - free));
    expect(meter).toHaveAttribute("aria-valuemax", "32000000000");
    expect(meter).toHaveAttribute("aria-valuetext", expect.stringContaining("free of"));
  });

  it.each([
    { memoryTotalBytes: 32e9 },
    { memoryFreeBytes: 8e9 },
    { memoryTotalBytes: 0, memoryFreeBytes: 0 },
    { memoryTotalBytes: 32e9, memoryFreeBytes: 40e9 },
    { memoryTotalBytes: 32e9, memoryFreeBytes: -1 },
    { memoryTotalBytes: Infinity, memoryFreeBytes: 8e9 },
    { memoryTotalBytes: 32e9, memoryFreeBytes: NaN },
  ])("does not invent usage from an incomplete or invalid reading: %j", (reading) => {
    render(<MemoryUsage device={{ kind: "cuda", ...reading }} />);
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.getByText(/usage unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/% used/)).not.toBeInTheDocument();
  });

  it("identifies shared memory in text and the meter's accessible value", () => {
    render(
      <MemoryUsage
        device={{
          kind: "metal",
          name: "Apple GPU",
          sharedMemory: true,
          memoryTotalBytes: 32e9,
          memoryFreeBytes: 24e9,
        }}
      />,
    );
    expect(screen.getByText("Shared with system memory")).toBeInTheDocument();
    expect(screen.getByRole("meter")).toHaveAttribute(
      "aria-valuetext",
      expect.stringContaining("shared with system memory"),
    );
  });
});
