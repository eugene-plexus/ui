/**
 * What the Machines page says, and how often (Troy, 2026-10-13).
 *
 * "Even on the Machines page, I still see several messages I consider too
 * verbose": a driver named twice beside the state it buries, a sentence
 * that two things agree, a wall of commits, a count of parts, and a clause
 * that a lost token is replaced. Each is asserted gone here, and so is
 * what replaced it: the line that leads with the state, and the detail one
 * click away.
 *
 * The rest of the page is driven in `page.test.tsx`; this file brings its
 * own small fake of the root, the gateway and the agents.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NodesPage from "./page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/nodes",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

const NODES = {
  nodes: [
    { name: "unraid", role: "control", reachable: true, url: "http://192.168.16.252:8283" },
    { name: "Amish_Station", role: "worker", reachable: true, url: "http://192.168.16.75:8079" },
  ],
};

const NEWEST = { channel: "edge", ref: "c".repeat(40), components: {} };

/** What one machine says about itself; the update fields are its own. */
function machine(
  name: string,
  commit: string,
  update: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    enrolled: true,
    name,
    os: "linux",
    install: {
      mechanism: "windows_service",
      development: false,
      components: [
        { name: "agent", state: "stamped", commit: commit.repeat(40) },
        { name: "gateway", state: "stamped", commit: commit.repeat(40) },
      ],
    },
    update: {
      enabled: true,
      channel: "edge",
      channelSource: "setting",
      checkedAt: new Date().toISOString(),
      available: false,
      behind: [],
      ahead: [],
      newest: NEWEST,
      apply: { possible: true },
      ...update,
    },
  };
}

interface Served {
  components: unknown[];
  drivers: unknown[];
  runtimes: unknown[];
}

/** The root, the gateway and each agent, answering what a real one would. */
function stub(opts: {
  unraid: Record<string, unknown>;
  amish: Record<string, unknown>;
  served?: Served;
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (url.includes("/node:Amish_Station/v1/node")) return json(opts.amish);
      if (url.includes("/agent/v1/node")) return json(opts.unraid);
      if (url.includes("/v1/components"))
        return json({ components: opts.served?.components ?? [] });
      if (url.includes("/v1/admin/drivers")) return json({ drivers: opts.served?.drivers ?? [] });
      if (url.includes("/v1/runtimes")) return json({ runtimes: opts.served?.runtimes ?? [] });
      if (url.includes("/v1/nodes/join-tokens")) return json({ tokens: [] });
      if (url.includes("/v1/sites")) return json({ sites: [], installMode: "production" });
      if (url.includes("/v1/nodes")) return json(NODES);
      if (url.includes("/v1/control/status")) return json({ role: "control", epoch: 1 });
      return json({});
    }),
  );
}

