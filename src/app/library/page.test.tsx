/**
 * The Library's model detail, driven, against a model that is running.
 *
 * Reported from the live install on 2026-09-17: one downloaded model,
 * running on `Amish_Station`, and the page showed **"Needs partial CPU
 * offload"**, **"Will not fit on Amish_Station"** and a full-size
 * **Run** button, with nothing anywhere saying it was up.
 *
 * Both halves were one blind spot — the page joined the library (what is
 * on disk) with the node's engines (what could load it) and never asked
 * that node what it had *loaded*. So these are wiring tests: `runningModel`
 * is pure and covered beside itself, and every case there would stay
 * green with the read removed from this page entirely.
 *
 * The fixture is the live install's shape: a Windows worker with a 5090
 * holding a 27B, whose free VRAM is low **because the model is
 * resident** — which is what made the arithmetic contradict the
 * observation.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LibraryPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/library",
  useSearchParams: () => new URLSearchParams("model=gemma"),
}));

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children, controls }: { children: ReactNode; controls?: ReactNode }) => (
    <div data-testid="shell">
      {controls}
      {children}
    </div>
  ),
}));

const MODEL_PATH = "Y:\\models\\gemma-3-27b-it-Q6_K_L.gguf";
const GIB = 1024 ** 3;

function libraryModel() {
  return {
    id: "gemma",
    path: MODEL_PATH,
    format: "gguf",
    name: "gemma-3-27b-it-Q6_K_L",
    status: "present",
    sizeBytes: 23_800_000_000,
    profileCount: 1,
    gguf: { quantization: "Q6_K_L" },
  };
}

/**
 * The fit as the library computes it with the model already loaded:
 * 22.2 GiB of weights against 5.6 GiB free, because the other 26 are
 * this model. `split` — "needs partial CPU offload" — is the honest
 * answer to the question the library was asked, and the wrong answer to
 * the one the operator is asking.
 */
function fitBody() {
  return {
    fit: {
      verdict: "split",
      requiredBytes: 24 * GIB,
      weightsBytes: 22.2 * GIB,
      kvCacheBytes: 0.8 * GIB,
      overheadBytes: GIB,
      contextLength: 8192,
      basis: "metadata",
      budget: {
        vramFreeBytes: 5.6 * GIB,
        vramTotalBytes: 31.8 * GIB,
        largestGpuFreeBytes: 5.6 * GIB,
        ramAvailableBytes: 58 * GIB,
        ramTotalBytes: 93 * GIB,
        gpuCount: 1,
        source: "detected",
      },
      notes: [],
    },
    maxContextLength: 4096,
    modelContextLength: 131072,
  };
}

function runtime(over: Record<string, unknown> = {}) {
  return {
    name: "gemma-a",
    engine: "llama_cpp",
    modelPath: MODEL_PATH,
    modelAlias: "gemma-3-27b",
    status: "ready",
    driver: "gemma-a-driver",
    ...over,
  };
}

type Result = { status: number; body?: unknown };
type Handler = () => Result;
let handlers: Map<string, Handler>;
let posted: string[];

function ok(body: unknown): Result {
  return { status: 200, body };
}

function install(): Map<string, Handler> {
  return new Map<string, Handler>([
    ["GET agent/v1/node", () => ok({ enrolled: true, name: "Amish_Station", devices: [] })],
    ["GET control/v1/nodes", () => ({ status: 503, body: { detail: "no root" } })],
    ["GET library/v1/models", () => ok({ models: [libraryModel()], lastScanAt: null })],
    ["GET library/v1/scan", () => ok({ state: "idle" })],
    ["GET library/v1/downloads", () => ok({ downloads: [] })],
    ["GET library/v1/models/gemma/fit", () => ok(fitBody())],
    [
      "GET agent/v1/engines",
      () => ok({ engines: [{ engine: "llama_cpp", available: true, modelFormats: ["gguf"] }] }),
    ],
    ["GET agent/v1/runtimes", () => ok({ runtimes: [runtime()] })],
    ["POST agent/v1/runtimes/gemma-a/stop", () => ok({})],
    // The profile editor below the actions.
    ["GET library/v1/models/gemma/profiles", () => ok({ profiles: [] })],
    ["POST agent/v1/runtimes/admission", () => ok({ decision: "admit", fit: "fits" })],
  ]);
}

