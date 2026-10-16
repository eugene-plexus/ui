import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AdministrationPage from "./page";
import type { AdministrationSession, Person } from "@/lib/types";

let session: AdministrationSession;
let people: Person[];
let ended: boolean;
let calls: { path: string; method: string; auth: string | null; body: unknown }[];
const person: Person = {
  id: "ada",
  name: "Ada",
  disabled: false,
  groups: ["outside"],
  createdAt: "2026-10-16T00:00:00Z",
  passwordChangedAt: "2026-10-16T00:00:00Z",
};

beforeEach(() => {
  window.history.replaceState(null, "", "/administration");
  sessionStorage.clear();
  // The directory must never silently spend a stored owner's authority.
  sessionStorage.setItem("eugene-session-token", "owner-token");
  session = {
    personId: "manager",
    name: "Manager",
    owner: false,
    grants: { managePeople: false, manageGroups: false, membershipGroups: ["allowed"] },
  };
  people = [{ ...person }];
  calls = [];
  ended = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const path = String(url).replace("/api/proxy/control", "");
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ path, method, body, auth: new Headers(init.headers).get("authorization") });
      if (ended)
        return new Response(JSON.stringify({ detail: { detail: "Session ended" } }), {
          status: 401,
        });
      if (path === "/v1/auth/administration/login")
        return Response.json({ sessionToken: "named-token", session });
      if (path === "/v1/auth/administration/session") {
        if (method === "DELETE") {
          ended = true;
          return new Response(null, { status: 204 });
        }
        return Response.json(session);
      }
      if (path === "/v1/people") {
        if (method === "POST") people.push({ ...person, id: "new", name: body.name, groups: [] });
        return Response.json({ people });
      }
      if (path === "/v1/people/ada") {
        people = [{ ...people[0], ...body }];
        return Response.json(people[0]);
      }
      if (path === "/v1/permission-groups")
        return Response.json({
          groups: [
            { id: "allowed", name: "Builders", apps: [], permissions: [] },
            { id: "outside", name: "Other group", apps: [], permissions: [] },
          ],
        });
      if (path === "/v1/oidc/clients") return Response.json({ clients: [] });
      throw new Error(`Unexpected ${method} ${path}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function signIn() {
  const user = userEvent.setup();
  render(<AdministrationPage />);
  await user.type(await screen.findByLabelText("Account name"), "Manager");
  await user.type(screen.getByLabelText("Password"), "long password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByText("Signed in as Manager");
  return user;
}

it("uses named credentials and keeps unassigned memberships while limiting the tools", async () => {
  const user = await signIn();
  expect(screen.queryByText("Add a person")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add group" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "Manage Ada" }));
  const choices = screen.getByRole("group", { name: "Groups for Ada" });
  expect(within(choices).getAllByRole("checkbox")).toHaveLength(1);
  expect(within(choices).getByLabelText("Builders")).toBeVisible();
  expect(screen.queryByRole("region", { name: "Account actions" })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Administration permissions" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText("New password for Ada")).not.toBeInTheDocument();
  await user.click(within(choices).getByLabelText("Builders"));
  await user.click(within(choices).getByRole("button", { name: "Save memberships" }));
  await waitFor(() =>
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({
      groups: ["outside", "allowed"],
    }),
  );
  expect(calls.find((c) => c.path.endsWith("/login"))?.auth).toBeNull();
  expect(
    calls.filter((c) => !c.path.endsWith("/login")).every((c) => c.auth === "Bearer named-token"),
  ).toBe(true);
  expect(calls.every((c) => !c.path.includes("config") && !c.path.includes("topology"))).toBe(true);
  await user.click(screen.getByRole("button", { name: "Sign out" }));
  await screen.findByRole("heading", { name: "Administrator sign-in" });
  expect(sessionStorage.getItem("eugene-administration-token")).toBeNull();
  expect(sessionStorage.getItem("eugene-session-token")).toBe("owner-token");
});

it("creates an account without implicitly assigning access", async () => {
  session.grants = { managePeople: true, manageGroups: false, membershipGroups: [] };
  const user = await signIn();
  await user.click(screen.getByText("Add a person"));
  await user.type(screen.getByLabelText("Account name"), "Tom");
  await user.type(screen.getByLabelText("First password"), "a password long enough");
  await user.click(screen.getByRole("button", { name: "Create account" }));
  await screen.findByText(
    "Account created. Find and select the person below to assign group access.",
  );
  expect(calls.find((c) => c.method === "POST" && c.path === "/v1/people")?.body).toEqual({
    name: "Tom",
    password: "a password long enough",
  });
  expect(screen.queryByRole("heading", { name: "Reset password" })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Administration permissions" }),
  ).not.toBeInTheDocument();
});

it("restores only the named session and returns to sign-in after revocation", async () => {
  sessionStorage.setItem("eugene-administration-token", "named-token");
  ended = true;
  render(<AdministrationPage />);
  await screen.findByText("Your administration session ended. Sign in again.");
  expect(sessionStorage.getItem("eugene-administration-token")).toBeNull();
  expect(sessionStorage.getItem("eugene-session-token")).toBe("owner-token");
  expect(screen.queryByRole("group", { name: "Groups for Ada" })).not.toBeInTheDocument();
});

it("does not offer changes to other administrators or individual-access memberships", async () => {
  session.grants.managePeople = true;
  people = [
    {
      ...person,
      administration: { managePeople: false, manageGroups: true, membershipGroups: [] },
    },
    { ...person, id: "tom", name: "Tom", groups: null },
  ];
  const user = await signIn();
  await user.click(screen.getByRole("link", { name: "Manage Ada" }));
  expect(screen.getByText("Protected administrator")).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Groups for Ada" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Disable account" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Back to people/ }));
  await user.click(screen.getByRole("link", { name: "Manage Tom" }));
  expect(screen.queryByRole("group", { name: "Groups for Ada" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Disable account" })).toBeInTheDocument();
});

it("shows permitted account editors without disclosures and keeps destructive actions separate", async () => {
  session.grants.managePeople = true;
  const user = await signIn();
  await user.click(screen.getByRole("link", { name: "Manage Ada" }));
  const details = screen.getByRole("region", { name: "Account details" });
  expect(within(details).getByLabelText("Display name")).toBeVisible();
  await user.type(within(details).getByLabelText("Display name"), "Ada Lovelace");
  await user.click(within(details).getByRole("button", { name: "Save display name" }));
  await waitFor(() =>
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ displayName: "Ada Lovelace" }),
  );
  const actions = screen.getByRole("region", { name: "Account actions" });
  expect(within(actions).getByRole("button", { name: "Disable account" })).toBeVisible();
  expect(within(actions).getByRole("button", { name: "Delete account Ada" })).toBeVisible();
  expect(screen.queryByLabelText("New password for Ada")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Email for Ada")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Administration permissions" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("article").querySelector("details")).toBeNull();
});
