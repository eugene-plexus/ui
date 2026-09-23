/**
 * The playground, driven as a page.
 *
 * The sampling lib and the send path have their own tests; what lives
 * here is the WIRING, which a component test cannot prove (S7's lesson,
 * twice): that a value typed into the panel reaches the request body,
 * that the system prompt rides the wire without entering the stored
 * transcript, that Stop keeps the partial answer and reads as a notice
 * rather than a failure, and that Try again resends the same history.
 *
 * `fetch` is mocked at the boundary the api client uses, as Home's test
 * does. The chat route hands back a real SSE body, because the page's
 * send path is the streaming one and a JSON stub would test a path the
 * page never takes.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PlaygroundPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/playground",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, controls }: { children: ReactNode; controls?: ReactNode }) => (
    <div data-testid="shell">
      {controls}
      {children}
    </div>
  ),
}));

vi.mock("@/lib/useAutoScroll", () => ({
  useAutoScroll: () => ({
    scrollRef: { current: null },
    isAtBottom: true,
    scrollToBottom: () => {},
  }),
}));

interface Call {
  method: string;
  route: string;
  body: Record<string, unknown> | undefined;
}

type Handler = (init?: RequestInit) => Response;

let calls: Call[];
let handlers: Map<string, Handler>;

const MODELS = {
  object: "list",
  data: [
    {
      id: "qwen3-14b",
      object: "model",
      created: 0,
      owned_by: "eugene-plexus",
      x_eugene_plexus: { surfaces: ["chat"] },
    },
  ],
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: String(status),
    headers: { "content-type": "application/json" },
  });
}

/** A finished SSE stream: content deltas, then the final frame with a
 * finish reason and usage, then [DONE]. */
function sse(
  deltas: string[],
  finish: string,
  usage = { prompt_tokens: 5, completion_tokens: 7 },
): Response {
  const frames = [
    ...deltas.map((content) => JSON.stringify({ choices: [{ index: 0, delta: { content } }] })),
    JSON.stringify({
      choices: [{ index: 0, delta: {}, finish_reason: finish }],
      usage,
      x_eugene_plexus: { driver: "qwen-driver" },
    }),
    "[DONE]",
  ];
  const body = frames.map((f) => `data: ${f}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** A stream that delivers one delta and then hangs until the request's
 * own signal aborts it — the shape a Stop click meets mid-answer. */
function hangingSse(delta: string): Handler {
  return (init) => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        if (delta !== "") {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: delta } }] })}\n\n`,
            ),
          );
        }
        const signal = init?.signal;
        const abort = () => controller.error(new DOMException("Aborted", "AbortError"));
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
}

function key(call: Call): string {
  return `${call.method} ${call.route}`;
}

