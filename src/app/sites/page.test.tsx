/**
 * The Job sites page, driven.
 *
 * Membership only in production (J19): a site's folders are its owner's and
 * are not rendered at all unless the root sent a `dev` section, which it
 * does only in dev mode (J33). Every request goes to the control root.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SitesPage from "./page";

let query = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/sites",
  useSearchParams: () => new URLSearchParams(query),
}));

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div data-testid="shell">{children}</div>,
}));

type Handler = (body?: unknown) => { status: number; body?: unknown };
let handlers: Map<string, Handler>;
let calls: { key: string; body: unknown }[];

const NOW = Date.now();
const ONLINE = {
  id: "s-aaaaaaaaaaaaaaaaaaaaaaaaaa",
  label: "Amish_Station",
  owner: "p-troy",
  ownerName: "troy",
  online: true,
  lastContactAt: new Date(NOW - 5_000).toISOString(),
  ready: true,
  hostVersion: "0.1.0",
  hostNode: "Amish_Station",
  enrolledAt: "2026-10-06T00:00:00Z",
  dev: null,
};
const OFFLINE = {
  id: "s-bbbbbbbbbbbbbbbbbbbbbbbbbb",
  label: "Work laptop",
  owner: "p-ada",
  ownerName: "ada",
  online: false,
  lastContactAt: new Date(NOW - 3 * 3_600_000).toISOString(),
  ready: true,
  hostVersion: "0.1.0",
  hostNode: null,
  enrolledAt: "2026-10-06T00:00:00Z",
  dev: null,
};
const DEV = {
  ownerInDevMode: false,
  folders: [
    {
      id: "f1",
      name: "SecretNotes",
      path: "C:/Users/troy/SecretNotes",
      writable: true,
      ownerAccess: "none",
    },
  ],
  servers: [
    {
      id: "files",
      name: "Files",
      kind: "files",
      system: false,
      enabled: true,
      available: true,
      tools: [],
    },
  ],
};
const PEOPLE = {
  people: [
    { id: "p-troy", name: "troy", displayName: "Troy", disabled: false },
    { id: "p-ada", name: "ada", disabled: false },
    { id: "p-off", name: "gone", disabled: true },
  ],
  operatorName: "operator",
};
const INVITATION = {
  id: "inv-1",
  token: "eyJ.site.token",
  expiresAt: new Date(NOW + 15 * 60_000).toISOString(),
  owner: "p-ada",
  ownerName: "ada",
  label: "work-laptop",
  joinUrl: "https://nodes.example.org:8443",
  rootKey: "AbC+/def=",
};

let sites: Record<string, unknown>[];
let joinUrl: string | null;

beforeEach(() => {
  query = "";
  calls = [];
  sites = [ONLINE, OFFLINE];
  joinUrl = null;
  handlers = new Map<string, Handler>([
    [
      "GET control/v1/sites",
      () => ({ status: 200, body: { sites, installMode: "production", joinUrl } }),
    ],
    ["GET control/v1/people", () => ({ status: 200, body: PEOPLE })],
    [
      "GET control/v1/nodes",
      () => ({
        status: 200,
        body: { nodes: [{ name: "root", role: "control", url: "http://192.168.1.20:8079" }] },
      }),
    ],
    ["POST control/v1/sites/invitations", () => ({ status: 201, body: INVITATION })],
    [`DELETE control/v1/sites/${OFFLINE.id}`, () => ({ status: 204 })],
    [`PATCH control/v1/sites/${ONLINE.id}/folders/f1`, () => ({ status: 200, body: ONLINE })],
  ]);
  sessionStorage.clear();
  sessionStorage.setItem("eugene-session-token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const route = String(input).replace(/^\/api\/proxy\//, "");
      const key = `${init?.method ?? "GET"} ${route}`;
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ key, body });
      const handler = handlers.get(key);
      const result = handler
        ? handler(body)
        : { status: 418, body: { detail: `unhandled: ${key}` } };
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

function sent(key: string): unknown[] {
  return calls.filter((c) => c.key === key).map((c) => c.body);
}

describe("job sites, in production (membership only)", () => {
  it("lists each site with owner, state, version and the machine it runs on", async () => {
    render(<SitesPage />);
    const online = await screen.findByTestId(`site-${ONLINE.id}`, {}, { timeout: 5000 });
    expect(online).toHaveTextContent("Amish_Station");
    expect(within(online).getByTestId(`site-state-${ONLINE.id}`)).toHaveTextContent("Online");
    expect(within(online).getByTestId(`site-version-${ONLINE.id}`)).toHaveTextContent("0.1.0");
    // The owner links to that person on People.
    expect(within(online).getByTestId(`site-owner-${ONLINE.id}`)).toHaveAttribute(
      "href",
      "/people#person-p-troy",
    );
    // "Runs on" links to the node under Machines.
    const host = within(online).getByTestId(`site-host-${ONLINE.id}`);
    expect(host).toHaveTextContent("runs on Amish_Station");
    expect(within(host).getByRole("link")).toHaveAttribute(
      "href",
      "/nodes?sel=agent%3AAmish_Station",
    );

    const offline = screen.getByTestId(`site-${OFFLINE.id}`);
    expect(within(offline).getByTestId(`site-state-${OFFLINE.id}`)).toHaveTextContent(
      /Offline, last contact 3 h/,
    );
    expect(within(offline).queryByTestId(`site-host-${OFFLINE.id}`)).toBeNull();
  });

  it("renders no folder, path or server when the root sent no dev section", async () => {
    // Even if a folder name were somewhere in the body, production shows none.
    sites = [{ ...ONLINE, dev: null, folders: [{ name: "SecretNotes" }] }, OFFLINE];
    render(<SitesPage />);
    await screen.findByTestId(`site-${ONLINE.id}`, {}, { timeout: 5000 });
    expect(document.body.textContent).not.toContain("SecretNotes");
    expect(screen.queryByText(/Dev mode only/)).toBeNull();
    expect(screen.queryByTestId(`site-dev-${ONLINE.id}`)).toBeNull();
  });

  it("removes a site only after asking, without a browser dialog", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    render(<SitesPage />);
    const user = userEvent.setup();
    await screen.findByTestId(`site-${OFFLINE.id}`, {}, { timeout: 5000 });
    await user.click(screen.getByTestId(`site-remove-${OFFLINE.id}`));
    expect(sent(`DELETE control/v1/sites/${OFFLINE.id}`)).toHaveLength(0);
    await user.click(screen.getByTestId(`site-remove-${OFFLINE.id}-confirm`));
    await waitFor(() => expect(sent(`DELETE control/v1/sites/${OFFLINE.id}`)).toHaveLength(1));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("filters to one site from a ?sel= link, and to one owner from ?owner=", async () => {
    query = `sel=${encodeURIComponent(`site:${OFFLINE.id}`)}`;
    const first = render(<SitesPage />);
    await screen.findByTestId(`site-${OFFLINE.id}`, {}, { timeout: 5000 });
    expect(screen.queryByTestId(`site-${ONLINE.id}`)).toBeNull();
    expect(screen.getByTestId("sites-filter")).toHaveTextContent("Showing one job site");
    first.unmount();

    query = "owner=p-troy";
    render(<SitesPage />);
    await screen.findByTestId(`site-${ONLINE.id}`, {}, { timeout: 5000 });
    expect(screen.queryByTestId(`site-${OFFLINE.id}`)).toBeNull();
    expect(screen.getByTestId("sites-filter")).toBeInTheDocument();
  });
});

describe("inviting a job site", () => {
  async function invite(label?: string) {
    const user = userEvent.setup();
    render(<SitesPage />);
    const owner = await screen.findByTestId("site-invite-owner", {}, { timeout: 5000 });
    await waitFor(() => expect(within(owner).getAllByRole("option").length).toBeGreaterThan(1));
    // A person whose sign-in is off cannot own one.
    expect(within(owner).queryByText("gone")).toBeNull();
    expect(screen.getByTestId("site-invite-submit")).toBeDisabled();
    await user.selectOptions(owner, "p-ada");
    if (label) await user.type(screen.getByTestId("site-invite-label"), label);
    await user.click(screen.getByTestId("site-invite-submit"));
    return user;
  }

  it("shows one line per shell, naming the owner, the root's key and the machine name", async () => {
    await invite("work-laptop");
    const windows = await screen.findByTestId("site-command-windows");
    const posix = screen.getByTestId("site-command-posix");
    expect(sent("POST control/v1/sites/invitations")).toEqual([
      { owner: "p-ada", label: "work-laptop" },
    ]);
    expect(windows.textContent).toContain("-Join https://nodes.example.org:8443");
    expect(windows.textContent).toContain("-Token eyJ.site.token");
    expect(windows.textContent).toContain("-JobSite -Owner ada -RootKey AbC+/def=");
    expect(windows.textContent).toMatch(/-NodeName work-laptop$/);
    expect(posix.textContent).toContain("--join https://nodes.example.org:8443");
    expect(posix.textContent).toContain("--job-site --owner ada --root-key AbC+/def=");
    expect(posix.textContent).toMatch(/--name work-laptop$/);
    for (const block of [windows, posix]) expect(block.textContent).not.toContain("\n");
    // What it does and who confirms, in plain words.
    const box = screen.getByTestId("site-invitation");
    expect(box).toHaveTextContent("already one of your machines");
    expect(box).toHaveTextContent("without installing Eugene again");
    expect(box).toHaveTextContent("ada confirms on that machine");
    expect(box).toHaveTextContent("Workbench (Job sites)");
  });

  it("leaves the machine name off when none is given", async () => {
    handlers.set("POST control/v1/sites/invitations", () => ({
      status: 201,
      body: { ...INVITATION, label: null },
    }));
    await invite();
    const windows = await screen.findByTestId("site-command-windows");
    expect(sent("POST control/v1/sites/invitations")).toEqual([{ owner: "p-ada" }]);
    expect(windows.textContent).not.toContain("-NodeName");
  });

  it("uses the typed control address when the root names none, and warns on loopback", async () => {
    handlers.set("POST control/v1/sites/invitations", () => ({
      status: 201,
      body: { ...INVITATION, joinUrl: null },
    }));
    const user = await invite();
    // The guess starts from this install's own machine, on the control port.
    const field = (await screen.findByTestId("site-invite-url")) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe("http://192.168.1.20:8083"));
    const windows = await screen.findByTestId("site-command-windows");
    expect(windows.textContent).toContain("-Join http://192.168.1.20:8083");
    await user.clear(field);
    await user.type(field, "http://127.0.0.1:8083");
    expect(await screen.findByTestId("site-loopback")).toBeInTheDocument();
  });

  it("does not ask for an address when the root already knows one", async () => {
    joinUrl = "https://nodes.example.org:8443";
    render(<SitesPage />);
    await screen.findByTestId("site-invite-owner", {}, { timeout: 5000 });
    await screen.findByTestId(`site-${ONLINE.id}`, {}, { timeout: 5000 });
    expect(screen.queryByTestId("site-invite-url")).toBeNull();
  });
});

describe("job sites, in dev mode", () => {
  beforeEach(() => {
    sites = [{ ...ONLINE, dev: DEV }, OFFLINE];
  });

  it("shows a labelled dev section with the folders, servers and the owner's line", async () => {
    render(<SitesPage />);
    const dev = await screen.findByTestId(`site-dev-${ONLINE.id}`, {}, { timeout: 5000 });
    expect(dev).toHaveTextContent("Dev mode only");
    expect(dev).toHaveTextContent("SecretNotes");
    expect(dev).toHaveTextContent("C:/Users/troy/SecretNotes");
    expect(dev).toHaveTextContent("Files (files, on)");
    expect(within(dev).getByTestId(`site-closed-${ONLINE.id}`)).toHaveTextContent(
      "troy has not let Eugene's owner in",
    );
    // A site with no dev section stays membership only beside it.
    expect(screen.queryByTestId(`site-dev-${OFFLINE.id}`)).toBeNull();
  });

  it("says when the machine has not reported, and nothing once the owner let them in", async () => {
    sites = [{ ...ONLINE, dev: { ...DEV, ownerInDevMode: null } }];
    const first = render(<SitesPage />);
    expect(
      await screen.findByTestId(`site-closed-${ONLINE.id}`, {}, { timeout: 5000 }),
    ).toHaveTextContent("has not said yet");
    first.unmount();
    sites = [{ ...ONLINE, dev: { ...DEV, ownerInDevMode: true } }];
    render(<SitesPage />);
    await screen.findByTestId(`site-dev-${ONLINE.id}`, {}, { timeout: 5000 });
    expect(screen.queryByTestId(`site-closed-${ONLINE.id}`)).toBeNull();
  });

  it("sets Eugene's owner's own access with a PATCH", async () => {
    render(<SitesPage />);
    const user = userEvent.setup();
    const select = await screen.findByLabelText(
      "Your access to SecretNotes on Amish_Station",
      {},
      { timeout: 5000 },
    );
    await user.selectOptions(select, "write");
    await waitFor(() =>
      expect(sent(`PATCH control/v1/sites/${ONLINE.id}/folders/f1`)).toEqual([
        { ownerAccess: "write" },
      ]),
    );
  });
});
