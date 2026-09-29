/**
 * The playground's other doors, driven as a page (`playground-doors.md`).
 *
 * The door libs have their own tests; this is the WIRING a component
 * test cannot prove: that a door appears only when a model serves it,
 * that `?door=` survives the models arriving late, that the form's
 * values reach the request body, and that the answer lands on screen.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PlaygroundPage from "./page";

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/playground",
  useSearchParams: () => nav.params,
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

let calls: Call[];
let handlers: Map<string, (init?: RequestInit) => Response>;

function model(id: string, extra: Record<string, unknown>) {
  return { id, object: "model", created: 0, owned_by: "eugene-plexus", x_eugene_plexus: extra };
}

const CHAT_ONLY = { object: "list", data: [model("qwen3-14b", { surfaces: ["chat"] })] };
const WITH_CODER = {
  object: "list",
  data: [
    model("qwen3-14b", { surfaces: ["chat"] }),
    model("coder", { surfaces: ["chat", "completion"], fill_in_middle: true }),
    model("vcoder", { surfaces: ["completion"], fill_in_middle: false }),
  ],
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sse(frames: unknown[]): Response {
  const body = [...frames.map((f) => `data: ${JSON.stringify(f)}\n\n`), "data: [DONE]\n\n"].join(
    "",
  );
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

beforeEach(() => {
  calls = [];
  nav.params = new URLSearchParams();
  nav.replace.mockReset();
  handlers = new Map([
    ["GET agent/v1/auth/status", () => json(200, { initialized: true })],
    ["GET agent/v1/config", () => json(200, { firstRunComplete: true })],
    ["GET agent/v1/components", () => json(200, { components: [] })],
    ["GET gateway/v1/models", () => json(200, WITH_CODER)],
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
        body:
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : undefined,
      };
      calls.push(call);
      const handler = handlers.get(`${call.method} ${call.route}`);
      if (!handler)
        return json(418, { detail: { title: `unhandled route: ${call.method} ${call.route}` } });
      return handler(init);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function completionCalls(): Call[] {
  return calls.filter((c) => c.method === "POST" && c.route === "gateway/v1/completions");
}

describe("the door picker", () => {
  it("is absent when only chat is served, and the page is the chat it always was", async () => {
    handlers.set("GET gateway/v1/models", () => json(200, CHAT_ONLY));
    render(<PlaygroundPage />);
    await waitFor(() => expect(screen.getByTestId("composer")).not.toBeDisabled());
    expect(screen.queryByTestId("door-picker")).toBeNull();
  });

  it("offers Completions once a model lists the surface, and switching mirrors it in the URL", async () => {
    render(<PlaygroundPage />);
    await waitFor(() => expect(screen.getByTestId("door-completion")).toBeInTheDocument());
    expect(screen.getByTestId("door-chat")).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByTestId("door-completion"));
    expect(screen.getByTestId("completion-door")).toBeInTheDocument();
    expect(screen.queryByTestId("composer")).toBeNull();
    expect(nav.replace).toHaveBeenCalledWith("/playground?door=completion", { scroll: false });

    // Only the models with the surface, not the chat-only one.
    const options = within(screen.getByTestId("door-model"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(["coder · context unknown", "vcoder · context unknown"]);

    fireEvent.click(screen.getByTestId("door-chat"));
    expect(nav.replace).toHaveBeenLastCalledWith("/playground", { scroll: false });
  });

  it("opens ?door=completion once the models arrive, without rewriting the link to chat first", async () => {
    nav.params = new URLSearchParams("door=completion");
    render(<PlaygroundPage />);
    await waitFor(() => expect(screen.getByTestId("completion-door")).toBeInTheDocument());
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

describe("the completions door", () => {
  async function openDoor() {
    nav.params = new URLSearchParams("door=completion");
    render(<PlaygroundPage />);
    await waitFor(() => expect(screen.getByTestId("completion-door")).toBeInTheDocument());
  }

  it("sends the prompt and suffix as typed, and shows the answer in the gap", async () => {
    handlers.set("POST gateway/v1/completions", () =>
      sse([
        { object: "text_completion", model: "coder", choices: [{ index: 0, text: " a" }] },
        { object: "text_completion", model: "coder", choices: [{ index: 0, text: " + b" }] },
        {
          object: "text_completion",
          model: "coder",
          choices: [{ index: 0, text: "", finish_reason: "stop" }],
        },
        {
          object: "text_completion",
          model: "coder",
          choices: [],
          usage: { prompt_tokens: 9, completion_tokens: 4 },
          x_eugene_plexus: { driver: "coder-driver", tier: 1, attempts: 1 },
        },
      ]),
    );
    await openDoor();
    fireEvent.change(screen.getByTestId("completion-prompt"), {
      target: { value: "def add(a, b):\n    return" },
    });
    fireEvent.change(screen.getByTestId("completion-suffix"), {
      target: { value: "\n\nprint(add(1, 2))" },
    });
    fireEvent.click(screen.getByTestId("completion-send"));

    await waitFor(() => expect(screen.getByTestId("completion-answer").textContent).toBe(" a + b"));
    const body = completionCalls()[0]!.body!;
    expect(body).toMatchObject({
      model: "coder",
      prompt: "def add(a, b):\n    return",
      suffix: "\n\nprint(add(1, 2))",
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(screen.getByTestId("completion-result").textContent).toBe(
      "def add(a, b):\n    return a + b\n\nprint(add(1, 2))",
    );
    await waitFor(() =>
      expect(screen.getByTestId("completion-finish").textContent).toContain("Finished."),
    );
    expect(screen.getByTestId("completion-finish").textContent).toContain(
      "4 tokens written from 9 read",
    );
    expect(screen.getByTestId("door-report-summary").dataset.driver).toBe("coder-driver");
  });

  it("warns before sending a suffix to a model that cannot fill the middle, and sends it anyway", async () => {
    handlers.set("POST gateway/v1/completions", () =>
      json(400, {
        error: {
          message: "No backend serving vcoder fills in the middle.",
          type: "invalid_request_error",
          param: "suffix",
        },
      }),
    );
    await openDoor();
    fireEvent.change(screen.getByTestId("door-model"), { target: { value: "vcoder" } });
    fireEvent.change(screen.getByTestId("completion-suffix"), { target: { value: "tail" } });
    expect(screen.getByTestId("completion-warning")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("completion-send"));
    await waitFor(() => expect(completionCalls()).toHaveLength(1));
    expect(completionCalls()[0]!.body).toMatchObject({ model: "vcoder", suffix: "tail" });
    await waitFor(() =>
      expect(screen.getByTestId("completion-error").textContent).toContain("fills in the middle"),
    );
    expect(screen.getByTestId("door-report-summary").dataset.status).toBe("400");
  });

  it("keeps what arrived when a stream stops without finishing, and says it was cut short", async () => {
    handlers.set(
      "POST gateway/v1/completions",
      () =>
        new Response(`data: ${JSON.stringify({ choices: [{ index: 0, text: " half" }] })}\n\n`, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );
    await openDoor();
    fireEvent.click(screen.getByTestId("completion-send"));
    await waitFor(() =>
      expect(screen.getByTestId("completion-error").textContent).toContain("Cut short"),
    );
    expect(screen.getByTestId("completion-answer").textContent).toBe(" half");
  });
});