beforeEach(() => {
  calls = [];
  handlers = new Map<string, Handler>([
    ["GET agent/v1/auth/status", () => json(200, { initialized: true })],
    ["GET agent/v1/config", () => json(200, { firstRunComplete: true })],
    ["GET agent/v1/components", () => json(200, { components: [] })],
    ["GET gateway/v1/models", () => json(200, MODELS)],
  ]);
  sessionStorage.clear();
  localStorage.clear();
  sessionStorage.setItem("eugene-session-token", "test-token");

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? "GET",
        route: String(input).replace(/^\/api\/proxy\//, ""),
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
      };
      calls.push(call);
      const handler = handlers.get(key(call));
      if (!handler) return json(418, { detail: { title: `unhandled route: ${key(call)}` } });
      return handler(init);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderReady() {
  render(<PlaygroundPage />);
  await waitFor(() => expect(screen.getByTestId("composer")).toBeInTheDocument());
  await waitFor(() => expect(screen.getByTestId("composer")).not.toBeDisabled());
}

function send(text: string) {
  fireEvent.change(screen.getByTestId("composer"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

function chatCalls(): Call[] {
  return calls.filter((c) => key(c) === "POST gateway/v1/chat/completions");
}

describe("sampling wiring", () => {
  it("typed settings reach the request body, and the system prompt stays out of the transcript", async () => {
    // Stored before the page loads, the way a returning operator's
    // browser has it. seed 0 and temperature 0 are the falsy values a
    // truthiness check anywhere on the path would drop.
    localStorage.setItem(
      "eugene-playground-sampling",
      JSON.stringify({ system: "Be brief.", seed: "0", temperature: "0", maxTokens: "64" }),
    );
    handlers.set("POST gateway/v1/chat/completions", () => sse(["Hi"], "stop"));
    await renderReady();

    // Hidden state is not silent: the chip says settings are in play.
    expect(screen.getByTestId("toggle-diagnostic").textContent).toContain("settings");

    send("hello");
    await waitFor(() => expect(chatCalls()).toHaveLength(1));
    const body = chatCalls()[0]!.body!;
    expect(body.seed).toBe(0);
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(64);
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages[0]).toEqual({ role: "system", content: "Be brief." });
    expect(messages[1]?.content).toBe("hello");

    // The reply arrived and the stored transcript carries NO system
    // message — prepending it into storage would send two next turn.
    await waitFor(() => expect(screen.getByText("Hi")).toBeInTheDocument());
    const stored = JSON.parse(sessionStorage.getItem("eugene-playground") ?? "{}") as {
      messages?: Array<{ role: string }>;
    };
    expect(stored.messages?.some((m) => m.role === "system")).toBe(false);
  });

  it("with nothing typed the request carries no sampling fields at all", async () => {
    handlers.set("POST gateway/v1/chat/completions", () => sse(["ok"], "stop"));
    await renderReady();
    send("hello");
    await waitFor(() => expect(chatCalls()).toHaveLength(1));
    const body = chatCalls()[0]!.body!;
    for (const field of ["temperature", "max_tokens", "top_p", "seed", "stop"]) {
      expect(field in body, `${field} must be omitted`).toBe(false);
    }
    expect((body.messages as Array<{ role: string }>)[0]?.role).toBe("user");
  });

  it("a reply that hit the token limit is badged, a natural end is not", async () => {
    handlers.set("POST gateway/v1/chat/completions", () => sse(["truncated…"], "length"));
    await renderReady();
    send("hello");
    await waitFor(() => expect(screen.getByText("hit the token limit")).toBeInTheDocument());
  });
});

/** The smallest byte string the PNG checks accept, sized as asked. */
function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const u32 = (offset: number, value: number) => {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
  };
  u32(16, width);
  u32(20, height);
  return bytes;
}

function pngFile(name: string): File {
  return new File([pngBytes(64, 48).buffer as ArrayBuffer], name, { type: "image/png" });
}

async function attach(file: File) {
  fireEvent.change(screen.getByTestId("attach-input"), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByTestId("image-chip")).toBeInTheDocument());
}

describe("image wiring", () => {
  it("an attached PNG rides as an inline content part and renders in the transcript", async () => {
    handlers.set("POST gateway/v1/chat/completions", () => sse(["A square."], "stop"));
    await renderReady();
    await attach(pngFile("shot.png"));

    send("what is this");
    await waitFor(() => expect(chatCalls()).toHaveLength(1));
    const body = chatCalls()[0]!.body!;
    const content = (body.messages as Array<{ role: string; content: unknown }>).find(
      (m) => m.role === "user",
    )!.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(content[0]).toEqual({ type: "text", text: "what is this" });
    expect(content[1]?.type).toBe("image_url");
    expect(content[1]?.image_url?.url.startsWith("data:image/png;base64,")).toBe(true);

    // The transcript renders the pixels, and stores the same parts the
    // wire carried.
    await waitFor(() => expect(screen.getByText("A square.")).toBeInTheDocument());
    expect(screen.getByTestId("message-image")).toBeInTheDocument();
    const stored = JSON.parse(sessionStorage.getItem("eugene-playground") ?? "{}") as {
      messages?: Array<{ content: unknown }>;
    };
    expect(Array.isArray(stored.messages?.[0]?.content)).toBe(true);
  });

  it("a model reporting image_input false warns while an image is attached, before Send", async () => {
    handlers.set("GET gateway/v1/models", () =>
      json(200, {
        object: "list",
        data: [
          {
            id: "qwen3-14b",
            object: "model",
            created: 0,
            owned_by: "eugene-plexus",
            x_eugene_plexus: { surfaces: ["chat"], image_input: false },
          },
        ],
      }),
    );
    await renderReady();
    expect(screen.queryByTestId("image-model-note")).not.toBeInTheDocument();
    await attach(pngFile("shot.png"));
    expect(screen.getByTestId("image-model-note").textContent).toContain("does not take images");
    expect(chatCalls()).toHaveLength(0);
  });

  it("a model with no opinion gets no warning — absent is not false", async () => {
    await renderReady();
    await attach(pngFile("shot.png"));
    expect(screen.queryByTestId("image-model-note")).not.toBeInTheDocument();
  });

  it("a fifth image blocks Send with the count named, before any bytes cross the wire", async () => {
    await renderReady();
    const files = [1, 2, 3, 4, 5].map((i) => pngFile(`${i}.png`));
    fireEvent.change(screen.getByTestId("attach-input"), { target: { files } });
    await waitFor(() => expect(screen.getAllByTestId("image-chip")).toHaveLength(5));
    expect(screen.getByTestId("image-set-error").textContent).toContain("at most 4");
    fireEvent.change(screen.getByTestId("composer"), { target: { value: "look" } });
    const sendButton = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
    // Removing one image clears the refusal and Send comes back.
    fireEvent.click(screen.getAllByRole("button", { name: "Remove 5.png" })[0]!);
    await waitFor(() => expect(screen.queryByTestId("image-set-error")).not.toBeInTheDocument());
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(chatCalls()).toHaveLength(0);
  });
});

describe("arrival", () => {
  it("the composer holds keyboard focus once a model is routable, without a click", async () => {
    await renderReady();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("composer")));
  });
});

