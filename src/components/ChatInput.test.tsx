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

import { createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("an attached file's size", () => {
  it("is said in KB or MB, with the exact count on hover", async () => {
    render(<ChatInput onSend={vi.fn()} disabled={false} />);
    const file = new File(["x".repeat(12_345)], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByTestId("attach-input"), { target: { files: [file] } });
    const chip = await screen.findByTestId("attachment-chip");
    await waitFor(() => expect(chip).toHaveTextContent("12 KB"));
    expect(chip).not.toHaveTextContent("12,345 bytes");
    expect(screen.getByTitle("12,345 bytes")).toBeInTheDocument();
  });
});

describe("files that arrive without the attach button", () => {
  const notes = () => new File(["some notes"], "notes.txt", { type: "text/plain" });

  it("a file dropped on the page is attached, and the page does not navigate", async () => {
    render(<ChatInput onSend={vi.fn()} disabled={false} />);
    // Nothing handled a drop, so the browser opened the file in place of
    // the playground and the typed message went with it.
    const over = createEvent.dragOver(window, { dataTransfer: { types: ["Files"], files: [] } });
    fireEvent(window, over);
    expect(over.defaultPrevented).toBe(true);
    const drop = createEvent.drop(window, {
      dataTransfer: { types: ["Files"], files: [notes()] },
    });
    fireEvent(window, drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(await screen.findByTestId("attachment-chip")).toHaveTextContent("notes.txt");
  });

  it("text dragged between fields is left to the browser", () => {
    render(<ChatInput onSend={vi.fn()} disabled={false} />);
    const drop = createEvent.drop(window, { dataTransfer: { types: ["text/plain"], files: [] } });
    fireEvent(window, drop);
    expect(drop.defaultPrevented).toBe(false);
  });

  it("a pasted file is attached, but a paste that carries text stays text", async () => {
    render(<ChatInput onSend={vi.fn()} disabled={false} />);
    const box = screen.getByTestId("composer");
    const withText = createEvent.paste(box, {
      clipboardData: { files: [notes()], getData: () => "the words" },
    });
    fireEvent(box, withText);
    expect(withText.defaultPrevented).toBe(false);
    expect(screen.queryByTestId("attachment-chip")).toBeNull();

    const fileOnly = createEvent.paste(box, {
      clipboardData: { files: [notes()], getData: () => "" },
    });
    fireEvent(box, fileOnly);
    expect(fileOnly.defaultPrevented).toBe(true);
    expect(await screen.findByTestId("attachment-chip")).toHaveTextContent("notes.txt");
  });
});
