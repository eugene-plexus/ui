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

it("follows a container that mounts after the first render, as a chat log's does", () => {
  // An empty conversation renders no scroll container, so the listener
  // must attach when the first message brings one in -- and to the new
  // one after New replaces it.
  function Log({ items }: { items: string[] }) {
    const { scrollRef, isAtBottom } = useAutoScroll(items);
    if (items.length === 0) return <p>Send a message to start a conversation.</p>;
    return (
      <>
        <div ref={scrollRef} data-testid="log">
          {items.map((t, i) => (
            <p key={i}>{t}</p>
          ))}
        </div>
        <span data-testid="at-bottom">{String(isAtBottom)}</span>
      </>
    );
  }
  const { rerender } = render(<Log items={[]} />);
  rerender(<Log items={["hello"]} />);
  const log = screen.getByTestId("log");
  Object.defineProperty(log, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(log, "clientHeight", { value: 100, configurable: true });
  Object.defineProperty(log, "scrollTop", { value: 0, writable: true, configurable: true });
  // The person scrolls up to re-read.
  fireEvent.scroll(log);
  expect(screen.getByTestId("at-bottom")).toHaveTextContent("false");
  // A token arrives: they are left where they are.
  rerender(<Log items={["hello", "a streamed reply"]} />);
  expect(log.scrollTop).toBe(0);
});
