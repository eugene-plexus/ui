import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useAutoScroll } from "./useAutoScroll";

afterEach(() => vi.unstubAllGlobals());

it("checks the current motion preference when jumping to the latest message", () => {
  let reduced = false;
  const matchMedia = vi.fn(() => ({ matches: reduced }));
  vi.stubGlobal("matchMedia", matchMedia);
  function Conversation() {
    const { scrollRef, scrollToBottom } = useAutoScroll(null);
    return (
      <>
        <div ref={scrollRef} data-testid="transcript" />
        <button onClick={scrollToBottom}>Latest</button>
      </>
    );
  }
  render(<Conversation />);
  const transcript = screen.getByTestId("transcript");
  const scroll = vi.fn();
  transcript.scrollTo = scroll;
  Object.defineProperty(transcript, "scrollHeight", { value: 1200 });
  fireEvent.click(screen.getByRole("button", { name: "Latest" }));
  expect(scroll).toHaveBeenLastCalledWith({ top: 1200, behavior: "smooth" });
  reduced = true;
  fireEvent.click(screen.getByRole("button", { name: "Latest" }));
  expect(scroll).toHaveBeenLastCalledWith({ top: 1200, behavior: "instant" });
  expect(matchMedia).toHaveBeenLastCalledWith("(prefers-reduced-motion: reduce)");
});
