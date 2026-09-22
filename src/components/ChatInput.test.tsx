/**
 * The composer's keyboard, and its size.
 *
 * Enter sends, and a person typing Japanese, Chinese or Korean presses
 * Enter to CONFIRM what the input method has built, mid-word. That Enter
 * arrives as a keydown with `isComposing` set (or, in older engines,
 * with the IME's keyCode 229), and the composer sent the half-typed
 * message on it. What matters here is that a composing Enter never
 * sends and an ordinary one still does.
 *
 * And the box was fixed at two rows, so a pasted paragraph scrolled
 * inside a slot two lines tall. It grows with its content now, to a cap,
 * and scrolls past it.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatInput } from "./ChatInput";

function composer(onSend = vi.fn()) {
  render(<ChatInput onSend={onSend} disabled={false} />);
  const box = screen.getByTestId("composer") as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: "こんにち" } });
  return { box, onSend };
}

describe("Enter in the composer", () => {
  it("sends on an ordinary Enter", () => {
    const { box, onSend } = composer();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("こんにち");
  });

  it("does not send while an input method is composing", () => {
    const { box, onSend } = composer();
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
    expect(box.value).toBe("こんにち");
  });

  it("does not send on the input method's own key code either", () => {
    // Engines that do not set isComposing on the confirming keydown
    // still report keyCode 229 for it.
    const { box, onSend } = composer();
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("Shift+Enter is still a new line, not a send", () => {
    const { box, onSend } = composer();
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("the composer's height", () => {
  it("grows with what is typed, and has a cap it scrolls past", () => {
    render(<ChatInput onSend={vi.fn()} disabled={false} />);
    const box = screen.getByTestId("composer") as HTMLTextAreaElement;
    // jsdom does no layout, so stand in for the height the text needs.
    let needed = 48;
    Object.defineProperty(box, "scrollHeight", { configurable: true, get: () => needed });

    fireEvent.change(box, { target: { value: "one line" } });
    expect(box.style.height).toBe("48px");

    needed = 180;
    fireEvent.change(box, { target: { value: "a\nlonger\nmessage\nthat\nwraps" } });
    expect(box.style.height).toBe("180px");

    // The cap and the scrolling are CSS, so they hold whatever the text is.
    expect(box.className).toMatch(/max-h-/);
    expect(box.className).toMatch(/overflow-y-auto/);
  });
});
