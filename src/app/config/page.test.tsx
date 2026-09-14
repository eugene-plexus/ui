/**
 * The Config page's tabs on a multi-node install (M11).
 *
 * Before this, Config's tabs were the local agent, the singletons and
 * the drivers — the control root's component list — and the agent is
 * not a component, so another node's agent settings could not be
 * reached from here at all. A worker's model directory mappings live on
 * that agent; an operator at the root's console needs a tab for it, and
 * a link from the launch panel needs to land on it.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ConfigPage from "./page";

let query: string;
vi.mock("next/navigation", () => ({
  // The shared navigation reads the pathname to mark the current
  // screen. Added when AppNav landed; without it every page that
  // renders a header throws on mount.
  usePathname: () => "/config",
  useSearchParams: () => new URLSearchParams(query),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

let calls: string[];

beforeEach(() => {
  query = "";
  calls = [];
  const seen = calls;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      if (url === "/api/proxy/agent/v1/components") {
        return json({
          components: [
            { name: "gateway", kind: "gateway", url: "http://127.0.0.1:8080/", status: "running" },
          ],
        });
      }
      if (url === "/api/proxy/agent/v1/node") return json({ enrolled: true, name: "root" });
      if (url === "/api/proxy/control/v1/components") {
        return json({ components: [{ node: "root", name: "gateway", kind: "gateway" }] });
      }
      if (url === "/api/proxy/control/v1/nodes") {
        return json({
          nodes: [
            { name: "root", role: "control", reachable: true },
            { name: "Amish_Station", role: "worker", reachable: true },
          ],
        });
      }
      if (url.endsWith("/v1/config/schema")) {
        return json({ component: "agent", fields: [], categories: {} });
      }
      if (url.endsWith("/v1/config")) return json({});
      return json({ detail: "Not Found" }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ConfigPage", () => {
  it("offers every node's agent as a tab, addressed as a node", async () => {
    render(<ConfigPage />);
    await screen.findByRole("button", { name: "Agent @ Amish_Station" });
    expect(screen.getByRole("button", { name: "Agent @ root" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gateway @ root" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Agent @ Amish_Station" }));
    await waitFor(() => expect(calls).toContain("/api/proxy/node:Amish_Station/v1/config/schema"));
    expect(calls).toContain("/api/proxy/node:Amish_Station/v1/config");
    // The banner says whose machine these settings are about.
    expect(screen.getByText(/not the machine you are browsing from/)).toBeInTheDocument();
  });

  it("lands on the tab a link asked for", async () => {
    query = "tab=node%3AAmish_Station";
    render(<ConfigPage />);
    await waitFor(() => expect(calls).toContain("/api/proxy/node:Amish_Station/v1/config/schema"));
  });
});