beforeEach(() => {
  handlers = install();
  posted = [];
  sessionStorage.clear();
  localStorage.clear();
  sessionStorage.setItem("eugene-session-token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const route = String(input).replace(/^[/]api[/]proxy[/]/, "");
      const path = route.split("?")[0] ?? "";
      const method = init?.method ?? "GET";
      if (method !== "GET") posted.push(`${method} ${path}`);
      const handler = handlers.get(`${method} ${path}`);
      const result = handler ? handler() : { status: 418, body: { detail: `?? ${path}` } };
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

async function openTheModel() {
  render(<LibraryPage />);
  // `?model=gemma` selects it, so the detail is what we wait for.
  await screen.findByTestId("model-fit", {}, { timeout: 5000 });
}

describe("a model that is running on the picked node", () => {
  it("says so, instead of offering to start it", async () => {
    await openTheModel();
    const panel = await screen.findByTestId("model-running");
    expect(panel).toHaveTextContent("Running on Amish_Station now");
    expect(panel).toHaveTextContent("gemma-a");
    // The defect, exactly: a full-size Run as the primary action.
    expect(within(screen.getByTestId("model-run")).queryByText("Run")).toBeNull();
  });

  it("does not tell the operator it will not fit on the machine that is running it", async () => {
    await openTheModel();
    const fit = screen.getByTestId("model-fit");
    expect(fit).toHaveAttribute("data-resident", "true");
    // The three headlines that were a contradiction of the observation.
    expect(fit).not.toHaveTextContent("Needs partial CPU offload");
    expect(fit).not.toHaveTextContent("Too large for this node");
    expect(fit).toHaveTextContent("Running on Amish_Station now — it fits");
  });

  it("keeps the arithmetic, and says which question it answers", async () => {
    await openTheModel();
    const fit = screen.getByTestId("model-fit");
    // Not hidden: a 5.6 GiB reading is true, and an expert wants it. It
    // is labelled as being about a SECOND copy, which is what it is once
    // the first is inside the memory it is scored against.
    expect(fit).toHaveTextContent("second");
    expect(fit).toHaveTextContent("A second copy would need");
  });

  it("offers Stop, and stops the runtime the node actually named", async () => {
    await openTheModel();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    });
    await waitFor(() => expect(posted).toContain("POST agent/v1/runtimes/gemma-a/stop"));
  });

  it("keeps a second copy reachable, and out of the primary slot", async () => {
    await openTheModel();
    // `easy-default-expert-override`: the exception is still possible.
    // The disclosure, not the button inside it -- both carry the words.
    const summary = screen.getByText("Run another copy", { selector: "summary" });
    expect(summary.closest("details")?.hasAttribute("open")).toBe(false);
    expect(within(screen.getByTestId("model-running")).getByTestId("run-button")).toBeTruthy();
  });

  it("marks it in the list, so it is visible without clicking", async () => {
    await openTheModel();
    expect(await screen.findByTestId("model-list-running")).toHaveTextContent("running");
  });
});

describe("a model that is not running", () => {
  beforeEach(() => {
    handlers.set("GET agent/v1/runtimes", () => ok({ runtimes: [] }));
  });

  it("offers Run and the plain fit verdict, exactly as before", async () => {
    await openTheModel();
    expect(screen.queryByTestId("model-running")).toBeNull();
    expect(screen.getByTestId("model-fit")).toHaveAttribute("data-resident", "false");
    expect(screen.getByTestId("model-fit")).toHaveTextContent("Needs partial CPU offload");
    expect(await screen.findByTestId("run-button")).toHaveTextContent("Run");
  });

  it("says nothing at all when the node did not answer", async () => {
    // "Did not answer" is not "nothing is running". Collapsing them
    // would put a Run button under a claim this page cannot make — the
    // same distinction the Inference screen draws about devices.
    handlers.set("GET agent/v1/runtimes", () => ({ status: 502, body: null }));
    await openTheModel();
    expect(screen.queryByTestId("model-running")).toBeNull();
    expect(screen.queryByTestId("model-list-running")).toBeNull();
  });
});

describe("a runtime that exists but is stopped", () => {
  beforeEach(() => {
    handlers.set("GET agent/v1/runtimes", () =>
      ok({ runtimes: [runtime({ status: "stopped", stopReason: "idle" })] }),
    );
  });

  it("offers to start it again and says why it stopped", async () => {
    // Settings already chosen, and an idle unload is the system working
    // rather than a fault — a different sentence from a model nobody has
    // ever launched.
    await openTheModel();
    expect(screen.queryByTestId("model-running")).toBeNull();
    expect(await screen.findByTestId("run-button")).toHaveTextContent("Start again");
    expect(screen.getByTestId("model-run")).toHaveTextContent("the gateway unloaded it");
    // Stopped frees the memory, so the prediction is about this model
    // again and is shown plainly.
    expect(screen.getByTestId("model-fit")).toHaveAttribute("data-resident", "false");
  });
});
