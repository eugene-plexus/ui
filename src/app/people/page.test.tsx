/**
 * The People page, driven.
 *
 * `lib/people.ts` is pure and tested on its own; this is the wiring: that
 * every read and write goes to the control root with the body the root
 * expects, that a new app's secret is shown once and then nowhere, and
 * that a root that cannot answer says why.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PeoplePage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/people",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div data-testid="shell">{children}</div>,
}));

type Handler = (body?: unknown) => { status: number; body?: unknown };
let handlers: Map<string, Handler>;
let calls: { key: string; body: unknown }[];

const ADA = {
  id: "p-ada",
  name: "Ada",
  displayName: "Ada Lovelace",
  email: "ada@example.org",
  apps: null,
  permissionsInEffect: ["add-job-sites", "use-job-sites"],
  disabled: false,
  createdAt: "2026-10-01T00:00:00Z",
  passwordChangedAt: "2026-10-01T00:00:00Z",
};
const WORKBENCH = {
  clientId: "c-workbench",
  name: "Workbench",
  redirectUris: ["http://127.0.0.1:8190/oidc/callback"],
  owner: "app:workbench@box",
  createdAt: "2026-10-01T00:00:00Z",
};
const SECRET = "the-secret-shown-once-and-never-again";

beforeEach(() => {
  window.history.replaceState(null, "", "/people");
  calls = [];
  handlers = new Map<string, Handler>([
    [
      "GET control/v1/people",
      () => ({ status: 200, body: { people: [ADA], operatorName: "operator" } }),
    ],
    [
      "GET control/v1/sites",
      () => ({
        status: 200,
        body: {
          sites: [
            { id: "s-1", label: "One", owner: "p-ada", ownerName: "Ada" },
            { id: "s-2", label: "Two", owner: "p-ada", ownerName: "Ada" },
          ],
          installMode: "production",
        },
      }),
    ],
    ["GET control/v1/permission-groups", () => ({ status: 200, body: { groups: [] } })],
    ["GET control/v1/oidc/clients", () => ({ status: 200, body: { clients: [WORKBENCH] } })],
    ["POST control/v1/people", () => ({ status: 201, body: { ...ADA, id: "p-new" } })],
    ["PATCH control/v1/people/p-ada", () => ({ status: 200, body: { ...ADA, disabled: true } })],
    ["PUT control/v1/people/p-ada/password", () => ({ status: 204 })],
    [
      "POST control/v1/oidc/clients",
      () => ({
        status: 201,
        body: {
          client: {
            clientId: "c-made",
            name: "Open WebUI",
            redirectUris: ["http://192.168.1.5:3000/oauth/oidc/callback"],
            createdAt: "2026-10-01T00:00:00Z",
          },
          clientSecret: SECRET,
        },
      }),
    ],
    ["DELETE control/v1/oidc/clients/c-workbench", () => ({ status: 204 })],
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

async function openAda() {
  await userEvent.click(await screen.findByRole("link", { name: "Manage Ada" }));
}

describe("people", () => {
  it("lists each person with their state and apps", async () => {
    render(<PeoplePage />);
    await openAda();
    const row = await screen.findByTestId("person-Ada", {}, { timeout: 5000 });
    expect(within(row).getByTestId("person-state-Ada")).toHaveTextContent("Can sign in");
    expect(within(row).getByTestId("person-apps-Ada")).toHaveTextContent("Every app");
    expect(screen.getByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: "Turn signing in off for Ada" }),
    ).toBeInTheDocument();
  });

  it("shows account and permission editors immediately, with account actions separate", async () => {
    render(<PeoplePage />);
    await openAda();
    const details = screen.getByRole("region", { name: "Account details" });
    expect(within(details).getByLabelText("Email for Ada")).toBeVisible();
    const access = screen.getByRole("region", { name: "Groups and app access" });
    expect(within(access).getByRole("radio", { name: "Individual access" })).toBeVisible();
    expect(within(access).getByRole("checkbox", { name: /Every app/ })).toBeVisible();
    expect(within(access).getByRole("checkbox", { name: /Follow the install/ })).toBeVisible();
    const administration = screen.getByRole("region", { name: "Administration permissions" });
    expect(
      within(administration).getByRole("checkbox", { name: /^Manage accounts/ }),
    ).toBeVisible();
    const actions = screen.getByRole("region", { name: "Account actions" });
    expect(within(actions).getByLabelText("New password for Ada")).toBeVisible();
    expect(
      within(actions).getByRole("button", { name: "Turn signing in off for Ada" }),
    ).toBeVisible();
    expect(within(actions).getByRole("button", { name: "Delete Ada" })).toBeVisible();
    // A help disclosure may contain prose, but no editor should be hidden inside one.
    expect(
      screen.getByTestId("person-Ada").querySelector("details input, details button"),
    ).toBeNull();
  });

  it.each([
    [
      "days",
      "Their chats, notes and documents in Workbench are kept hidden for 30 days, then deleted.",
    ],
    ["none", "Their chats, notes and documents in Workbench are deleted now, within the hour."],
  ])(
    "Delete account says what Workbench does with their data when it keeps it %s",
    async (retention, words) => {
      handlers.set("GET agent/v1/node", () => ({ status: 200, body: { name: "box" } }));
      handlers.set("GET agent/v1/apps/workbench/config", () => ({
        status: 200,
        body: { removedPeopleRetention: retention, removedPeopleDays: 30 },
      }));
      render(<PeoplePage />);
      await openAda();
      const actions = screen.getByRole("region", { name: "Account actions" });
      await waitFor(() =>
        expect(calls.map((c) => c.key)).toContain("GET agent/v1/apps/workbench/config"),
      );
      await userEvent.click(within(actions).getByRole("button", { name: "Delete Ada" }));
      expect(await within(actions).findByText(new RegExp(words.replace(".", "\\.")))).toBeVisible();
    },
  );

  it("keeps a rejected password reset available to retry and reports success only after saving", async () => {
    handlers.set("PUT control/v1/people/p-ada/password", () => ({
      status: 503,
      body: { detail: "Try again" },
    }));
    render(<PeoplePage />);
    await openAda();
    const password = screen.getByLabelText("New password for Ada");
    await userEvent.type(password, "a-new-password-1");
    await userEvent.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByText("Try again")).toBeVisible();
    expect(password).toHaveValue("a-new-password-1");
    expect(screen.queryByText("Password updated.")).not.toBeInTheDocument();
    handlers.set("PUT control/v1/people/p-ada/password", () => ({ status: 204 }));
    await userEvent.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByText("Password updated.")).toBeVisible();
    expect(password).toHaveValue("");
  });

  it("shows how many job sites a person owns, linking to them, and no folder access", async () => {
    render(<PeoplePage />);
    await openAda();
    const row = await screen.findByTestId("person-Ada", {}, { timeout: 5000 });
    const sites = await within(row).findByText("2 job sites");
    expect(sites).toHaveAttribute("href", "/sites?owner=p-ada");
    expect(row).toHaveAttribute("id", "person-p-ada");
    // The Files on your machines section is gone (J19, J20).
    expect(screen.queryByText("Files on your machines")).toBeNull();
    expect(screen.queryByText(/Folder access for/)).toBeNull();
  });

  it("says a person with no job sites has none, and survives a root that lists none", async () => {
    handlers.set("GET control/v1/sites", () => ({ status: 503, body: { detail: "locked" } }));
    render(<PeoplePage />);
    await openAda();
    const row = await screen.findByTestId("person-Ada", {}, { timeout: 5000 });
    expect(within(row).getByTestId("person-sites-Ada")).toHaveTextContent("None");
  });

  it("adds a person for every app unless apps are chosen", async () => {
    render(<PeoplePage />);
    await screen.findByTestId("people-add", {}, { timeout: 5000 });
    await userEvent.click(within(screen.getByTestId("people-add")).getByText("Add a person"));
    await userEvent.type(screen.getByTestId("people-add-name"), "Grace");
    await userEvent.type(screen.getByTestId("people-add-password"), "short");
    expect(screen.getByTestId("people-add-submit")).toBeDisabled();
    await userEvent.type(screen.getByTestId("people-add-password"), "-but-long-now");
    await userEvent.click(screen.getByTestId("people-add-submit"));
    await waitFor(() => expect(sent("POST control/v1/people")).toHaveLength(1));
    expect(sent("POST control/v1/people")[0]).toEqual({
      name: "Grace",
      password: "short-but-long-now",
      apps: null,
    });
  });

  it("turns signing in off and sets a new password through the root", async () => {
    render(<PeoplePage />);
    await openAda();
    await userEvent.click(await screen.findByTestId("person-toggle-Ada", {}, { timeout: 5000 }));
    await waitFor(() =>
      expect(sent("PATCH control/v1/people/p-ada")).toEqual([{ disabled: true }]),
    );
    const password = screen.getByTestId("person-password-Ada");
    await userEvent.type(
      within(password).getByLabelText("New password for Ada"),
      "a-new-password-1",
    );
    await userEvent.click(within(password).getByText("Set password"));
    await waitFor(() =>
      expect(sent("PUT control/v1/people/p-ada/password")).toEqual([
        { password: "a-new-password-1" },
      ]),
    );
  });

  it("adds a person with an email, and refuses one that is not an address (C4)", async () => {
    render(<PeoplePage />);
    await screen.findByTestId("people-add", {}, { timeout: 5000 });
    await userEvent.click(within(screen.getByTestId("people-add")).getByText("Add a person"));
    await userEvent.type(screen.getByTestId("people-add-name"), "Grace");
    await userEvent.type(screen.getByTestId("people-add-password"), "long-enough-password");
    await userEvent.type(screen.getByTestId("people-add-email"), "not an address");
    expect(screen.getByTestId("people-add-submit")).toBeDisabled();
    expect(screen.getByText("That does not look like an email address.")).toBeInTheDocument();
    await userEvent.clear(screen.getByTestId("people-add-email"));
    await userEvent.type(screen.getByTestId("people-add-email"), "grace@example.org");
    await userEvent.click(screen.getByTestId("people-add-submit"));
    await waitFor(() => expect(sent("POST control/v1/people")).toHaveLength(1));
    expect(sent("POST control/v1/people")[0]).toEqual({
      name: "Grace",
      password: "long-enough-password",
      apps: null,
      email: "grace@example.org",
    });
  });

  it("sets a person's email, and clears it with null", async () => {
    render(<PeoplePage />);
    await openAda();
    const change = await screen.findByTestId("person-change-email-Ada", {}, { timeout: 5000 });
    expect(screen.getByTestId("person-email-Ada")).toHaveTextContent("ada@example.org");
    const box = within(change).getByLabelText("Email for Ada");
    await userEvent.clear(box);
    await userEvent.type(box, "ada@new.example");
    await userEvent.click(within(change).getByText("Save email"));
    await userEvent.click(within(change).getByText("Remove email"));
    await waitFor(() =>
      expect(sent("PATCH control/v1/people/p-ada")).toEqual([
        { email: "ada@new.example" },
        { email: null },
      ]),
    );
  });

  it("says what a person may do with job sites, from the defaults, linking to them", async () => {
    render(<PeoplePage />);
    await openAda();
    const line = await screen.findByTestId("person-permissions-Ada", {}, { timeout: 5000 });
    expect(screen.getByTestId("person-permissions-text-Ada")).toHaveTextContent(
      "add machines; use job sites as themselves",
    );
    expect(line).toHaveTextContent("the install’s defaults");
    expect(within(line).getByRole("link")).toHaveAttribute(
      "href",
      "/config?sel=control#peopleMayAddJobSites",
    );
  });

  it("sets a person's own job-site permissions, and returns them to the defaults", async () => {
    render(<PeoplePage />);
    await openAda();
    const choose = await screen.findByTestId(
      "person-choose-permissions-Ada",
      {},
      { timeout: 5000 },
    );
    await userEvent.click(within(choose).getByLabelText(/Follow the install/));
    await userEvent.click(within(choose).getByLabelText(/Add machines of their own/));
    await userEvent.click(within(choose).getByText("Save job-site permissions"));
    await userEvent.click(within(choose).getByLabelText(/Follow the install/));
    await userEvent.click(within(choose).getByText("Save job-site permissions"));
    await waitFor(() =>
      expect(sent("PATCH control/v1/people/p-ada")).toEqual([
        { permissions: ["use-job-sites"] },
        { permissions: null },
      ]),
    );
  });

  it("limits a person to the apps ticked", async () => {
    render(<PeoplePage />);
    await openAda();
    const choose = await screen.findByTestId("person-choose-apps-Ada", {}, { timeout: 5000 });
    await userEvent.click(within(choose).getByLabelText(/Every app/));
    await userEvent.click(within(choose).getByLabelText("Workbench"));
    await userEvent.click(within(choose).getByText("Save apps"));
    await waitFor(() =>
      expect(sent("PATCH control/v1/people/p-ada")).toEqual([{ apps: ["c-workbench"] }]),
    );
  });
});

describe("apps that sign in with Eugene", () => {
  it("shows a new app's secret once, and then nowhere", async () => {
    render(<PeoplePage />);
    const add = await screen.findByTestId("sign-in-app-add", {}, { timeout: 5000 });
    await userEvent.click(within(add).getByText("Add another app"));
    await userEvent.type(screen.getByTestId("sign-in-app-name"), "Open WebUI");
    await userEvent.type(screen.getByTestId("sign-in-app-addresses"), "/callback");
    expect(screen.getByTestId("sign-in-app-submit")).toBeDisabled();
    await userEvent.clear(screen.getByTestId("sign-in-app-addresses"));
    await userEvent.type(
      screen.getByTestId("sign-in-app-addresses"),
      "http://192.168.1.5:3000/oauth/oidc/callback",
    );
    await userEvent.click(screen.getByTestId("sign-in-app-submit"));
    expect(await screen.findByTestId("sign-in-app-secret")).toHaveTextContent(SECRET);
    expect(screen.getByRole("button", { name: "Copy client ID" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy client secret" })).toBeInTheDocument();
    expect(sent("POST control/v1/oidc/clients")).toEqual([
      { name: "Open WebUI", redirectUris: ["http://192.168.1.5:3000/oauth/oidc/callback"] },
    ]);
    // Opening a person's settings must not discard a newly issued app secret.
    await openAda();
    expect(screen.getByTestId("sign-in-app-secret")).not.toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: /Back to people/ }));
    expect(screen.getByTestId("sign-in-app-secret")).toBeVisible();
    expect(screen.getByTestId("sign-in-app-secret")).toHaveTextContent(SECRET);
    await userEvent.click(screen.getByText("I have copied it"));
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("says an installed app's registration came from its install", async () => {
    render(<PeoplePage />);
    const row = await screen.findByTestId("sign-in-app-c-workbench", {}, { timeout: 5000 });
    expect(row).toHaveTextContent("installed on box");
    expect(row).toHaveTextContent("c-workbench");
  });

  it("gives the address this page was opened at, and links to where one is set", async () => {
    render(<PeoplePage />);
    const address = await screen.findByTestId("people-sign-in-address", {}, { timeout: 5000 });
    expect(within(address).getByTestId("people-sign-in-address-url")).toHaveTextContent(
      `${window.location.origin}/oidc`,
    );
    expect(within(address).getByRole("link")).toHaveAttribute("href", "/config?sel=control");
  });
});

it("says why when the root cannot answer", async () => {
  handlers.set("GET control/v1/people", () => ({
    status: 503,
    body: { detail: { title: "Locked", detail: "The control root is locked. Sign in again." } },
  }));
  render(<PeoplePage />);
  expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent(/locked/i);
});

describe("shared permission groups", () => {
  const group = {
    id: "g-builders",
    name: "Builders",
    description: "Shared access",
    apps: [WORKBENCH.clientId],
    permissions: ["use-job-sites"],
    createdAt: ADA.createdAt,
    updatedAt: ADA.createdAt,
  };

  it("creates a group with explicit selected grants, then assigns it", async () => {
    const user = userEvent.setup();
    let groups: (typeof group)[] = [];
    handlers.set("GET control/v1/permission-groups", () => ({ status: 200, body: { groups } }));
    handlers.set("POST control/v1/permission-groups", () => {
      groups = [group];
      return { status: 201, body: group };
    });
    render(<PeoplePage />);
    await user.click(await screen.findByRole("button", { name: "Add group" }));
    await user.type(screen.getByLabelText("Group name"), "Builders");
    await user.click(screen.getByLabelText("Workbench"));
    await user.click(screen.getByRole("button", { name: "Create group" }));
    await waitFor(() =>
      expect(sent("POST control/v1/permission-groups")).toEqual([
        { name: "Builders", description: "", apps: [WORKBENCH.clientId], permissions: [] },
      ]),
    );
    await openAda();
    const row = within(screen.getByTestId("person-Ada"));
    await user.click(row.getByLabelText("Use permission groups"));
    expect(row.getByText(/No groups selected/)).toBeVisible();
    await user.click(row.getByRole("checkbox", { name: "Builders" }));
    await user.click(row.getByRole("button", { name: "Save access" }));
    await waitFor(() =>
      expect(sent("PATCH control/v1/people/p-ada")).toContainEqual({ groups: [group.id] }),
    );
  });

  it("shows effective group access and hides inactive individual settings", async () => {
    handlers.set("GET control/v1/permission-groups", () => ({
      status: 200,
      body: { groups: [group] },
    }));
    handlers.set("GET control/v1/people", () => ({
      status: 200,
      body: { people: [{ ...ADA, groups: [group.id], appsInEffect: [], permissionsInEffect: [] }] },
    }));
    render(<PeoplePage />);
    await openAda();
    const row = within(await screen.findByTestId("person-Ada"));
    expect(row.getByTestId("person-apps-Ada")).toHaveTextContent("No apps");
    expect(row.getByTestId("person-permissions-Ada")).toHaveTextContent("Nothing (from groups)");
    expect(row.queryByTestId("person-choose-permissions-Ada")).not.toBeInTheDocument();
    expect(screen.getByTestId("protected-owner")).not.toBeVisible();
  });

  it("shows the policies in effect for a person and the groups that set them", async () => {
    const desk = { ...group, id: "g-desk", name: "Desk" };
    handlers.set("GET control/v1/permission-groups", () => ({
      status: 200,
      body: {
        groups: [
          { ...group, policies: { queueBand: "background", summaryContextPercent: null } },
          { ...desk, policies: { queueBand: "background", summaryContextPercent: 85 } },
        ],
      },
    }));
    handlers.set("GET control/v1/people", () => ({
      status: 200,
      body: {
        people: [
          {
            ...ADA,
            groups: [group.id, desk.id],
            appsInEffect: [],
            permissionsInEffect: [],
            policiesInEffect: {
              queueBand: "background",
              summaryContextPercent: 85,
              setBy: { queueBand: [group.id, desk.id], summaryContextPercent: [desk.id] },
            },
          },
        ],
      },
    }));
    render(<PeoplePage />);
    await openAda();
    const row = within(await screen.findByTestId("person-Ada"));
    expect(row.getByTestId("person-queue-Ada")).toHaveTextContent(
      "Queue priority: Background (from Builders, Desk)",
    );
    expect(row.getByTestId("person-summary-Ada")).toHaveTextContent(
      "Summarise long chats at: 85% (from Desk)",
    );
  });

  it("says Not set when no group of theirs sets a policy", async () => {
    handlers.set("GET control/v1/people", () => ({
      status: 200,
      body: { people: [{ ...ADA, policiesInEffect: {} }] },
    }));
    render(<PeoplePage />);
    await openAda();
    const ada = within(await screen.findByTestId("person-Ada"));
    expect(ada.getByTestId("person-queue-Ada")).toHaveTextContent("Queue priority: Not set");
    expect(ada.getByTestId("person-summary-Ada")).toHaveTextContent(
      "Summarise long chats at: Not set",
    );
  });

  it("says nothing about policies for an older root, which has none", async () => {
    render(<PeoplePage />);
    await openAda();
    const ada = within(await screen.findByTestId("person-Ada"));
    expect(ada.queryByTestId("person-queue-Ada")).not.toBeInTheDocument();
    expect(ada.queryByTestId("person-summary-Ada")).not.toBeInTheDocument();
  });

  it("saves an empty selection explicitly and can restore individual policy", async () => {
    const user = userEvent.setup();
    handlers.set("GET control/v1/permission-groups", () => ({
      status: 200,
      body: { groups: [group] },
    }));
    render(<PeoplePage />);
    await openAda();
    const row = within(await screen.findByTestId("person-Ada"));
    await user.click(row.getByLabelText("Use permission groups"));
    await user.click(row.getByRole("button", { name: "Save access" }));
    await waitFor(() =>
      expect(sent("PATCH control/v1/people/p-ada")).toContainEqual({ groups: [] }),
    );
    await user.click(row.getByLabelText("Individual access"));
    await user.click(row.getByRole("button", { name: "Save access" }));
    await waitFor(() =>
      expect(sent("PATCH control/v1/people/p-ada")).toContainEqual({ groups: null }),
    );
  });

  it("reports a group fetch failure without exposing assignment controls", async () => {
    handlers.set("GET control/v1/permission-groups", () => ({
      status: 503,
      body: { detail: "Root unavailable" },
    }));
    render(<PeoplePage />);
    await screen.findByRole("link", { name: "Manage Ada" });
    expect(screen.getByText(/Groups could not be loaded/)).toHaveTextContent("Root unavailable");
    expect(screen.getByRole("button", { name: "Add group" })).toBeDisabled();
    await openAda();
    expect(screen.getByText(/Permission groups could not be loaded/)).toBeVisible();
    expect(screen.queryByRole("group", { name: "Access source" })).not.toBeInTheDocument();
  });
});
