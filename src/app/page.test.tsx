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

import { resetRunsForTests } from "@/lib/oneClickRun";

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
  resetRunsForTests();
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
      "Find a model that fits this machine and download it into your own folder. Or point Eugene at models you already have.",
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
    expect(
      within(card).getByRole("link", { name: "Add an existing app or subscription" }),
    ).toHaveAttribute("href", "/backends/add");
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
    handlers.set("GET gateway/v1/admin/routing", () => ({
      status: 200,
      body: {
        refreshed_at: "2026-09-20T00:00:00Z",
        slots: [
          {
            model: "qwen3-14b",
            tiers: [{ target: "qwen3-14b", backends: [{ driver: "qwen-driver", eligible: true }] }],
          },
        ],
      },
    }));
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
          { role: "assistant", content: "Hello", generatedAt: expect.any(String) },
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

describe("Home with exactly one model on disk (S3)", () => {
  const ONE = { models: [LIBRARY_WITH_TWO.models[0]] };
  const RUNTIME = "qwen3-14b";

  beforeEach(() => {
    handlers.set("GET library/v1/models", () => ({ status: 200, body: ONE }));
    handlers.set("GET library/v1/models/a/profiles", () => ({
      status: 200,
      body: { profiles: [] },
    }));
    handlers.set("POST agent/v1/runtimes/admission", () => ({
      status: 200,
      body: {
        decision: "admit",
        fit: "fits",
        basis: "metadata",
        reason: "",
        maxContextLength: 32768,
      },
    }));
    handlers.set("POST library/v1/models/a/profiles", () => ({
      status: 201,
      body: {
        id: "p1",
        name: "default",
        default: true,
        engine: "llama_cpp",
        flags: { contextSize: 32768 },
      },
    }));
    handlers.set("GET agent/v1/runtimes", () => ({ status: 200, body: { runtimes: [] } }));
    handlers.set("POST agent/v1/runtimes", () => ({
      status: 201,
      body: { name: RUNTIME, engine: "llama_cpp", modelPath: "/models/a.gguf", status: "starting" },
    }));
    handlers.set(`GET agent/v1/runtimes/${RUNTIME}`, () => ({
      status: 200,
      body: { name: RUNTIME, engine: "llama_cpp", modelPath: "/models/a.gguf", status: "ready" },
    }));
  });

  it("runs it in one click, on this machine, and reports the run in the card", async () => {
    render(<HomePage />);
    const card = await screen.findByTestId("home-first-model");
    await waitFor(() => expect(card).toHaveAttribute("data-state", "none-running"));
    expect(card).toHaveTextContent("Qwen3-14B is on disk and not running.");
    const run = within(card).getByTestId("run-button");
    expect(run).toHaveTextContent("Run Qwen3-14B");
    expect(run).toBeEnabled();
    // The list-of-one link is gone; the Library is the expert path.
    expect(within(card).queryByRole("link", { name: "Choose a model to run" })).toBeNull();
    expect(
      within(card).getByRole("link", { name: "Choose settings in the Library" }),
    ).toHaveAttribute("href", "/library?model=a");
    expectPlainWords();

    fireEvent.click(run);
    const status = await within(card).findByTestId("run-status");
    await waitFor(() => expect(status).toHaveAttribute("data-step", "ready"), { timeout: 5000 });
    expect(status).toHaveTextContent("ready — try it on Home");
    // What went to the agent is the profile editor's own composition,
    // for THIS machine, started.
    const declared = calls.find((c) => key(c) === "POST agent/v1/runtimes");
    expect(declared?.body).toEqual({
      name: RUNTIME,
      engine: "llama_cpp",
      modelPath: "/models/a.gguf",
      flags: { contextSize: 32768 },
      autoStart: true,
    });
    expectPlainWords();
  });

  it("keeps the list link when the one model's format has no engine here", async () => {
    handlers.set("GET library/v1/models", () => ({
      status: 200,
      body: { models: [{ ...LIBRARY_WITH_TWO.models[0], format: "safetensors" }] },
    }));
    render(<HomePage />);
    const card = await screen.findByTestId("home-first-model");
    await waitFor(() => expect(card).toHaveAttribute("data-state", "none-running"));
    expect(within(card).getByRole("link", { name: "Choose a model to run" })).toBeInTheDocument();
    expect(within(card).queryByTestId("run-button")).toBeNull();
  });
});

// --------------------------------------------------------------------- //
// Reach (S5)
// --------------------------------------------------------------------- //

