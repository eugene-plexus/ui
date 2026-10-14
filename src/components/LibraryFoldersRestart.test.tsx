/**
 * Library -> Folders after a mount changes (2026-09-27).
 *
 * Troy set a folder's Windows mount and read "Nodes pick the change up at
 * their next launch" as "reboot every node". The page now names the
 * running models still on the old file and restarts them from here, and
 * names a machine that could not read the folders at all, with its reason
 * -- the live install's worker could not, and nothing said so.
 *
 * Driven through the page with each read answered as the agent answers it.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LibraryFolders } from "./LibraryFolders";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/library/folders",
  useSearchParams: () => new URLSearchParams(),
}));

const OLD = String.raw`Y:\models\q.gguf`;
const NEW = String.raw`\\192.168.16.252\downloads\models\q.gguf`;
const LOOPBACK =
  "The install's Library could not be found: 'library' runs on node 'NAS', which advertises " +
  "http://127.0.0.1:8079/ -- a loopback address, reachable only from that host.";

interface World {
  opened: string;
  check: Record<string, unknown>;
  calls: string[];
}

function stub(world: World) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const route = String(input).replace(/^\/api\/proxy\//, "");
      const key = `${init?.method ?? "GET"} ${route}`;
      world.calls.push(key);
      let status = 200;
      let body: unknown = {};
      if (key === "GET library/v1/folders") {
        body = {
          folders: [{ path: "/models", mounts: [String.raw`\\192.168.16.252\downloads\models`] }],
        };
      } else if (key === "PATCH library/v1/config") {
        body = { applied: ["modelRoots"], rejected: [] };
      } else if (key.endsWith("/v1/library/folders/check")) {
        body = world.check;
      } else if (key === "GET agent/v1/node") {
        body = { enrolled: false, name: null, devices: [] };
      } else if (key === "GET agent/v1/components") {
        body = { components: [] };
      } else if (key === "GET agent/v1/runtimes") {
        body = {
          runtimes: [
            {
              name: "qwen",
              engine: "llama_cpp",
              modelPath: "/models/q.gguf",
              status: "ready",
              localPath: NEW,
              openedPath: world.opened,
            },
          ],
        };
      } else if (key === "POST agent/v1/runtimes/qwen/restart") {
        // The agent plans the new start at once: the next read shows it.
        world.opened = NEW;
        status = 202;
        body = { scheduled: true, delayMs: 0, message: "" };
      }
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

describe("Library -> Folders, after a mount changes", () => {
  beforeEach(() => {
    sessionStorage.setItem("eugene-session-token", "test-token");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("names the running model on the old file and restarts it from here", async () => {
    const world: World = {
      opened: OLD,
      check: { libraryConsulted: true, folders: [] },
      calls: [],
    };
    stub(world);
    render(<LibraryFolders nodeName={undefined} />);

    const panel = await screen.findByTestId("stale-models");
    expect(panel).toHaveTextContent("One model is still running from the file it opened");
    expect(screen.getByTestId("stale-model")).toHaveTextContent(`qwen`);
    expect(screen.getByTestId("stale-model")).toHaveTextContent(OLD);
    expect(screen.getByTestId("stale-model")).toHaveTextContent(NEW);

    await userEvent.click(screen.getByRole("button", { name: "Restart this model" }));
    await userEvent.click(screen.getByRole("button", { name: "Restart" }));

    await waitFor(() => expect(screen.queryByTestId("stale-models")).toBeNull());
    expect(world.calls).toContain("POST agent/v1/runtimes/qwen/restart");
    expect(screen.getByTestId("stale-restart-note")).toHaveTextContent(
      "The model is loading from the new path.",
    );
  });

  it("lists nothing when every running model is on the file it would open", async () => {
    const world: World = { opened: NEW, check: { libraryConsulted: true, folders: [] }, calls: [] };
    stub(world);
    render(<LibraryFolders nodeName={undefined} />);
    await waitFor(() => expect(world.calls).toContain("GET agent/v1/runtimes"));
    expect(screen.queryByTestId("stale-models")).toBeNull();
  });

  it("names a machine that could not read the folders, in the agent's words", async () => {
    const world: World = {
      opened: NEW,
      check: { libraryConsulted: false, libraryError: LOOPBACK, folders: [] },
      calls: [],
    };
    stub(world);
    render(<LibraryFolders nodeName={undefined} />);

    const unread = await screen.findByTestId("folders-unread");
    expect(unread).toHaveTextContent("could not read these folders, so none of their mounts apply");
    expect(unread).toHaveTextContent("http://127.0.0.1:8079/");
  });

  it("restarts a model on another machine through that machine, from this console", async () => {
    // The NAS's page, Amish_Station's model: Troy's case.
    const calls: string[] = [];
    let opened = OLD;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const route = decodeURIComponent(String(input).replace(/^\/api\/proxy\//, ""));
        const key = `${init?.method ?? "GET"} ${route}`;
        calls.push(key);
        let body: unknown = {};
        if (key === "GET library/v1/folders") body = { folders: [{ path: "/models", mounts: [] }] };
        else if (key.endsWith("/v1/library/folders/check"))
          body = { libraryConsulted: true, folders: [] };
        else if (key === "GET agent/v1/node") body = { enrolled: true, name: "NAS", devices: [] };
        else if (key === "GET control/v1/nodes")
          body = { nodes: [{ name: "NAS" }, { name: "Amish_Station", reachable: true }] };
        else if (key === "GET agent/v1/runtimes") body = { runtimes: [] };
        else if (key === "GET node:Amish_Station/v1/runtimes")
          body = {
            runtimes: [
              {
                name: "qwen",
                engine: "llama_cpp",
                modelPath: "/models/q.gguf",
                status: "ready",
                localPath: NEW,
                openedPath: opened,
              },
            ],
          };
        else if (key === "POST node:Amish_Station/v1/runtimes/qwen/restart") {
          opened = NEW;
          body = { scheduled: true, delayMs: 0, message: "" };
        }
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    render(<LibraryFolders nodeName={undefined} />);

    expect(await screen.findByTestId("stale-model")).toHaveTextContent("qwen on Amish_Station");
    await userEvent.click(screen.getByRole("button", { name: "Restart this model" }));
    await userEvent.click(screen.getByRole("button", { name: "Restart" }));

    await waitFor(() => expect(screen.queryByTestId("stale-models")).toBeNull());
    expect(calls).toContain("POST node:Amish_Station/v1/runtimes/qwen/restart");
    expect(calls.filter((c) => c.startsWith("POST agent/v1/runtimes"))).toEqual([]);
  });

  it("says after a save that the machines have the folders, never to relaunch them", async () => {
    const world: World = { opened: NEW, check: { libraryConsulted: true, folders: [] }, calls: [] };
    stub(world);
    render(<LibraryFolders nodeName={undefined} />);
    const box = await screen.findByLabelText("Mount on Linux and macOS nodes");
    await userEvent.type(box, "/mnt/models");
    await userEvent.click(screen.getByTestId("folders-save"));

    const status = await screen.findByText(/Folders saved/);
    expect(status).toHaveTextContent("Folders saved, and this machine has read them.");
    expect(status.textContent).not.toMatch(/next launch|reboot/i);
  });

  /** A model on OLD until `move()` is called, after which its next start opens NEW. */
  function movingWorld(saveKey: string) {
    const calls: string[] = [];
    let local = OLD;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const route = decodeURIComponent(String(input).replace(/^\/api\/proxy\//, ""));
        const key = `${init?.method ?? "GET"} ${route}`;
        calls.push(key);
        let body: unknown = {};
        if (key === saveKey) {
          local = NEW;
          body = { applied: ["x"], rejected: [] };
        } else if (key === "GET library/v1/folders")
          body = { folders: [{ path: "/models", mounts: [] }] };
        else if (key.endsWith("/v1/library/folders/check"))
          body = { libraryConsulted: true, folders: [] };
        else if (key === "GET agent/v1/node") body = { enrolled: false, name: null, devices: [] };
        else if (key === "GET agent/v1/config") body = { pathMappings: [] };
        else if (key === "GET agent/v1/runtimes")
          body = {
            runtimes: [
              {
                name: "qwen",
                engine: "llama_cpp",
                modelPath: "/models/q.gguf",
                status: "ready",
                localPath: local,
                openedPath: OLD,
              },
            ],
          };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    return calls;
  }

  it("lists a model the moment a folder's save leaves it on the old file", async () => {
    const calls = movingWorld("PATCH library/v1/config");
    render(<LibraryFolders nodeName={undefined} />);
    await waitFor(() => expect(calls).toContain("GET agent/v1/runtimes"));
    expect(screen.queryByTestId("stale-models")).toBeNull();

    await userEvent.type(await screen.findByLabelText("Mount on Linux and macOS nodes"), "/mnt/m");
    await userEvent.click(screen.getByTestId("folders-save"));

    expect(await screen.findByTestId("stale-model")).toHaveTextContent(NEW);
  });

  it("lists a model the moment an override's save leaves it on the old file", async () => {
    const calls = movingWorld("PATCH agent/v1/config");
    render(<LibraryFolders nodeName={null} />);
    await waitFor(() => expect(calls).toContain("GET agent/v1/runtimes"));
    expect(screen.queryByTestId("stale-models")).toBeNull();

    await userEvent.type(await screen.findByTestId("override-input"), String.raw`Z:\m`);
    await userEvent.click(screen.getByTestId("overrides-save"));

    expect(await screen.findByTestId("stale-model")).toHaveTextContent(NEW);
  });
});
