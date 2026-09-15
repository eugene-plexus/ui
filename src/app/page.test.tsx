/**
 * Home, driven, in each state a fresh install passes through.
 *
 * `fetch` is mocked at the boundary the api client uses, as the wizard
 * test does, so a call's target reads off the URL. The shell is stubbed
 * to a passthrough: the tree and the page menu have their own tests, and
 * what this file is about is which card Home shows, with which button,
 * in which words — including the words it must NOT use (hobbyist UX
 * §10 trap 1: the banned-word test runs on Home from S1).
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HomePage from "./page";

let replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

// The shell is the tree, the page menu and the header; none of that is
// the subject here, and its own fetches would only add noise to the
// recorder.
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

type Handler = () => { status: number; body?: unknown; raw?: string };

let calls: Call[];
let handlers: Map<string, Handler>;

/** A healthy one-box install with llama.cpp installed and nothing else:
 * the state the wizard leaves behind. Tests override one entry each. */
function freshInstall(): Map<string, Handler> {
  return new Map<string, Handler>([
    ["GET agent/v1/auth/status", () => ({ status: 200, body: { initialized: true } })],
    ["GET agent/v1/config", () => ({ status: 200, body: { firstRunComplete: true } })],
    [
      "GET agent/v1/node",
      () => ({
        status: 200,
        body: {
          enrolled: true,
          name: "Amish_Station",
          devices: [
            {
              kind: "cuda",
              name: "NVIDIA GeForce RTX 5090",
              index: 0,
              memoryTotalBytes: 34190917632,
              memoryFreeBytes: 32446087168,
            },
            { kind: "cpu", name: "AMD64", index: 0, memoryTotalBytes: 100453961728 },
          ],
        },
      }),
    ],
    [
      "GET agent/v1/engines",
      () => ({
        status: 200,
        body: {
          engines: [
            {
              engine: "llama_cpp",
              available: true,
              version: "b10948",
              modelFormats: ["gguf"],
              acquisition: { installable: true },
            },
          ],
        },
      }),
    ],
    ["GET agent/v1/engines/llama_cpp/install", () => ({ status: 404, body: { detail: "none" } })],
    ["GET library/v1/models", () => ({ status: 200, body: { models: [] } })],
    ["GET library/v1/downloads", () => ({ status: 200, body: { downloads: [] } })],
    ["GET library/v1/scan", () => ({ status: 200, body: { state: "done" } })],
    ["GET gateway/v1/models", () => ({ status: 200, body: { object: "list", data: [] } })],
    ["GET gateway/v1/admin/drivers", () => ({ status: 200, body: { drivers: [] } })],
    [
      "GET gateway/v1/admin/routing",
      () => ({ status: 200, body: { slots: [], unreachable_drivers: [] } }),
    ],
    ["GET control/v1/components", () => ({ status: 200, body: { components: [] } })],
    [
      "GET control/v1/runtimes",
      () => ({ status: 200, body: { runtimes: [], unreachableNodes: [] } }),
    ],
  ]);
}

const LIBRARY_WITH_TWO = {
  models: [
    { id: "a", path: "/models/a.gguf", format: "gguf", name: "Qwen3-14B", status: "present" },
    { id: "b", path: "/models/b.gguf", format: "gguf", name: "Gemma", status: "present" },
  ],
};

const ROUTABLE = {
  object: "list",
  data: [
    {
      id: "qwen3-14b",
      object: "model",
      created: 0,
      owned_by: "eugene-plexus",
      x_eugene_plexus: { surfaces: ["chat"], drivers: ["qwen-driver"] },
    },
  ],
};

function key(call: Call): string {
  return `${call.method} ${call.route}`;
}

