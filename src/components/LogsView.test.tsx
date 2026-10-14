/**
 * The Logs page, driven with each machine's reads answered the way the
 * agent answers them (2026-09-27): history, then a follow; every machine
 * on one timeline; a machine that does not answer named with its reason;
 * a source opened from a link; Download.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LogsView } from "./LogsView";
import type { TargetNode } from "@/lib/nodeBudget";

const NAS: TargetNode = {
  name: "NAS",
  label: "NAS",
  local: true,
  target: "agent",
  reachable: true,
  lastError: null,
  budget: null,
};
const AMISH: TargetNode = {
  ...NAS,
  name: "Amish_Station",
  label: "Amish_Station",
  local: false,
  target: "node:Amish_Station",
};

type Pusher = (frame: string) => void;

interface World {
  history: Record<string, unknown>;
  calls: string[];
  push: Record<string, Pusher>;
}

function stub(world: World) {
  const encoder = new TextEncoder();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const route = decodeURIComponent(String(input).replace(/^\/api\/proxy\//, ""));
      world.calls.push(route);
      const [target] = route.split("/v1/");
      if (route.includes("/v1/logs/stream")) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            world.push[target!] = (frame) => controller.enqueue(encoder.encode(frame));
            controller.enqueue(encoder.encode(": following\n\n"));
          },
        });
        return new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      if (route.includes("/v1/logs")) {
        const answer = world.history[target!];
        if (answer instanceof Error) {
          return new Response(
            JSON.stringify({ detail: { title: "Bad gateway", detail: answer.message } }),
            { status: 502, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify(answer), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

function page(lines: [string, string, string][], sources: string[] = []) {
  return {
    lines: lines.map(([time, source, text]) => ({ time, source, text })),
    sources,
    truncated: false,
  };
}

function frame(time: string, source: string, text: string): string {
  return `event: line\ndata: ${JSON.stringify({ time, source, text })}\n\n`;
}

describe("Logs", () => {
  beforeEach(() => sessionStorage.setItem("eugene-session-token", "test-token"));
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("shows a machine's history, then each line as it is written", async () => {
    const world: World = {
      history: {
        agent: page(
          [["2026-09-27T19:00:01.000Z", "gateway", "routing refreshed"]],
          ["agent", "gateway"],
        ),
      },
      calls: [],
      push: {},
    };
    stub(world);
    render(<LogsView machines={[NAS]} loaded everyMachine={false} initialSource={null} />);

    expect(await screen.findByText(/routing refreshed/)).toBeInTheDocument();
    await waitFor(() => expect(world.push.agent).toBeDefined());
    world.push.agent!(
      frame("2026-09-27T19:00:02.000Z", "engine: qwen", "llama_model_load: loaded"),
    );

    expect(await screen.findByText(/llama_model_load: loaded/)).toBeInTheDocument();
    const rows = screen.getAllByTestId("log-line").map((r) => r.textContent);
    expect(rows[0]).toContain("[gateway] routing refreshed");
    expect(rows[1]).toContain("[engine: qwen] llama_model_load: loaded");
  });

  it("keeps a line written while the history was on its way, and shows none twice", async () => {
    const world: World = { history: {}, calls: [], push: {} };
    // The history answers only after the follow has already delivered two
    // lines: one the history also caught, one written after it was read.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    stub(world);
    const original = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/v1/logs?") || String(input).endsWith("/v1/logs")) await gate;
        return original(input, init);
      }),
    );
    world.history.agent = page([["2026-09-27T19:00:01.000Z", "gateway", "both roads"]]);
    render(<LogsView machines={[NAS]} loaded everyMachine={false} initialSource={null} />);
    await waitFor(() => expect(world.push.agent).toBeDefined());
    world.push.agent!(frame("2026-09-27T19:00:01.000Z", "gateway", "both roads"));
    world.push.agent!(frame("2026-09-27T19:00:02.000Z", "gateway", "only followed"));
    await new Promise((r) => setTimeout(r, 50));
    release();

    await screen.findByText(/only followed/);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getAllByTestId("log-line").map((r) => r.textContent)).toEqual([
      expect.stringContaining("both roads"),
      expect.stringContaining("only followed"),
    ]);
  });

  it("puts every machine on one timeline, each line naming its machine", async () => {
    const world: World = {
      history: {
        agent: page([
          ["2026-09-27T19:00:01.000Z", "gateway", "nas first"],
          ["2026-09-27T19:00:03.000Z", "gateway", "nas third"],
        ]),
        "node:Amish_Station": page([["2026-09-27T19:00:02.000Z", "engine: qwen", "amish second"]]),
      },
      calls: [],
      push: {},
    };
    stub(world);
    render(<LogsView machines={[NAS, AMISH]} loaded everyMachine initialSource={null} />);

    await screen.findByText(/amish second/);
    await screen.findByText(/nas third/);
    const rows = screen.getAllByTestId("log-line").map((r) => r.textContent ?? "");
    expect(rows.map((r) => r.replace(/^\S+\s/, ""))).toEqual([
      "NAS [gateway] nas first",
      "Amish_Station [engine: qwen] amish second",
      "NAS [gateway] nas third",
    ]);
  });

  it("names a machine that does not answer, in its own words", async () => {
    const world: World = {
      history: {
        agent: page([["2026-09-27T19:00:01.000Z", "gateway", "fine"]]),
        "node:Amish_Station": new Error("The agent on 'Amish_Station' did not answer"),
      },
      calls: [],
      push: {},
    };
    stub(world);
    render(<LogsView machines={[NAS, AMISH]} loaded everyMachine initialSource={null} />);

    const unanswered = await screen.findByTestId("logs-unanswered");
    expect(unanswered).toHaveTextContent("Amish_Station");
    expect(unanswered).toHaveTextContent("did not answer");
    expect(await screen.findByText(/fine/)).toBeInTheDocument();
  });

  it("opens on the source a link named, and asks the machine for only that", async () => {
    const world: World = { history: { agent: page([], ["engine: qwen"]) }, calls: [], push: {} };
    stub(world);
    render(<LogsView machines={[NAS]} loaded everyMachine={false} initialSource="engine: qwen" />);

    await waitFor(() => expect(world.calls.some((c) => c.startsWith("agent/v1/logs?"))).toBe(true));
    const sourcesOf = (prefix: string) =>
      new URLSearchParams(world.calls.find((c) => c.startsWith(prefix))!.split("?")[1]).getAll(
        "source",
      );
    expect(sourcesOf("agent/v1/logs?")).toEqual(["engine: qwen"]);
    await waitFor(() =>
      expect(world.calls.some((c) => c.startsWith("agent/v1/logs/stream"))).toBe(true),
    );
    expect(sourcesOf("agent/v1/logs/stream")).toEqual(["engine: qwen"]);
    expect(screen.getByTestId("logs-source")).toHaveValue("engine: qwen");
  });

  it("stops following when Follow is turned off", async () => {
    const world: World = { history: { agent: page([]) }, calls: [], push: {} };
    stub(world);
    render(<LogsView machines={[NAS]} loaded everyMachine={false} initialSource={null} />);
    await waitFor(() =>
      expect(world.calls.filter((c) => c.includes("/v1/logs/stream"))).toHaveLength(1),
    );

    await userEvent.click(screen.getByTestId("logs-follow"));
    await waitFor(() =>
      expect(world.calls.filter((c) => c.startsWith("agent/v1/logs?"))).toHaveLength(2),
    );
    expect(world.calls.filter((c) => c.includes("/v1/logs/stream"))).toHaveLength(1);
  });

  it("downloads what is on screen, full stamps first", async () => {
    const world: World = {
      history: { agent: page([["2026-09-27T19:00:01.000Z", "gateway", "for the bug report"]]) },
      calls: [],
      push: {},
    };
    stub(world);
    let written = "";
    const create = vi.fn((blob: Blob) => {
      void blob.text().then((t) => (written = t));
      return "blob:x";
    });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
    render(<LogsView machines={[NAS]} loaded everyMachine={false} initialSource={null} />);
    await screen.findByText(/for the bug report/);

    await userEvent.click(within(screen.getByTestId("logs-view")).getByTestId("logs-download"));

    await waitFor(() =>
      expect(written).toBe("2026-09-27T19:00:01.000Z [gateway] for the bug report\n"),
    );
  });

  it("is a keyboard-reachable log region with a line count", async () => {
    const world: World = {
      history: {
        agent: page([
          ["2026-09-27T19:00:01.000Z", "gateway", "one"],
          ["2026-09-27T19:00:02.000Z", "gateway", "two"],
        ]),
      },
      calls: [],
      push: {},
    };
    stub(world);
    render(<LogsView machines={[NAS]} loaded everyMachine={false} initialSource={null} />);
    await screen.findByText(/one/);

    const region = screen.getByRole("log");
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveAccessibleName(/Logs on NAS/);
    expect(screen.getByTestId("logs-count")).toHaveTextContent("2 lines");
  });

  it("says no lines yet without a filter, and names the filter when nothing contains it", async () => {
    const world: World = { history: { agent: page([]) }, calls: [], push: {} };
    stub(world);
    render(<LogsView machines={[NAS]} loaded everyMachine={false} initialSource={null} />);
    expect(await screen.findByText("No lines yet.")).toBeInTheDocument();
    expect(screen.queryByTestId("logs-clear-filter")).toBeNull();

    await userEvent.type(screen.getByTestId("logs-filter"), "zzz");
    expect(await screen.findByText(/No line contains “zzz”/)).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("logs-clear-filter"));
    expect(await screen.findByText("No lines yet.")).toBeInTheDocument();
    expect(screen.getByTestId("logs-filter")).toHaveValue("");
  });
});
