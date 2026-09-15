/**
 * Adding an app you already run, driven.
 *
 * The logic is the wizard's former backend step, so the assertion that
 * matters is the same one its test made: the *sequence of calls*. The
 * defect this flow was built against was a PATCH to a driver that did not
 * exist, which silently did nothing on every fresh install; the sequence
 * below is what makes it exist first. Plus the banned-word check, because
 * the page is reached from Home and Home's words are the person's.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AddBackendPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/backends/add",
  useSearchParams: () => new URLSearchParams(),
}));

// The shell's own fetches would only add noise to the recorder; its
// selection of the install root for this route is asserted in
// `navigation.test.ts`.
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div data-testid="shell">{children}</div>,
}));

interface Call {
  method: string;
  route: string;
  body: Record<string, unknown> | undefined;
}

type Handler = () => { status: number; body?: unknown };

let calls: Call[];
let handlers: Map<string, Handler>;

/** A set-up one-box install with no drivers, and an Ollama running beside it. */
function installWithOllama(): Map<string, Handler> {
  return new Map<string, Handler>([
    ["GET agent/v1/auth/status", () => ({ status: 200, body: { initialized: true } })],
    ["GET agent/v1/config", () => ({ status: 200, body: { firstRunComplete: true } })],
    [
      "GET agent/v1/components",
      () => ({
        status: 200,
        body: {
          components: [
            { name: "control", kind: "control", url: "http://127.0.0.1:8083/" },
            { name: "gateway", kind: "gateway", url: "http://127.0.0.1:8080/" },
            { name: "library", kind: "library", url: "http://127.0.0.1:8082/" },
          ],
        },
      }),
    ],
    ["POST agent/v1/components", () => ({ status: 201, body: {} })],
    ["PATCH ollama/v1/config", () => ({ status: 200, body: {} })],
    ["POST agent/v1/components/ollama/restart", () => ({ status: 200, body: {} })],
    [
      "GET ollama/v1/config/schema",
      () => ({
        status: 200,
        body: {
          fields: [
            { key: "provider" },
            { key: "modelId", suggestions: ["qwen3-coder:30b", "nomic-embed-text"] },
          ],
        },
      }),
    ],
  ]);
}

function key(call: Call): string {
  return `${call.method} ${call.route}`;
}

beforeEach(() => {
  const recorder: Call[] = [];
  const routes = installWithOllama();
  calls = recorder;
  handlers = routes;
  sessionStorage.clear();
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

const BANNED = ["declaration", "companion", "topology", "operator", "runtime", "trust root"];

function expectPlainWords() {
  const text = (screen.getByTestId("backends-add").textContent ?? "").toLowerCase();
  for (const word of BANNED) {
    expect(text, `the page's visible text contains "${word}"`).not.toContain(word);
  }
}

describe("/backends/add", () => {
  it("creates the driver before configuring it, and lands on the model picker", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AddBackendPage />);

    await screen.findByRole("heading", { name: "Add an app you already run" });
    expectPlainWords();

    // Nothing to add until an app is chosen.
    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox", { name: "Which app" }), "ollama_local");
    expect(add).toBeEnabled();
    await user.click(add);

    await screen.findByRole("heading", { name: "Which model?" });
    expect(screen.getByRole("option", { name: "qwen3-coder:30b" })).toBeInTheDocument();
    expectPlainWords();

    // The order that makes the app exist before anything is asked of it.
    const sequence = calls
      .map(key)
      .filter((k) => !k.startsWith("GET agent/v1/auth") && k !== "GET agent/v1/config");
    expect(sequence).toEqual([
      "GET agent/v1/components",
      "POST agent/v1/components",
      "PATCH ollama/v1/config",
      "POST agent/v1/components/ollama/restart",
      "GET ollama/v1/config/schema",
    ]);
    const created = calls.find((c) => key(c) === "POST agent/v1/components");
    expect(created?.body).toEqual({
      name: "ollama",
      kind: "inference-driver",
      // Below the range the agent allocates companions from, and the
      // first free one on an install with no drivers.
      url: "http://127.0.0.1:8081",
      spawn: { configFile: "ollama.yaml" },
    });
    const configured = calls.find((c) => key(c) === "PATCH ollama/v1/config");
    expect(configured?.body).toEqual({ provider: "ollama_local" });
  });

  it("saves the chosen model, restarts, and points at Inference", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AddBackendPage />);
    await user.selectOptions(
      await screen.findByRole("combobox", { name: "Which app" }),
      "ollama_local",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByRole("heading", { name: "Which model?" });

    // No model, no Save: a saved empty id is an app that answers nothing.
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Model"), "qwen3-coder:30b");
    expect(save).toBeEnabled();
    await user.click(save);

    const done = await screen.findByTestId("backend-added");
    expect(done).toHaveTextContent("ollama is added and answers for qwen3-coder:30b");
    expect(within(done).getByRole("link", { name: "See it on Inference" })).toHaveAttribute(
      "href",
      "/inference",
    );
    expectPlainWords();

    const patches = calls.filter((c) => key(c) === "PATCH ollama/v1/config").map((c) => c.body);
    expect(patches).toEqual([{ provider: "ollama_local" }, { modelId: "qwen3-coder:30b" }]);
    // Two restarts: one so the provider takes, one so the model does.
    expect(calls.filter((c) => key(c) === "POST agent/v1/components/ollama/restart")).toHaveLength(
      2,
    );
  });

  it("names the app when it cannot be added, and stays on the form", async () => {
    handlers.set("POST agent/v1/components", () => ({
      status: 409,
      body: { detail: { title: "Conflict", detail: "a component named ollama already exists" } },
    }));
    const user = userEvent.setup({ delay: null });
    render(<AddBackendPage />);
    await user.selectOptions(
      await screen.findByRole("combobox", { name: "Which app" }),
      "ollama_local",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(document.querySelector(".status-error")).toHaveTextContent(
        /Local — Ollama could not be added/,
      ),
    );
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(calls.map(key)).not.toContain("PATCH ollama/v1/config");
  });
});
