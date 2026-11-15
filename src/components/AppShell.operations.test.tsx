/**
 * Row 39: the shell for a person who is not the owner. Their pages only,
 * a line that says who they are and with what, and "Only the owner can do
 * this" on a page their powers have no use for.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { clearOperationsSession, MODELS, setOperationsSession } from "@/lib/operations";
import { AppShell } from "./AppShell";

let pathname = "/";
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push, refresh: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(pathname === "/" ? "sel=install" : ""),
}));
vi.mock("./TasksTray", () => ({ TasksTray: () => null }));
vi.mock("./IssuesBadge", () => ({ IssuesBadge: () => null }));
vi.mock("./RunDialog", () => ({ RunDialog: () => null }));

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  sessionStorage.clear();
  setOperationsSession({ token: "named", name: "Dana", powers: [MODELS] });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/auth/operations-machines"))
        return reply(200, { machines: [{ name: "gpu-a", kinds: ["library"] }] });
      if (url.endsWith("/v1/auth/operations-token"))
        return reply(200, { token: "ops", expiresAt: new Date(Date.now() + 6e5).toISOString() });
      if (url.endsWith("/v1/auth/administration/session") && init?.method === "DELETE")
        return new Response(null, { status: 204 });
      if (url === "/api/proxy/agent/v1/node") return reply(200, { name: "gpu-a" });
      return reply(403, { detail: { detail: "Only the owner can do this." } });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearOperationsSession();
  pathname = "/";
});

it("says who is signed in, and shows only the pages Models uses", async () => {
  render(
    <AppShell>
      <p>page body</p>
    </AppShell>,
  );
  expect(await screen.findByTestId("operations-line")).toHaveTextContent(
    "Signed in as Dana: models",
  );
  const menu = screen.getByTestId("page-menu");
  await waitFor(() => expect(within(menu).queryByText("Home")).not.toBeNull());
  for (const owners of ["Playground", "Apps", "Logs"]) {
    expect(within(menu).queryByText(owners)).toBeNull();
  }
  expect(screen.getByText("page body")).toBeVisible();
});

it("answers a direct link to an owner's page with what is missing", async () => {
  pathname = "/config";
  render(
    <AppShell>
      <p>settings body</p>
    </AppShell>,
  );
  expect(await screen.findByTestId("owners-only")).toHaveTextContent("Only the owner can do this.");
  expect(screen.queryByText("settings body")).toBeNull();
});