const LOOPBACK_ONLY = {
  enabled: false,
  restartRequired: false,
  proposedUrl: "http://192.168.1.20:8079/",
  boundAddresses: [{ process: "agent", host: "127.0.0.1", port: 8079, reachableOffHost: false }],
  restart: {
    mechanism: "logon_task",
    canSelfRestart: true,
    command: "schtasks ...",
    detail: "This agent starts when you log in.",
  },
  firewall: {
    supported: true,
    enabled: true,
    defaultInbound: "block",
    activeProfiles: ["Private"],
    ports: [],
  },
};

function withReach(reach: unknown) {
  const previous = handlers.get("GET agent/v1/node")!();
  handlers.set("GET agent/v1/node", () => ({
    status: 200,
    body: { ...(previous.body as object), reach },
  }));
}

describe("Reach it from other devices", () => {
  it("offers the address a phone would use, and turning it on asks for the firewall too", async () => {
    withReach(LOOPBACK_ONLY);
    render(<HomePage />);
    const card = await screen.findByTestId("home-reach");
    expect(within(card).getByTestId("reach-headline")).toHaveTextContent(
      "http://192.168.1.20:8079",
    );
    const toggle = within(card).getByTestId("reach-switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expectPlainWords();

    handlers.set("POST agent/v1/node/reach", () => ({
      status: 200,
      body: {
        reach: { ...LOOPBACK_ONLY, enabled: true, restartRequired: true },
        steps: [],
        restarted: false,
      },
    }));
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(calls.some((c) => key(c) === "POST agent/v1/node/reach")).toBe(true),
    );
    // The firewall is asked for in the same click. A person who has said
    // "let my phone reach this" has answered the firewall question too,
    // and making them click twice is the second half they would skip.
    const sent = calls.find((c) => key(c) === "POST agent/v1/node/reach");
    expect(sent?.body).toEqual({ enabled: true, allowFirewall: true });
  });

  it("says the change is half done rather than reporting success", async () => {
    // The state that would otherwise be a silent failure: the setting
    // moved, the agent's socket did not, and every surface looks healthy
    // while the phone still gets connection refused.
    withReach({
      ...LOOPBACK_ONLY,
      enabled: true,
      restartRequired: true,
      advertiseUrl: "http://192.168.1.20:8079/",
    });
    render(<HomePage />);
    const card = await screen.findByTestId("home-reach");
    expect(within(card).getByTestId("reach-headline")).toHaveTextContent("needs to restart");
    expect(within(card).getByTestId("reach-restart")).toBeEnabled();
    expectPlainWords();
  });

  it("says whether Eugene comes back after a reboot, in every state", async () => {
    // **The fixture above supplied `mechanism` from S5 and nothing ever
    // asserted it** -- the producer was right, the consumer did not
    // exist, and every test passed. That is the wiring lesson, and this
    // is the check that would have caught it.
    //
    // It matters because R2.6 changed the answer. A service comes back
    // at boot; the logon task this fixture describes does not, and until
    // now the two were indistinguishable from every screen -- which is
    // how a phone gets connection refused at 7 am with nothing anywhere
    // to explain it.
    withReach({ ...LOOPBACK_ONLY, enabled: true, advertiseUrl: "http://192.168.1.20:8079/" });
    render(<HomePage />);
    const card = await screen.findByTestId("home-reach");
    expect(within(card).getByTestId("reach-starts")).toHaveTextContent("starts when you log in");
  });

  it("says a service comes back before anyone signs in", async () => {
    withReach({
      ...LOOPBACK_ONLY,
      enabled: true,
      advertiseUrl: "http://192.168.1.20:8079/",
      restart: {
        mechanism: "service",
        canSelfRestart: true,
        command: "Restart-Service EugenePlexusAgent",
        detail: "This agent starts at boot, before anyone signs in.",
      },
    });
    render(<HomePage />);
    const card = await screen.findByTestId("home-reach");
    expect(within(card).getByTestId("reach-starts")).toHaveTextContent("before anyone signs in");
  });

  it("says nothing at all rather than inventing how this machine boots", async () => {
    // An agent that did not answer, or a platform nothing here knows.
    // A confident wrong sentence about a reboot is worse than silence:
    // it is the one thing on this card somebody would plan around.
    withReach({
      ...LOOPBACK_ONLY,
      enabled: true,
      advertiseUrl: "http://192.168.1.20:8079/",
      restart: { mechanism: "unknown", canSelfRestart: false },
    });
    render(<HomePage />);
    const card = await screen.findByTestId("home-reach");
    expect(within(card).queryByTestId("reach-starts")).toBeNull();
  });

  it("will not offer to restart an agent nothing would start again", async () => {
    withReach({
      ...LOOPBACK_ONLY,
      enabled: true,
      restartRequired: true,
      advertiseUrl: "http://192.168.1.20:8079/",
      restart: { mechanism: "none", canSelfRestart: false, command: "eugene-plexus-agent" },
    });
    render(<HomePage />);
    const card = await screen.findByTestId("home-reach");
    expect(within(card).queryByTestId("reach-restart")).toBeNull();
    expect(card).toHaveTextContent("cannot restart itself");
    expect(card).toHaveTextContent("eugene-plexus-agent");
  });

  it("names the firewall, and never says restart, when the firewall is what is in the way", async () => {
    withReach({
      ...LOOPBACK_ONLY,
      enabled: true,
      advertiseUrl: "http://192.168.1.20:8079/",
      boundAddresses: [{ process: "agent", host: "0.0.0.0", port: 8079, reachableOffHost: true }],
      firewall: {
        supported: true,
        enabled: true,
        defaultInbound: "block",
        activeProfiles: ["Private"],
        ports: [
          {
            port: 8079,
            verdict: "blocked",
            remedy: 'New-NetFirewallRule -DisplayName "Eugene Plexus" ...',
          },
        ],
      },
    });
    render(<HomePage />);
    const card = await screen.findByTestId("home-reach");
    expect(within(card).getByTestId("reach-headline")).toHaveTextContent("firewall");
    expect(within(card).getByTestId("reach-remedy")).toHaveTextContent("New-NetFirewallRule");
    expect(within(card).queryByTestId("reach-restart")).toBeNull();
    expectPlainWords();
  });

  it("shows the one kind of proof there is, and only when it exists", async () => {
    withReach({
      ...LOOPBACK_ONLY,
      enabled: true,
      advertiseUrl: "http://192.168.1.20:8079/",
      boundAddresses: [{ process: "agent", host: "0.0.0.0", port: 8079, reachableOffHost: true }],
      firewall: { supported: true, ports: [{ port: 8079, verdict: "allowed" }] },
      lastReachedFrom: "192.168.1.55",
      lastReachedAt: new Date().toISOString(),
    });
    render(<HomePage />);
    const card = await screen.findByTestId("home-reach");
    expect(within(card).getByTestId("reach-evidence")).toHaveTextContent("192.168.1.55");
    expectPlainWords();
  });

  it("is absent entirely on an agent that does not report reach", async () => {
    // Every source on Home is soft, and an agent a pin behind is the
    // ordinary case during an upgrade. No card beats a broken one.
    render(<HomePage />);
    await screen.findByTestId("home");
    expect(screen.queryByTestId("home-reach")).toBeNull();
  });
});