beforeEach(() => {
  const recorder: Call[] = [];
  const routes = freshInstall();
  calls = recorder;
  handlers = routes;
  replace = vi.fn();
  sessionStorage.clear();
  localStorage.clear();
  // Signed in: the gate otherwise bounces to /login before any card renders.
  sessionStorage.setItem("eugene-session-token", "test-token");

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? "GET",
        route: String(input).replace(/^\/api\/proxy\//, ""),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      recorder.push(call);
      const handler = routes.get(key(call));
      const result = handler
        ? handler()
        : { status: 418, body: { detail: { title: `unhandled route: ${key(call)}` } } };
      if (result.raw !== undefined) {
        return new Response(result.raw, {
          status: result.status,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
        status: result.status,
        statusText: String(result.status),
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Principle P5, enforced: the architecture's nouns do not appear in
 * Home's visible text. "Runtime" may live in a `title` tooltip, which
 * `textContent` does not include — so this reads exactly what a person
 * reads.
 */
const BANNED = [
  "runtime",
  "companion driver",
  "declaration",
  "admission",
  "mint",
  "epoch",
  "advertiseurl",
  "trust root",
  "topology",
  "routing table",
  "control plane",
];

function expectPlainWords() {
  const text = (screen.getByTestId("home").textContent ?? "").toLowerCase();
  for (const word of BANNED) {
    expect(text, `Home's visible text contains "${word}"`).not.toContain(word);
  }
}

describe("Home on a fresh install", () => {
  it("offers the first model, with one primary button and no disabled input", async () => {
    render(<HomePage />);
    const card = await screen.findByTestId("home-first-model");
    expect(card).toHaveAttribute("data-state", "no-models");
    expect(within(card).getByRole("heading")).toHaveTextContent("Get your first model");
    expect(card).toHaveTextContent(
      "Nothing is on disk yet. Find a model to download, or point Eugene at a folder that already has some.",
    );
    expect(within(card).getByRole("link", { name: "Find a model" })).toHaveAttribute(
      "href",
      "/discover",
    );
    expect(within(card).getByRole("link", { name: "I already have models" })).toHaveAttribute(
      "href",
      "/library/folders?sel=library",
    );
    // S2 moved the wizard's backend step out to a page; the card is where
    // a person who runs an Ollama finds it. Third and quiet, so the one
    // primary stays one.
    expect(within(card).getByRole("link", { name: "Add an app you already run" })).toHaveAttribute(
      "href",
      "/backends/add",
    );
    // §0.3: the old landing page was a disabled text box. This one has none.
    expect(screen.queryByTestId("home-try-it")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    expectPlainWords();
  });

  it("describes this machine from four sources, each on its own", async () => {
    render(<HomePage />);
    const strip = await screen.findByTestId("home-machine");
    await waitFor(() => expect(strip).toHaveTextContent("Amish_Station"));
    expect(strip).toHaveTextContent("NVIDIA GeForce RTX 5090 · 34 GB · 32 GB free");
    expect(strip).toHaveTextContent("llama.cpp b10948");
    expect(strip).toHaveTextContent("0 models on disk");
  });

  it("says what is unknown when the agent did not answer, without an error banner", async () => {
    handlers.set("GET agent/v1/node", () => ({ status: 503, body: { detail: "down" } }));
    handlers.set("GET agent/v1/engines", () => ({ status: 503, body: { detail: "down" } }));
    render(<HomePage />);
    const strip = await screen.findByTestId("home-machine");
    await waitFor(() => expect(strip).toHaveTextContent("hardware unknown"));
    expect(strip).toHaveTextContent("This machine");
    expect(strip).toHaveTextContent("engines unknown");
    expect(document.querySelectorAll(".status-error")).toHaveLength(0);
  });
});

describe("Home with models on disk and nothing running", () => {
  it("offers to run one, counting what is on disk", async () => {
    handlers.set("GET library/v1/models", () => ({ status: 200, body: LIBRARY_WITH_TWO }));
    render(<HomePage />);
    const card = await screen.findByTestId("home-first-model");
    await waitFor(() => expect(card).toHaveAttribute("data-state", "none-running"));
    expect(within(card).getByRole("heading")).toHaveTextContent("Run a model");
    expect(card).toHaveTextContent("2 models on disk, none running.");
    expect(within(card).getByRole("link", { name: "Choose a model to run" })).toHaveAttribute(
      "href",
      "/library",
    );
    expect(screen.queryByTestId("home-try-it")).toBeNull();
    expectPlainWords();
  });

  it("shows a download in flight inside the card, with its bar", async () => {
    handlers.set("GET library/v1/models", () => ({ status: 200, body: LIBRARY_WITH_TWO }));
    handlers.set("GET library/v1/downloads", () => ({
      status: 200,
      body: {
        downloads: [
          {
            id: "dl-1",
            state: "downloading",
            repo: "unsloth/Qwen3-14B-GGUF",
            files: [
              { path: "Qwen3-14B-UD-Q6_K_XL.gguf", destinationPath: "", state: "downloading" },
            ],
            bytesTotal: 100,
            bytesDownloaded: 42,
            bytesPerSecond: 38_000_000,
            etaSeconds: 200,
          },
        ],
      },
    }));
    render(<HomePage />);
    const card = await screen.findByTestId("home-first-model");
    const list = await within(card).findByTestId("home-downloads");
    expect(list).toHaveTextContent("Downloading unsloth/Qwen3-14B-GGUF Qwen3-14B-UD-Q6_K_XL.gguf");
    expect(list).toHaveTextContent("42% · 38 MB/s · 3 min left");
    expect(within(list).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
    expectPlainWords();
  });
});

describe("Home when the library is down", () => {
  it("says so in one plain sentence with a way onward, and raises no error banner", async () => {
    handlers.set("GET library/v1/models", () => ({
      status: 503,
      body: { detail: { title: "Service Unavailable", detail: "library restarting" } },
    }));
    render(<HomePage />);
    const card = await screen.findByTestId("home-first-model");
    expect(card).toHaveAttribute("data-state", "library-unreachable");
    expect(card).toHaveTextContent(/the library did not answer/i);
    expect(within(card).getByRole("link", { name: "See what is running" })).toHaveAttribute(
      "href",
      "/inference",
    );
    // The browser arc reads any `.status-error` on landing as a wall of
    // errors; a library mid-restart after sign-in must not be one.
    expect(document.querySelectorAll(".status-error")).toHaveLength(0);
    expect(screen.getByTestId("home-machine")).toHaveTextContent("library did not answer");
    expectPlainWords();
  });
});

describe("Home with a model routable", () => {
  beforeEach(() => {
    handlers.set("GET library/v1/models", () => ({ status: 200, body: LIBRARY_WITH_TWO }));
    handlers.set("GET gateway/v1/models", () => ({ status: 200, body: ROUTABLE }));
  });

  it("replaces the first-model card with Try it, the model already chosen", async () => {
    render(<HomePage />);
    const card = await screen.findByTestId("home-try-it");
    // The two cards swap on separate state updates (models, then the
    // library's answer), so the first-model card can outlive Try it's
    // arrival by a tick; wait for the swap rather than asserting the
    // instant. This assertion was the suite's one flake (1 in 3 runs).
    await waitFor(() => expect(screen.queryByTestId("home-first-model")).toBeNull());
    const picker = within(card).getByTestId("home-model") as HTMLSelectElement;
    await waitFor(() => expect(picker.value).toBe("qwen3-14b"));
    await waitFor(() => expect(within(card).getByTestId("home-composer")).toBeEnabled());
    expect(within(card).getByTestId("home-continue")).toHaveAttribute("href", "/playground");
    expectPlainWords();
  });

  it("remembers the playground's pick when it is still routable", async () => {
    handlers.set("GET gateway/v1/models", () => ({
      status: 200,
      body: {
        ...ROUTABLE,
        data: [...ROUTABLE.data, { ...ROUTABLE.data[0], id: "gemma" }],
      },
    }));
    sessionStorage.setItem("eugene-playground", JSON.stringify({ model: "gemma", messages: [] }));
    render(<HomePage />);
    const picker = (await screen.findByTestId("home-model")) as HTMLSelectElement;
    await waitFor(() => expect(picker.value).toBe("gemma"));
  });

  it("streams a reply and leaves the conversation where the playground reads it", async () => {
    const frames = [
      {
        id: "c1",
        object: "chat.completion.chunk",
        created: 0,
        model: "qwen3-14b",
        choices: [{ index: 0, delta: { role: "assistant", content: "Hel" }, finish_reason: null }],
      },
      {
        id: "c1",
        object: "chat.completion.chunk",
        created: 0,
        model: "qwen3-14b",
        choices: [{ index: 0, delta: { content: "lo" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        x_eugene_plexus: { driver: "qwen-driver", latency_ms: 1234, attempts: 1 },
      },
    ];
    handlers.set("POST gateway/v1/chat/completions", () => ({
      status: 200,
      raw: frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") + "data: [DONE]\n\n",
    }));

    render(<HomePage />);
    const composer = (await screen.findByTestId("home-composer")) as HTMLInputElement;
    await waitFor(() => expect(composer).toBeEnabled());
    fireEvent.change(composer, { target: { value: "Reply with the single word: ok" } });
    fireEvent.submit(composer.closest("form")!);

    const info = await screen.findByTestId("home-turn-info");
    expect(info).toHaveTextContent("qwen3-14b · qwen-driver · 1.2 s");

    // What was sent is what a harness would send: the model, the history,
    // and `stream: true`, through the proxy.
    const sent = calls.find((c) => key(c) === "POST gateway/v1/chat/completions");
    expect(sent?.body).toEqual({
      model: "qwen3-14b",
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      stream: true,
    });

    // The exchange is in the playground's own slot, in the playground's
    // own shape, so "Continue in the Playground" opens this conversation.
    await waitFor(() => {
      const stored = JSON.parse(sessionStorage.getItem("eugene-playground") ?? "null");
      expect(stored).toEqual({
        model: "qwen3-14b",
        messages: [
          { role: "user", content: "Reply with the single word: ok" },
          { role: "assistant", content: "Hello" },
        ],
      });
    });
    expect(screen.getByTestId("home-try-it")).toHaveTextContent("Hello");
    expectPlainWords();
  });
});

describe("Home's Running card", () => {
  it("is absent when nothing is serving", async () => {
    render(<HomePage />);
    await screen.findByTestId("home-first-model");
    expect(screen.queryByTestId("home-running")).toBeNull();
  });

  it("lists what the gateway routes to, by model, machine and state", async () => {
    handlers.set("GET library/v1/models", () => ({ status: 200, body: LIBRARY_WITH_TWO }));
    handlers.set("GET gateway/v1/admin/drivers", () => ({
      status: 200,
      body: {
        drivers: [
          {
            name: "qwen-driver",
            reachable: true,
            backend: "openai_compat_http",
            modelId: "qwen3-14b",
            runtime: "qwen",
          },
        ],
      },
    }));
    handlers.set("GET control/v1/components", () => ({
      status: 200,
      body: {
        components: [{ node: "Amish_Station", name: "qwen-driver", kind: "inference-driver" }],
      },
    }));
    handlers.set("GET control/v1/runtimes", () => ({
      status: 200,
      body: {
        runtimes: [
          {
            node: "Amish_Station",
            name: "qwen",
            modelAlias: "qwen3-14b",
            status: "loading",
            engine: "llama_cpp",
          },
        ],
        unreachableNodes: [],
      },
    }));
    render(<HomePage />);
    const card = await screen.findByTestId("home-running");
    expect(card).toHaveTextContent("qwen3-14b");
    expect(card).toHaveTextContent("Amish_Station");
    expect(card).toHaveTextContent("loading");
    expect(within(card).getByRole("link", { name: "Inference" })).toHaveAttribute(
      "href",
      "/inference",
    );
    expectPlainWords();
  });
});

describe("Home's gate", () => {
  it("sends an uninitialized install to the wizard before rendering anything", async () => {
    handlers.set("GET agent/v1/auth/status", () => ({ status: 200, body: { initialized: false } }));
    render(<HomePage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/setup"));
    expect(screen.queryByTestId("home")).toBeNull();
  });

  it("sends a visitor with no session to sign in", async () => {
    sessionStorage.removeItem("eugene-session-token");
    render(<HomePage />);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?next=/)),
    );
    expect(screen.queryByTestId("home")).toBeNull();
  });
});