beforeEach(() => {
  sessionStorage.setItem("eugene-session-token", "test-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Serves", () => {
  it("leads with the model and its state, and does not say a name twice", async () => {
    stub({
      unraid: machine("unraid", "a"),
      amish: machine("Amish_Station", "a"),
      served: {
        components: [
          {
            node: "Amish_Station",
            name: "qwen3-8-flash-next-iq2-xs-driver",
            kind: "inference-driver",
            url: "http://w:8081",
          },
          {
            node: "Amish_Station",
            name: "gpu-box-driver",
            kind: "inference-driver",
            url: "http://w:8082",
          },
          { node: "unraid", name: "anthropic", kind: "inference-driver", url: "http://n:8081" },
        ],
        drivers: [
          {
            name: "qwen3-8-flash-next-iq2-xs-driver",
            url: "http://w:8081",
            reachable: false,
            modelId: "qwen3.8-flash-next-iq2_xs",
            runtime: "qwen3-8-flash-next-iq2-xs",
          },
          {
            name: "gpu-box-driver",
            url: "http://w:8082",
            reachable: true,
            modelId: "llama-3.1-8b",
            runtime: "main",
          },
          {
            name: "anthropic",
            url: "http://n:8081",
            reachable: true,
            account: true,
            modelCount: 12,
          },
        ],
        runtimes: [
          { node: "Amish_Station", name: "qwen3-8-flash-next-iq2-xs", status: "stopped" },
          { node: "Amish_Station", name: "main", status: "ready" },
        ],
      },
    });
    render(<NodesPage />);
    const lines = await screen.findAllByTestId("node-serves");
    const said = lines.map((line) => line.textContent);
    // The model and its state, with the space the old line left out ("iq2_xsvia").
    expect(said).toContain("qwen3.8-flash-next-iq2_xs stopped");
    // A driver that is not just the model's name is named, after the state.
    expect(said).toContain("llama-3.1-8b ready · via gpu-box-driver");
    // An account's driver is its name; there is nothing to add to it.
    expect(said).toContain("anthropic/… (12 models)");
    expect(said.join("\n")).not.toContain("qwen3-8-flash-next-iq2-xs");
    // The plumbing is still there, on hover.
    const stopped = lines.find((line) => line.textContent?.startsWith("qwen3.8"))!;
    expect(stopped).toHaveAttribute(
      "title",
      "driver qwen3-8-flash-next-iq2-xs-driver, runtime qwen3-8-flash-next-iq2-xs",
    );
    expect(within(stopped).getByTestId("node-serves-state")).toHaveTextContent("stopped");
  });
});

describe("Versions", () => {
  it("does not explain that Versions and Needs Attention agree", async () => {
    stub({ unraid: machine("unraid", "a"), amish: machine("Amish_Station", "a") });
    render(<NodesPage />);
    const versions = await screen.findByTestId("node-versions");
    expect(versions).toHaveTextContent("Versions");
    expect(versions.textContent).not.toMatch(/same status/i);
    expect(versions.textContent).not.toMatch(/nothing is installed until/i);
  });

  it("says a machine needs an update on its card, and says nothing about the difference", async () => {
    stub({
      unraid: machine("unraid", "a"),
      amish: machine("Amish_Station", "b", { available: true, behind: ["agent", "gateway"] }),
    });
    render(<NodesPage />);
    const amish = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        '[data-testid="node-update"][data-node="Amish_Station"][data-state="available"]',
      );
      expect(found).not.toBeNull();
      return found!;
    });
    expect(within(amish).getByTestId("node-update-headline")).toHaveTextContent(
      /^Update available$/,
    );
    expect(within(amish).getByTestId("node-update-now")).toBeInTheDocument();
    expect(screen.queryByTestId("version-difference")).toBeNull();
    expect(screen.getByTestId("node-versions").textContent).not.toMatch(
      /different versions|seven|parts of Eugene/,
    );
  });

  it("says nothing about a difference while a machine is updating, and calls the other up to date", async () => {
    stub({
      unraid: machine("unraid", "a"),
      amish: machine("Amish_Station", "b", {
        running: {
          target: NEWEST.ref,
          startedAt: new Date().toISOString(),
          outcome: "running",
        },
      }),
    });
    render(<NodesPage />);
    const amish = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        '[data-testid="node-update"][data-node="Amish_Station"][data-state="running"]',
      );
      expect(found).not.toBeNull();
      return found!;
    });
    expect(within(amish).getByTestId("node-update-headline")).toHaveTextContent(/^Updating/);
    // The commits differ because one machine is on its way to the other's:
    // "No update is offered yet" beside an update that is running would be false.
    const unraid = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        '[data-testid="node-update"][data-node="unraid"][data-state="current"]',
      );
      expect(found).not.toBeNull();
      return found!;
    });
    expect(within(unraid).getByTestId("node-update-headline")).toHaveTextContent(
      "Up to date on edge",
    );
    expect(screen.queryByTestId("version-difference")).toBeNull();
    expect(screen.getByTestId("node-versions").textContent).not.toMatch(
      /different versions|No update is offered yet|No newer update found/,
    );
  });

  it("keeps the commits behind Details, on the notice and on each card", async () => {
    stub({ unraid: machine("unraid", "a"), amish: machine("Amish_Station", "b") });
    render(<NodesPage />);
    const notice = await screen.findByTestId("version-difference");
    // One line of state and one of what to do; nothing else is on the page.
    expect(within(notice).getByText("Machines run different versions")).toBeVisible();
    expect(within(notice).getByText("No update is offered yet.")).toBeVisible();
    expect(within(notice).getByTestId("version-difference-details")).not.toHaveAttribute("open");
    expect(within(notice).getByText(/check again shortly/)).not.toBeVisible();
    expect(
      within(notice).getByText("Amish_Station: agent bbbbbbb, gateway bbbbbbb"),
    ).not.toBeVisible();

    await userEvent.click(within(notice).getByText("Details"));
    expect(within(notice).getByText(/check again shortly/)).toBeVisible();
    expect(within(notice).getByText("unraid: agent aaaaaaa, gateway aaaaaaa")).toBeVisible();

    // Each card holds its own build, closed, and no commit in its status.
    const amish = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        '[data-testid="node-update"][data-node="Amish_Station"]',
      );
      expect(within(found!).getByTestId("node-update-details")).toBeInTheDocument();
      return found!;
    });
    expect(within(amish).getByText("agent bbbbbbb · gateway bbbbbbb")).not.toBeVisible();
    expect(within(amish).getByTestId("node-update-headline").textContent).not.toMatch(/bbbbbbb/);
    expect(amish.querySelector('[data-testid="node-version"]')).toBeNull();
  });
});

describe("Details", () => {
  it("say what they are about to a screen reader, on the notice and on each machine", async () => {
    stub({ unraid: machine("unraid", "a"), amish: machine("Amish_Station", "b") });
    render(<NodesPage />);
    // A page of three "Details" read out one after another is three buttons
    // with the same name: each says whose, and the notice says what.
    const notice = await screen.findByTestId("version-difference");
    const aboutNotice = within(notice).getByText("Details");
    expect(aboutNotice).toHaveTextContent("Details about the version difference");
    expect(aboutNotice.querySelector(".sr-only")).toHaveTextContent("about the version difference");
    for (const name of ["Amish_Station", "unraid"]) {
      const card = await waitFor(() => {
        const found = document.querySelector<HTMLElement>(
          `[data-testid="node-update"][data-node="${name}"]`,
        );
        expect(within(found!).getByTestId("node-update-details")).toBeInTheDocument();
        return found!;
      });
      const toggle = within(card).getByText("Details");
      expect(toggle).toHaveTextContent(`Details about ${name}`);
      // What a sighted person reads has not changed: the one word.
      expect(toggle.firstChild?.textContent).toBe("Details");
    }
  });
});

describe("Add a node", () => {
  it("tells a person how a token works, without saying what follows from it", async () => {
    stub({ unraid: machine("unraid", "a"), amish: machine("Amish_Station", "a") });
    render(<NodesPage />);
    await screen.findByTestId("node-versions");
    expect(screen.getByText(/A token works once and is/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/lost one is replaced/);
  });
});
