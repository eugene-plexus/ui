/**
 * An app's Settings page, driven.
 *
 * The generic editor's defaults are a component's: `/v1/config` and
 * `/v1/admin/restart` on its target. Pointed at an app's machine with
 * those defaults it would read the AGENT's settings and, on a save that
 * needs a restart, restart the agent. The page's whole job is the
 * `endpoints` that stop that, so that is what these assert.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import AppSettingsPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/apps/settings",
  useSearchParams: () => new URLSearchParams("sel=app:chat@gpu"),
}));

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div data-testid="shell">{children}</div>,
}));

let calls: string[];
let configTrio: boolean;

const APP = {
  id: "chat",
  name: "Chat",
  version: "abc",
  origin: "catalogue",
  enabled: true,
  status: "running",
  port: 8190,
  ui: true,
  uses: ["inference"],
  node: "gpu",
};

beforeEach(() => {
  calls = [];
  configTrio = true;
  sessionStorage.clear();
  sessionStorage.setItem("eugene-session-token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const route = String(input).replace(/^\/api\/proxy\//, "");
      const key = `${init?.method ?? "GET"} ${route}`;
      calls.push(key);
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (key === "GET agent/v1/node") return json({ name: "box", enrolled: true });
      if (key === "GET node:gpu/v1/apps/chat") return json({ ...APP, configTrio });
      if (key === "GET node:gpu/v1/apps/chat/config/schema")
        return json({
          component: "chat",
          fields: [
            {
              key: "searchProvider",
              label: "Search provider",
              category: "search",
              valueType: "string",
              requiresRestart: true,
            },
          ],
        });
      if (key === "GET node:gpu/v1/apps/chat/config") return json({ searchProvider: "searxng" });
      if (key === "PATCH node:gpu/v1/apps/chat/config")
        return json({ applied: ["searchProvider"], rejected: [], requiresRestart: true });
      if (key === "POST node:gpu/v1/apps/chat/restart") return json({ ...APP, configTrio });
      return new Response(JSON.stringify({ detail: `unhandled: ${key}` }), { status: 418 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("edits the app's settings on its own machine, and restarts the app, not the agent", async () => {
  render(<AppSettingsPage />);
  const input = await screen.findByDisplayValue("searxng", {}, { timeout: 5000 });
  fireEvent.change(input, { target: { value: "brave" } });
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(calls).toContain("POST node:gpu/v1/apps/chat/restart"), {
    timeout: 5000,
  });
  expect(calls).toContain("PATCH node:gpu/v1/apps/chat/config");
  expect(calls.some((c) => c.includes("/v1/admin/restart"))).toBe(false);
  expect(calls.some((c) => c.endsWith(" node:gpu/v1/config"))).toBe(false);
  // No Test button: an app has no `/v1/config/test` behind the agent.
  expect(screen.queryByRole("button", { name: "Test" })).not.toBeInTheDocument();
});

it("says so plainly when an app publishes no settings", async () => {
  configTrio = false;
  render(<AppSettingsPage />);
  expect(await screen.findByTestId("app-no-settings", {}, { timeout: 5000 })).toHaveTextContent(
    "does not publish settings",
  );
  expect(calls.some((c) => c.includes("/config"))).toBe(false);
});
