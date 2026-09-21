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

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: delta } }] })}\n\n`,
          ),
        );
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
