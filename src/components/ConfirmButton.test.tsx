/**
 * The irreversible button asks before it acts: one click asks, the second
 * acts, and both ways out (Keep and Escape) leave the thing alone.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmButton } from "./ConfirmButton";

describe("ConfirmButton", () => {
  it("does nothing on the first click but ask", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmButton
        label="Turn off"
        prompt="Apps using this key stop working."
        onConfirm={onConfirm}
        testId="k"
      />,
    );
    fireEvent.click(screen.getByTestId("k"));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText("Apps using this key stop working.")).toBeInTheDocument();
    expect(screen.getByTestId("k-cancel")).toHaveFocus();
  });

  it("acts on the second click", () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Turn off" onConfirm={onConfirm} testId="k" />);
    fireEvent.click(screen.getByTestId("k"));
    fireEvent.click(screen.getByTestId("k-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("k")).toBeInTheDocument();
  });

  it("Keep and Escape both back out without acting", () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Delete" onConfirm={onConfirm} testId="k" />);
    fireEvent.click(screen.getByTestId("k"));
    fireEvent.click(screen.getByTestId("k-cancel"));
    expect(screen.getByTestId("k")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("k"));
    fireEvent.keyDown(screen.getByTestId("k-confirm"), { key: "Escape" });
    expect(screen.getByTestId("k")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