describe("the two halves of one setting name each other", () => {
  // `cross-link-related-settings` (Troy, standing). The switch and the
  // agent's Advertise address field are one setting with two front
  // doors, and somebody who stumbles into either should find the other.
  it("the card points at the Config field", async () => {
    withReach(LOOPBACK_ONLY);
    render(<HomePage />);
    const card = await screen.findByTestId("home-reach");
    expect(within(card).getByRole("link", { name: /advertise address/i })).toHaveAttribute(
      "href",
      "/config?sel=agent",
    );
  });
});

describe("Home's Needs attention card (S7)", () => {
  it("says nothing is wrong on a healthy install, once it has looked", async () => {
    render(<HomePage />);
    const card = await screen.findByTestId("home-needs-attention");
    await waitFor(() => expect(card).toHaveAttribute("data-issue-count", "0"));
    expect(card).toHaveTextContent("Nothing.");
  });

  it("carries a real issue through from the poll, not an empty list", async () => {
    // The sabotage this pins: Home can render the card and feed it `[]`
    // forever, and every test of the card itself stays green because the
    // card is fine. This is the one that asserts the wiring.
    handlers.set("GET control/v1/nodes", () => ({
      status: 503,
      body: {
        detail: {
          type: "https://eugeneplexus.com/problems/control#locked",
          title: "Locked",
          status: 503,
          detail: "The control root is sealed.",
        },
      },
    }));
    render(<HomePage />);
    const card = await screen.findByTestId("home-needs-attention");
    await waitFor(() => expect(card).toHaveTextContent("The control root is locked"));
    expect(card).toHaveAttribute("data-issue-count", "1");
    // And the fix is on Home, not behind a link to a screen that cannot
    // load while the root is shut.
    expect(within(card).getByTestId("issues-unlock-submit")).toBeInTheDocument();
  });
});

