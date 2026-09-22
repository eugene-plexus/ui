/**
 * Home's composer and an input method.
 *
 * It is a one-line `<input>` in a form, so Enter sends by the browser's
 * implicit submission rather than by a handler of ours - and a person
 * typing Japanese, Chinese or Korean presses Enter to confirm what the
 * input method built. A composing Enter must not submit, which for an
 * implicit submission means its default is prevented; an ordinary Enter
 * must keep its default, or Home stops sending at all.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Model } from "@/lib/types";

import { TryItCard } from "./TryItCard";

vi.mock("@/lib/useAutoScroll", () => ({
  useAutoScroll: () => ({
    scrollRef: { current: null },
    isAtBottom: true,
    scrollToBottom: () => {},
  }),
}));

const MODELS = [{ id: "qwen", object: "model", created: 0, owned_by: "eugene-plexus" }] as Model[];

function box() {
  render(<TryItCard models={MODELS} routing={null} />);
  const input = screen.getByTestId("home-composer");
  fireEvent.change(input, { target: { value: "こんにち" } });
  return input;
}

describe("Enter in Home's composer", () => {
  it("does not submit while an input method is composing", () => {
    // fireEvent returns false when the handler prevented the default.
    expect(fireEvent.keyDown(box(), { key: "Enter", isComposing: true })).toBe(false);
  });

  it("does not submit on the input method's own key code either", () => {
    expect(fireEvent.keyDown(box(), { key: "Enter", keyCode: 229 })).toBe(false);
  });

  it("leaves an ordinary Enter alone, so it still sends", () => {
    expect(fireEvent.keyDown(box(), { key: "Enter" })).toBe(true);
  });
});
