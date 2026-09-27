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

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Model, RoutingTableView } from "@/lib/types";

import { TryItCard } from "./TryItCard";

const stream = vi.fn();
vi.mock("@/lib/completions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/completions")>()),
  streamChatCompletion: (...args: unknown[]) => stream(...args),
}));

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

describe("after an answer", () => {
  const READY = {
    slots: [{ model: "qwen", tiers: [{ tier: 1, backends: [{ driver: "d", eligible: true }] }] }],
    unreachable_drivers: [],
  } as unknown as RoutingTableView;

  function deferred() {
    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("puts the caret back in the box, even from the Cancel button", async () => {
    const turn = deferred();
    stream.mockReturnValueOnce(turn.promise);
    render(<TryItCard models={MODELS} routing={READY} />);
    const input = screen.getByTestId("home-composer");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.submit(input.closest("form")!);
    // The person moves to Cancel while it answers; Cancel then unmounts.
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    cancel.focus();
    await act(async () => {
      turn.resolve({
        choices: [{ message: { role: "assistant", content: "hi" } }],
        report: { elapsedMs: 10 },
      });
    });
    await waitFor(() => expect(screen.getByTestId("home-composer")).toHaveFocus());
  });

  it("shows that the model is working while the first word is slow", async () => {
    // 2026-09-27: on the processor the first word can take minutes, and
    // Home said only "Waiting for the answer…". A tester read that as a
    // failure and left while the answer was being written.
    stream.mockReturnValueOnce(deferred().promise);
    render(<TryItCard models={MODELS} routing={READY} />);
    const input = screen.getByTestId("home-composer");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.submit(input.closest("form")!);
    // Amended 2026-09-27: before the stream says anything, it says only
    // what is known -- the message went and nothing has come back.
    expect(await screen.findByTestId("working-indicator")).toHaveTextContent(
      "Waiting for the model",
    );
  });

  it("says what the model is doing, and shows its thinking", async () => {
    // 2026-09-27: the same signals the playground shows, on the first
    // screen a person reaches -- where the tester who gave up was.
    let options: { onProgress?: (p: unknown) => void; onReasoning?: (d: string) => void } = {};
    stream.mockImplementationOnce((opts: typeof options) => {
      options = opts;
      return deferred().promise;
    });
    render(<TryItCard models={MODELS} routing={READY} />);
    const input = screen.getByTestId("home-composer");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.submit(input.closest("form")!);
    await screen.findByTestId("working-indicator");
    act(() =>
      options.onProgress?.({
        stage: "prompt",
        prompt_tokens: 200,
        cached_tokens: 0,
        processed_tokens: 50,
      }),
    );
    expect(screen.getByTestId("working-headline")).toHaveTextContent("Reading your message: 25%");
    act(() => options.onReasoning?.("Hmm, a greeting."));
    expect(await screen.findByTestId("thinking-text")).toHaveTextContent("Hmm, a greeting.");
    expect(screen.getByTestId("working-headline")).toHaveTextContent("Thinking");
  });

  it("announces a failed send", async () => {
    stream.mockRejectedValueOnce(new Error("The backend fell over."));
    render(<TryItCard models={MODELS} routing={READY} />);
    const input = screen.getByTestId("home-composer");
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("The backend fell over.");
  });
});
