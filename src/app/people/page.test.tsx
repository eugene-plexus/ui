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
  calls = [];
  handlers = new Map<string, Handler>([
    [
      "GET control/v1/people",
      () => ({ status: 200, body: { people: [ADA], operatorName: "operator" } }),
    ],
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

describe("people", () => {
  it("lists each person with their state and apps", async () => {
    render(<PeoplePage />);
    const row = await screen.findByTestId("person-Ada", {}, { timeout: 5000 });
    expect(within(row).getByTestId("person-state-Ada")).toHaveTextContent("Can sign in");
    expect(within(row).getByTestId("person-apps-Ada")).toHaveTextContent("Every app");
    expect(screen.getByText(/You sign in to apps as/)).toHaveTextContent("operator");
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
    await userEvent.click(await screen.findByTestId("person-toggle-Ada", {}, { timeout: 5000 }));
    await waitFor(() =>
      expect(sent("PATCH control/v1/people/p-ada")).toEqual([{ disabled: true }]),
    );
    const password = screen.getByTestId("person-password-Ada");
    await userEvent.click(within(password).getByText("Set a new password"));
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
    const change = await screen.findByTestId("person-change-email-Ada", {}, { timeout: 5000 });
    expect(within(change).getByText("Change email")).toBeInTheDocument();
    expect(screen.getByTestId("person-email-Ada")).toHaveTextContent("ada@example.org");
    await userEvent.click(within(change).getByText("Change email"));
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

  it("limits a person to the apps ticked", async () => {
    render(<PeoplePage />);
    const choose = await screen.findByTestId("person-choose-apps-Ada", {}, { timeout: 5000 });
    await userEvent.click(within(choose).getByText("Choose apps"));
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
    expect(sent("POST control/v1/oidc/clients")).toEqual([
      { name: "Open WebUI", redirectUris: ["http://192.168.1.5:3000/oauth/oidc/callback"] },
    ]);
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