describe("Home names a component that is down (R1.5, review §6.1 #7)", () => {
  /**
   * **This is the check the finding is about, and it is on the page
   * deliberately.** Take 8080 before the wizard runs and the wizard
   * COMPLETES: the gateway never comes up, Home shows nothing routable,
   * Try it never appears, and the Needs-attention card is empty --
   * because `IssueKind` had no member for a supervised component that
   * is down, although the diagnosis was already on the wire in
   * `Component.lastError` and no golden-path screen rendered it.
   *
   * Driven through the page rather than through `issuesFrom`, because
   * S7 produced the "a component test is not a wiring test" lesson
   * twice in one slice: the reads have to include `/v1/components` for
   * any of this to arrive.
   */
  function crashedGateway(lastError: string) {
    handlers.set("GET agent/v1/components", () => ({
      status: 200,
      body: {
        components: [
          {
            name: "gateway",
            kind: "gateway",
            url: "http://127.0.0.1:8080",
            spawn: { configFile: "/x/gateway.yaml" },
            status: "crashed",
            lastError,
          },
          {
            name: "library",
            kind: "library",
            url: "http://127.0.0.1:8082",
            spawn: { configFile: "/x/library.yaml" },
            status: "running",
          },
        ],
      },
    }));
  }

  it("reports the gateway, with the reason the agent recorded", async () => {
    crashedGateway(
      "exited with code 1: port 8080 is already held by pid 4242 (node.exe). Stop it, or " +
        "point this component at another port.",
    );
    render(<HomePage />);
    const card = await screen.findByTestId("home-needs-attention");
    await waitFor(() => expect(card).toHaveTextContent(/gateway is not running/i));
    expect(card).toHaveTextContent("8080");
    expect(card).toHaveTextContent("pid 4242");
  });

  it("links to the screen that owns the fix", async () => {
    crashedGateway("exited with code 1");
    render(<HomePage />);
    const card = await screen.findByTestId("home-needs-attention");
    await waitFor(() => expect(card).toHaveTextContent(/gateway is not running/i));
    // `IssueRow`'s link is labelled "Go and fix it" for every kind, so
    // the row is found by its kind and the link read out of it.
    const row = card.querySelector('[data-issue-kind="component-down"]');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByRole("link")).toHaveAttribute(
      "href",
      "/config?sel=gateway",
    );
    expect(row).toHaveAttribute("data-issue-severity", "blocking");
  });

  it("says nothing about a component that is merely starting", async () => {
    // Every boot passes through `starting`, so counting it would put a
    // blocking issue on every install for the first few seconds after
    // every restart -- which is how a list becomes one people close.
    handlers.set("GET agent/v1/components", () => ({
      status: 200,
      body: {
        components: [
          {
            name: "gateway",
            kind: "gateway",
            url: "http://127.0.0.1:8080",
            spawn: { configFile: "/x/gateway.yaml" },
            status: "starting",
          },
        ],
      },
    }));
    render(<HomePage />);
    const card = await screen.findByTestId("home-needs-attention");
    await waitFor(() => expect(card).toHaveAttribute("data-issue-count", "0"));
  });
});

describe("unlocking the control root from Home", () => {
  it("clears the issue instead of leaving it on screen until the next poll", async () => {
    // The sabotage this pins: Home can render the card without passing
    // `onFixed`, and the card's own tests stay green because they supply
    // one. The consequence is half a minute of a fixed problem still
    // being reported, which is how people learn to distrust a list.
    let sealed = true;
    handlers.set("GET control/v1/nodes", () =>
      sealed
        ? {
            status: 503,
            body: {
              detail: {
                type: "https://eugeneplexus.com/problems/control#locked",
                title: "Locked",
                status: 503,
              },
            },
          }
        : { status: 200, body: { nodes: [] } },
    );
    handlers.set("POST control/v1/auth/login", () => {
      sealed = false;
      return { status: 200, body: { sessionToken: "fresh" } };
    });

    render(<HomePage />);
    const card = await screen.findByTestId("home-needs-attention");
    await waitFor(() => expect(card).toHaveTextContent("The control root is locked"));

    fireEvent.change(within(card).getByTestId("issues-unlock-passphrase"), {
      target: { value: "the install passphrase" },
    });
    fireEvent.click(within(card).getByTestId("issues-unlock-submit"));

    await waitFor(() => expect(card).toHaveAttribute("data-issue-count", "0"));
    expect(card).toHaveTextContent("Nothing.");
  });
});
