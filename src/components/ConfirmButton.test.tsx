/**
 * The irreversible button asks before it acts: one click asks, the second
 * acts, and both ways out (Keep and Escape) leave the thing alone.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmButton } from "./ConfirmButton";

describe("ConfirmButton", () => {
  it("points both answers at the question so it is announced", () => {
    render(
      <ConfirmButton
        label="Turn off"
        prompt="Apps using this key stop working."
        onConfirm={() => undefined}
        testId="k"
      />,
    );
    fireEvent.click(screen.getByTestId("k"));
    const prompt = screen.getByText("Apps using this key stop working.");
    expect(prompt.id).not.toBe("");
    for (const id of ["k-confirm", "k-cancel"]) {
      expect(screen.getByTestId(id)).toHaveAttribute("aria-describedby", prompt.id);
    }
    // Their names are what they were.
    expect(screen.getByTestId("k-cancel")).toHaveAccessibleName("Keep");
  });

  it("points at nothing when there is no question", () => {
    render(<ConfirmButton label="Turn off" onConfirm={() => undefined} testId="k" />);
    fireEvent.click(screen.getByTestId("k"));
    expect(screen.getByTestId("k-cancel")).not.toHaveAttribute("aria-describedby");
  });

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

  it("lets its question wrap on a line of its own, even in a nowrap cell (ui#14)", () => {
    render(
      <table>
        <tbody>
          <tr>
            <td className="whitespace-nowrap">
              <ConfirmButton
                label="remove"
                prompt="The engine stops; the model files stay."
                onConfirm={() => undefined}
                testId="r"
              />
            </td>
          </tr>
        </tbody>
      </table>,
    );
    fireEvent.click(screen.getByTestId("r"));
    const group = screen.getByRole("group", { name: "Confirm" });
    expect(group.className).toMatch(/\bwhitespace-normal\b/);
    expect(group.className).toMatch(/\bmax-w-\[16rem\]/);
    expect(group.className).toMatch(/\bflex-wrap\b/);
    expect(screen.getByText("The engine stops; the model files stay.").className).toMatch(
      /\bbasis-full\b/,
    );
  });

  it("tells its screen when it starts and stops asking", () => {
    const onAsking = vi.fn();
    render(
      <ConfirmButton label="remove" onConfirm={() => undefined} testId="r" onAsking={onAsking} />,
    );
    onAsking.mockClear();
    fireEvent.click(screen.getByTestId("r"));
    expect(onAsking).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByTestId("r-cancel"));
    expect(onAsking).toHaveBeenLastCalledWith(false);
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
    // Back on the button that asked, not dropped onto the page.
    expect(screen.getByTestId("k")).toHaveFocus();

    fireEvent.click(screen.getByTestId("k"));
    fireEvent.keyDown(screen.getByTestId("k-confirm"), { key: "Escape" });
    expect(screen.getByTestId("k")).toBeInTheDocument();
    expect(screen.getByTestId("k")).toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("names what it acts on when its words repeat on every row", () => {
    render(<ConfirmButton label="Remove" ariaLabel="Remove gemma-3" onConfirm={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Remove gemma-3" })).toHaveTextContent("Remove");
  });
});
