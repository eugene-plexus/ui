/**
 * An installed app's page: the account it runs as (C1) and whether people
 * sign in to it with Eugene (C2), each with the page that owns the rest.
 */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AppOverviewPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/apps/app",
  useSearchParams: () => new URLSearchParams("sel=app:workbench"),
}));

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div data-testid="shell">{children}</div>,
}));

const APP = {
  id: "workbench",
  name: "Workbench",
  version: "v1",
  origin: "catalogue",
  enabled: true,
  status: "running",
  port: 8190,
  ui: true,
  configTrio: true,
  installedAt: "2026-10-01T00:00:00Z",
  isolation: "own_account",
  account: "NT SERVICE\\EugenePlexusApp-workbench",
};

let app: Record<string, unknown>;

beforeEach(() => {
  app = { ...APP };
  sessionStorage.clear();
  sessionStorage.setItem("eugene-session-token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const route = String(input).replace(/^\/api\/proxy\//, "");
      const body =
        route === "agent/v1/apps/workbench"
          ? app
          : route === "agent/v1/node"
            ? { name: "box", enrolled: true }
            : route === "agent/v1/app-catalogue"
              ? { apps: [], installable: true }
              : null;
      return new Response(JSON.stringify(body ?? { detail: `unhandled: ${route}` }), {
        status: body ? 200 : 418,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the app's page", () => {
  it("says Open opens a new tab, and copies the gateway address it talks to", async () => {
    app = { ...APP, uiUrl: "http://box.lan:8190", gatewayUrl: "http://box.lan:8080" };
    render(<AppOverviewPage />);
    const open = await screen.findByTestId("app-open", {}, { timeout: 5000 });
    expect(open).toHaveAccessibleName(/^Open[ ]+\(opens in a new tab\)$/);
    expect(open.querySelector("[aria-hidden='true']")).toHaveTextContent("↗");
    expect(screen.getByRole("button", { name: /Copy/ })).toBeInTheDocument();
    expect(screen.getByText("http://box.lan:8080")).toBeInTheDocument();
  });

  it("announces what the app last failed with", async () => {
    app = { ...APP, lastError: "it exited with code 1" };
    render(<AppOverviewPage />);
    expect(await screen.findByTestId("app-last-error", {}, { timeout: 5000 })).toHaveAttribute(
      "role",
      "alert",
    );
  });
});

describe("sign-in", () => {
  it("says people sign in with Eugene, and links to who may", async () => {
    app = { ...APP, signIn: true, oidcClientId: "c-workbench" };
    render(<AppOverviewPage />);
    const row = await screen.findByTestId("app-sign-in", {}, { timeout: 5000 });
    expect(row).toHaveTextContent("People sign in to it with Eugene.");
    expect(row.querySelector("a")).toHaveAttribute("href", "/people");
  });

  it("says so when it is not set up yet", async () => {
    app = { ...APP, signIn: true };
    render(<AppOverviewPage />);
    expect(await screen.findByTestId("app-sign-in", {}, { timeout: 5000 })).toHaveTextContent(
      "Not set up yet.",
    );
  });

  it("says nothing for an app that does not sign people in", async () => {
    render(<AppOverviewPage />);
    await screen.findByTestId("app-account", {}, { timeout: 5000 });
    expect(screen.queryByTestId("app-sign-in")).toBeNull();
  });
});
