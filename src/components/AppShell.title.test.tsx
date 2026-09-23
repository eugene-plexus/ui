/**
 * The tab title, driven through the shell that sets it.
 *
 * `pageTitle` is pure and tested beside itself. What it cannot cover is
 * the half that was actually missing until 2026-09-17 — that anything
 * hands it a page name and a machine at all — and the half most likely to
 * be wrong now: **which** machine. A shell passing this console's own
 * host where the selection names another would print the same title on
 * two `/config` tabs addressing two different boxes, which is the exact
 * complaint, and every case in `pageTitle.test.ts` would stay green.
 *
 * So this drives `AppShell` against a fetched topology, the way a page
 * does, and reads `document.title`.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell";

let pathname = "/discover";
let search = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => search,
}));

// The header's own background pollers are not what this is about, and
// each one is driven by its own suite.
vi.mock("./TasksTray", () => ({ TasksTray: () => null }));
vi.mock("./IssuesBadge", () => ({ IssuesBadge: () => null }));
vi.mock("./RunDialog", () => ({ RunDialog: () => null }));

type Handler = () => { status: number; body?: unknown };
let handlers: Map<string, Handler>;

function ok(body: unknown) {
  return { status: 200, body };
}

/** One box, unenrolled: the commonest install there is. */
function standalone(): Map<string, Handler> {
  return new Map<string, Handler>([
    [
      "agent/v1/components",
      () =>
        ok({
          components: [
            { name: "gateway", kind: "gateway" },
            { name: "library", kind: "library" },
            { name: "control", kind: "control" },
          ],
        }),
    ],
    ["agent/v1/node", () => ok({ enrolled: false })],
    ["control/v1/components", () => ({ status: 503, body: { detail: "no root" } })],
    ["control/v1/nodes", () => ({ status: 503, body: { detail: "no root" } })],
  ]);
}

/** Troy's install: a containerised root on the NAS, one GPU worker. */
function twoMachines(): Map<string, Handler> {
  const map = standalone();
  map.set("agent/v1/node", () => ok({ enrolled: true, name: "nas" }));
  map.set("control/v1/nodes", () => ok({ nodes: [{ name: "nas" }, { name: "Amish_Station" }] }));
  map.set("control/v1/components", () =>
    ok({
      components: [
        { name: "gateway", kind: "gateway", node: "nas" },
        { name: "library", kind: "library", node: "nas" },
        { name: "control", kind: "control", node: "nas" },
      ],
    }),
  );
  return map;
}

beforeEach(() => {
  pathname = "/discover";
  search = new URLSearchParams();
  handlers = standalone();
  document.title = "Eugene Plexus";
  sessionStorage.clear();
  localStorage.clear();
  sessionStorage.setItem("eugene-session-token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const route =
        String(input)
          .replace(/^[/]api[/]proxy[/]/, "")
          .split("?")[0] ?? "";
      const handler = handlers.get(route);
      const result = handler ? handler() : { status: 418, body: { detail: `?? ${route}` } };
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

async function titleFor(): Promise<string> {
  render(
    <AppShell>
      <p>page</p>
    </AppShell>,
  );
  // The topology arrives after hydration, so wait for the shell to be
  // showing it rather than for a timer.
  await screen.findByTestId("page-menu", {}, { timeout: 5000 });
  await waitFor(() => expect(document.title).not.toBe("Eugene Plexus"));
  return document.title;
}

describe("one machine", () => {
  it("opens the glossary from The system and returns focus when closed", async () => {
    await titleFor();
    const toggle = screen.getByRole("button", { name: "The system" });
    fireEvent.click(toggle);
    const panel = screen.getByTestId("layer-map");
    expect(within(panel).getByText("Glossary · 12 terms")).toBeVisible();
    expect(within(panel).getAllByRole("term", { hidden: true })).toHaveLength(12);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("layer-map")).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });
  it("returns focus to the tree toggle when the drawer closes by Escape or backdrop", async () => {
    await titleFor();
    const toggle = screen.getByTestId("tree-drawer-toggle");
    fireEvent.click(toggle);
    expect(screen.getByTestId("tree-drawer")).toBeInTheDocument();
    screen.getByRole("button", { name: "Close the install tree" }).focus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("tree-drawer")).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();

    fireEvent.click(toggle);
    const backdrop = screen.getByRole("button", { name: "Close the install tree" });
    backdrop.focus();
    fireEvent.click(backdrop);
    expect(screen.queryByTestId("tree-drawer")).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });
  it("names the page and nothing else", async () => {
    // On the commonest install the host is the same on every tab, so it
    // is noise that costs the page name its room.
    expect(await titleFor()).toBe("Discover · Eugene Plexus");
  });
});

describe("more than one machine", () => {
  beforeEach(() => {
    handlers = twoMachines();
  });

  it("names this console's host on an install-wide page", async () => {
    // Discover is about the install, not a machine — but two consoles of
    // it, one served by each box, are otherwise identical tabs.
    expect(await titleFor()).toBe("Discover · nas · Eugene Plexus");
  });

  it("names the SELECTED machine, not this console's, on a per-node page", async () => {
    // The case the whole ordering exists for: two Config tabs differ only
    // by the node they address. Reading the console's host here would
    // print "nas" on both.
    pathname = "/config";
    search = new URLSearchParams("sel=agent:Amish_Station");
    expect(await titleFor()).toBe("Config · Amish_Station · Eugene Plexus");
  });

  it("takes the page name from the menu, which knows /config twice over", async () => {
    // `/config` is Preferences under the install root and Config under a
    // component. The screen registry has one entry for the route and
    // would call both of them "Config".
    pathname = "/config";
    search = new URLSearchParams("sel=install");
    expect(await titleFor()).toBe("Preferences · nas · Eugene Plexus");
  });

  it("names a machine under the Library by the page menu's own label", async () => {
    // `/library/folders` is "Folders" in the menu and would be "Library"
    // in the screen registry, which files both Library pages under one
    // href. The menu is asked first for exactly this.
    pathname = "/library/folders";
    search = new URLSearchParams("sel=library:node:Amish_Station");
    expect(await titleFor()).toBe("Folders · Amish_Station · Eugene Plexus");
  });

  it("names a page that is in no menu and no nav group", async () => {
    // `/backends/add` renders under the install root with no menu slot
    // and no screen entry, so both lookups answer null and the title
    // registry answers third. It read as the bare brand before.
    pathname = "/backends/add";
    search = new URLSearchParams();
    expect(await titleFor()).toBe("Add an app you already run · nas · Eugene Plexus");
  });
});
