/**
 * Reaching another machine's agent settings, on a multi-node install.
 *
 * The case is M11's: a worker's model directory mappings live on that
 * worker's agent, the agent is not a component, and before M11 another
 * node's agent could not be reached from this page at all.
 *
 * **The mechanism changed and the case did not.** Config used to own a
 * tab per component per node; it now takes one object from `?sel=` and
 * the tree offers the objects. So these assertions moved from a tab
 * strip to the tree, and the second one — a link landing on the right
 * subject — is unchanged, because `?tab=` is in shipped builds and still
 * has to work.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ConfigPage from "./page";

let query: string;
vi.mock("next/navigation", () => ({
  // The shared navigation reads the pathname to mark the current
  // screen. Added when the shared navigation landed; without it every
  // page that renders a header throws on mount.
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
  it("offers every node's agent in the tree, addressed as a node", async () => {
    render(<ConfigPage />);
    // Both machines' agents are rows, and the gateway is its own row
    // rather than a tab belonging to whichever host runs it.
    const worker = await screen.findByRole("link", { name: /Amish_Station/ });
    expect(worker).toHaveAttribute("href", expect.stringContaining("sel=agent%3AAmish_Station"));
    expect(worker).toHaveAttribute("href", expect.stringContaining("tab=node%3AAmish_Station"));
    expect(screen.getByRole("link", { name: /Gateway/ })).toBeInTheDocument();
  });

  it("addresses the selected machine's agent through the node proxy", async () => {
    query = "sel=agent%3AAmish_Station";
    render(<ConfigPage />);
    await waitFor(() => expect(calls).toContain("/api/proxy/node:Amish_Station/v1/config/schema"));
    expect(calls).toContain("/api/proxy/node:Amish_Station/v1/config");
    // The banner says whose machine these settings are about.
    expect(screen.getByText(/not the machine you are browsing from/)).toBeInTheDocument();
  });

  it("still lands on the subject a legacy ?tab= link asked for", async () => {
    // The launch panel's "map it" link writes this, and it is in builds
    // that are already installed.
    query = "tab=node%3AAmish_Station";
    render(<ConfigPage />);
    await waitFor(() => expect(calls).toContain("/api/proxy/node:Amish_Station/v1/config/schema"));
  });

  it("shows browser preferences on the install root, not a component's settings", async () => {
    // The old `ui` tab. Nothing may become unreachable in the move.
    query = "sel=install";
    render(<ConfigPage />);
    expect(await screen.findByLabelText("Theme")).toBeInTheDocument();
    expect(calls.some((c) => c.endsWith("/v1/config/schema"))).toBe(false);
  });
});