describe("stop and retry", () => {
  it("Stop keeps the partial answer and reads as a notice, not an error", async () => {
    handlers.set("POST gateway/v1/chat/completions", hangingSse("Half an ans"));
    await renderReady();
    send("hello");

    // The partial text is on screen and the composer's Send became Stop.
    await waitFor(() => expect(screen.getByText("Half an ans")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("stop-turn"));

    await waitFor(() => expect(screen.getByTestId("turn-notice")).toBeInTheDocument());
    expect(screen.getByText("Half an ans")).toBeInTheDocument();
    expect(screen.queryByTestId("retry-turn")).not.toBeInTheDocument();
    // Ready for the next turn: Send is back and enabled once typed.
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument());
  });

  it("Stop before the first token says nothing arrived, and offers the turn again", async () => {
    handlers.set("POST gateway/v1/chat/completions", hangingSse(""));
    await renderReady();
    send("hello");
    await waitFor(() => expect(screen.getByTestId("stop-turn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("stop-turn"));

    const notice = await screen.findByTestId("turn-notice");
    // "Whatever had already arrived is kept above" was untrue: nothing had.
    expect(notice).toHaveTextContent("Stopped before any reply arrived.");
    handlers.set("POST gateway/v1/chat/completions", () => sse(["Answered"], "stop"));
    fireEvent.click(screen.getByTestId("retry-turn"));
    await waitFor(() => expect(screen.getByText("Answered")).toBeInTheDocument());
    // The same question once, not twice in a row.
    expect(chatCalls()[1]!.body!.messages).toEqual(chatCalls()[0]!.body!.messages);
  });

  it("a failed turn offers Try again, which resends the same history", async () => {
    let attempts = 0;
    handlers.set("POST gateway/v1/chat/completions", () => {
      attempts += 1;
      if (attempts === 1) return json(502, { error: { message: "backend fell over" } });
      return sse(["Recovered"], "stop");
    });
    await renderReady();
    send("hello");

    await waitFor(() => expect(screen.getByTestId("retry-turn")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("retry-turn"));

    await waitFor(() => expect(screen.getByText("Recovered")).toBeInTheDocument());
    expect(chatCalls()).toHaveLength(2);
    // Byte-for-byte the same conversation, not a re-typed one.
    expect(chatCalls()[1]!.body!.messages).toEqual(chatCalls()[0]!.body!.messages);
    expect(screen.queryByTestId("retry-turn")).not.toBeInTheDocument();
  });
});

describe("New", () => {
  // The transcript is the one thing the playground keeps across a reload,
  // and New wiped it on a single click next to the model picker.
  function storedMessages(): unknown[] {
    const stored = JSON.parse(sessionStorage.getItem("eugene-playground") ?? "{}") as {
      messages?: unknown[];
    };
    return stored.messages ?? [];
  }

  it("asks before clearing a conversation, and Keep leaves it", async () => {
    handlers.set("POST gateway/v1/chat/completions", () => sse(["Hi there"], "stop"));
    await renderReady();
    send("hello");
    await waitFor(() => expect(screen.getByText("Hi there")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "New" }));
    // Nothing is gone yet.
    expect(screen.getByText("Hi there")).toBeInTheDocument();
    expect(storedMessages()).toHaveLength(2);
    expect(screen.getByText("This clears the conversation.")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("new-conversation-cancel"));
    expect(screen.getByText("Hi there")).toBeInTheDocument();
  });

  it("clears it once confirmed", async () => {
    handlers.set("POST gateway/v1/chat/completions", () => sse(["Hi there"], "stop"));
    await renderReady();
    send("hello");
    await waitFor(() => expect(screen.getByText("Hi there")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "New" }));
    fireEvent.click(screen.getByTestId("new-conversation-confirm"));
    await waitFor(() => expect(screen.queryByText("Hi there")).toBeNull());
    await waitFor(() => expect(storedMessages()).toHaveLength(0));
  });

  it("has nothing to ask about when there is no conversation", async () => {
    await renderReady();
    // Nothing to lose, so no question: the plain button, not a confirm.
    expect(screen.getByRole("button", { name: "New" })).toBeDisabled();
  });
});

describe("Copy JSON", () => {
  it("copies the messages as the request carried them", async () => {
    localStorage.setItem("eugene-playground-sampling", JSON.stringify({ system: "Be brief." }));
    handlers.set("POST gateway/v1/chat/completions", () => sse(["Hi"], "stop"));
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("isSecureContext", true);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await renderReady();
    send("hello");
    await waitFor(() => expect(screen.getByText("Hi")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Copy JSON" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = JSON.parse(String((writeText.mock.calls[0] as unknown[])[0])) as Array<
      Record<string, unknown>
    >;
    // The browser-only timestamp is not part of any request, and the
    // system prompt that rode this one is.
    expect(copied.some((m) => "generatedAt" in m)).toBe(false);
    expect(copied[0]).toEqual({ role: "system", content: "Be brief." });
    expect(copied.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
  });
});

describe("the model going away", () => {
  const TWO = {
    object: "list",
    data: [
      { id: "qwen3-14b", object: "model", created: 0, owned_by: "eugene-plexus" },
      { id: "llama-8b", object: "model", created: 0, owned_by: "eugene-plexus" },
    ],
  };

  it("says so when the chosen model drops out, and names the one that takes over", async () => {
    handlers.set("GET gateway/v1/models", () => json(200, TWO));
    handlers.set("POST gateway/v1/chat/completions", () => sse(["ok"], "stop"));
    await renderReady();

    // The poll comes round and the model this conversation was on is gone.
    handlers.set("GET gateway/v1/models", () => json(200, { object: "list", data: [TWO.data[1]] }));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() =>
      expect(screen.getByTestId("turn-notice")).toHaveTextContent(
        "qwen3-14b is no longer offered, so your next message goes to llama-8b.",
      ),
    );
    send("hello");
    await waitFor(() => expect(chatCalls()).toHaveLength(1));
    expect(chatCalls()[0]!.body!.model).toBe("llama-8b");
  });
});

describe("one turn's numbers", () => {
  it("the bar and the report spell the same total, the same first token and the same window", async () => {
    handlers.set("GET gateway/v1/models", () =>
      json(200, {
        object: "list",
        data: [
          {
            id: "qwen3-14b",
            object: "model",
            created: 0,
            owned_by: "eugene-plexus",
            x_eugene_plexus: { surfaces: ["chat"], context_length: 32768 },
          },
        ],
      }),
    );
    handlers.set("POST gateway/v1/chat/completions", () => {
      const frames = [
        JSON.stringify({ choices: [{ index: 0, delta: { content: "Hi" } }] }),
        JSON.stringify({
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 7 },
          x_eugene_plexus: { driver: "qwen-driver", latency_ms: 2500, context_length: 32768 },
        }),
        "[DONE]",
      ];
      return new Response(frames.map((f) => `data: ${f}\n\n`).join(""), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    await renderReady();
    send("hello");
    await waitFor(() => expect(screen.getByTestId("request-report")).toBeInTheDocument());

    const text = document.body.textContent ?? "";
    // The bar, the report's summary and its timing row: one total.
    const totals = [...text.matchAll(/(\d+\.\d\d s) total/g)].map((m) => m[1]);
    expect(totals.length).toBeGreaterThanOrEqual(3);
    expect(new Set(totals).size).toBe(1);
    // One word for the first token, and no "ms" spelling of any of it.
    expect(text).not.toMatch(/first frame/);
    expect(text).not.toMatch(/\d ms\b/);
    // The gateway's own figure is labelled as the gateway's, in seconds.
    expect(text).toContain("2.50 s at the gateway");
    // The window reads one way wherever it is shown.
    expect(text).toContain("32,768 ctx");
    expect(text).not.toContain("32768 ctx");
  });
});
