/**
 * The Apps page, driven.
 *
 * `lib/apps.ts` is pure and tested on its own; this is the wiring (a
 * component test is not a wiring test): that installing on another
 * machine goes to THAT machine's agent, that an install is watched to its
 * end, that a node which cannot install says why before anyone clicks,
 * and that the custom-app refusal names the setting that turns it on.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AppsPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/apps",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div data-testid="shell">{children}</div>,
}));

type Handler = (body?: unknown) => { status: number; body?: unknown };
let handlers: Map<string, Handler>;
let calls: string[];

const MANIFEST = {
  id: "chat",
  name: "Chat",
  summary: "A chat app with web search.",
  source: "https://github.com/eugene-plexus/chat/archive/abc.tar.gz",
  version: "abc",
  package: "eugene-plexus-chat",
  entry: "eugene_plexus_chat",
  python: "3.12",
  ui: true,
  configTrio: true,
  uses: ["inference"],
};

function catalogue(installable = true, reason?: string) {
  return {
    status: 200,
    body: { apps: [{ manifest: MANIFEST, origin: "catalogue" }], installable, reason },
  };
}

beforeEach(() => {
  calls = [];
  let polls = 0;
  handlers = new Map<string, Handler>([
    ["GET agent/v1/node", () => ({ status: 200, body: { name: "box", enrolled: true } })],
    [
      "GET control/v1/nodes",
      () => ({ status: 200, body: { nodes: [{ name: "box" }, { name: "gpu" }] } }),
    ],
    ["GET agent/v1/apps", () => ({ status: 200, body: { apps: [] } })],
    ["GET node:gpu/v1/apps", () => ({ status: 200, body: { apps: [] } })],
    ["GET agent/v1/app-catalogue", () => catalogue()],
    [
      "GET node:gpu/v1/app-catalogue",
      () => catalogue(false, "This agent cannot find uv, which it installs apps with."),
    ],
    [
      "POST agent/v1/apps/chat/install",
      () => ({ status: 202, body: { app: "chat", state: "resolving", version: "abc" } }),
    ],
    [
      "GET agent/v1/apps/chat/install",
      () => {
        polls += 1;
        return {
          status: 200,
          body: { app: "chat", version: "abc", state: polls < 2 ? "installing" : "done" },
        };
      },
    ],
    [
      "POST agent/v1/app-catalogue/custom",
      () => ({
        status: 403,
        body: {
          detail: {
            title: "Custom apps are off",
            detail:
              "Adding an app that is not in this release's catalogue is off. Turn on 'Allow apps not in the catalogue' under this agent's Config first.",
          },
        },
      }),
    ],
  ]);
  sessionStorage.clear();
  sessionStorage.setItem("eugene-session-token", "test-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const route = String(input).replace(/^\/api\/proxy\//, "");
      const key = `${init?.method ?? "GET"} ${route}`;
      calls.push(key);
      const handler = handlers.get(key);
      const result = handler ? handler() : { status: 418, body: { detail: `unhandled: ${key}` } };
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

describe("installing", () => {
  it("installs on this machine and watches the install to its end", async () => {
    render(<AppsPage />);
    const button = await screen.findByTestId("apps-install-chat", {}, { timeout: 5000 });
    await userEvent.click(button);
    expect(calls).toContain("POST agent/v1/apps/chat/install");
    await waitFor(
      () => expect(screen.getByTestId("apps-install-state-chat")).toHaveTextContent("Installed."),
      { timeout: 5000 },
    );
    // Finishing re-reads what is installed, on every machine.
    expect(calls.filter((c) => c === "GET agent/v1/apps").length).toBeGreaterThan(1);
  });

  it("asks the other machine's own agent, and says why it cannot install there", async () => {
    render(<AppsPage />);
    const picker = await screen.findByLabelText("Machine to install on", {}, { timeout: 5000 });
    await userEvent.selectOptions(picker, "gpu");
    const why = await screen.findByTestId("apps-not-installable");
    expect(why).toHaveTextContent("cannot find uv");
    expect(calls).toContain("GET node:gpu/v1/app-catalogue");
    const entry = await screen.findByTestId("apps-install-chat");
    expect(entry).toBeDisabled();
    expect(calls).not.toContain("POST node:gpu/v1/apps/chat/install");
  });
});

describe("custom apps", () => {
  it("shows the refusal that names the setting, and links to it", async () => {
    render(<AppsPage />);
    const panel = await screen.findByTestId("apps-add-custom", {}, { timeout: 5000 });
    await userEvent.click(within(panel).getByText("Add an app by its source"));
    const inputs = within(panel).getAllByRole("textbox");
    const values = ["mine", "Mine", "mine-app", "mine_app", "/home/me/mine", "dev"];
    for (const [i, value] of values.entries()) await userEvent.type(inputs[i]!, value);
    await userEvent.click(within(panel).getByRole("button", { name: "Add to the list" }));
    expect(await within(panel).findByTestId("apps-add-custom-error")).toHaveTextContent(
      "Allow apps not in the catalogue",
    );
    const link = within(panel).getByRole("link", { name: /agent settings/ });
    expect(link.getAttribute("href")).toContain("tab=agent");
  });
});
