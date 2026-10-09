/**
 * The Settings page, against a two-machine install.
 *
 * `specs/docs/design/ui-settings-reorganisation.md` §2. The topic map is
 * pure and tested beside itself; what this covers is the page: that
 * every owner's settings arrive, the other machine's through its proxy;
 * that one object's page is the same cards filtered; that the search
 * shrinks the page and opens a fold; that a deep link lands on its
 * field; that the save-all bar counts and saves across sections; and
 * that a backend keeps the plain editor with its *Runs on* line.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ConfigPage from "./page";

let query: string;
vi.mock("next/navigation", () => ({
  usePathname: () => "/config",
  useSearchParams: () => new URLSearchParams(query),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

interface Field {
  key: string;
  label: string;
  category: string;
  valueType: string;
}

const f = (key: string, label: string, category: string): Field => ({
  key,
  label,
  category,
  valueType: "string",
});

/** What each proxy target serves. The agent's five engine fields are the
 * fold's candidates, so the fold exists on both machines. */
const SCHEMAS: Record<
  string,
  { component: string; fields: Field[]; categories: Record<string, string> }
> = {
  gateway: {
    component: "gateway",
    fields: [
      f("defaultTemperature", "Default temperature", "generation"),
      f("defaultMaxTokens", "Default max output tokens", "generation"),
      f("idleCheckSeconds", "Idle check interval", "lifecycle"),
      f("corsEnabled", "Answer browser clients (CORS)", "clients"),
      f("logLevel", "Log level", "logging"),
    ],
    categories: { generation: "Generation defaults", lifecycle: "Lifecycle policy" },
  },
  library: {
    component: "library",
    fields: [
      f("modelRoots", "Folders", "library"),
      f("hfToken", "Catalogue access token", "catalogue"),
      f("scanOnStartup", "Scan at startup", "scanning"),
    ],
    categories: {},
  },
  control: {
    component: "control",
    fields: [
      f("securityMode", "Security mode", "security"),
      f("standbyUrls", "Standby control roots", "replication"),
      f("firstRunComplete", "First-run setup complete", "setup"),
      f("uiTheme", "Theme", "ui"),
    ],
    categories: {},
  },
  agent: {
    component: "agent",
    fields: [
      f("securityMode", "Security mode", "security"),
      f("uiFontSize", "Font size", "ui"),
      f("engineBinaryRoots", "Trusted engine directories", "engines"),
      f("allowUnrestrictedEngineLaunch", "Allow unrestricted engine launch", "engines"),
      f("vllmBinary", "vLLM binary", "engines"),
      f("mlxBinary", "MLX binary", "engines"),
      f("kevPython", "Kev interpreter", "engines"),
      f("allowedHosts", "Allowed host names", "node"),
      f("updateChannel", "Update channel", "updates"),
      f("firstRunComplete", "First-run setup complete", "setup"),
    ],
    categories: { engines: "Engines" },
  },
  qwen: {
    component: "inference-driver",
    fields: [f("provider", "Provider", "adapter"), f("baseUrl", "Base URL", "adapter")],
    categories: {},
  },
};

let docs: Record<string, Record<string, unknown>>;
let calls: string[];
let patches: { target: string; body: Record<string, unknown> }[];

beforeEach(() => {
  query = "";
  calls = [];
  patches = [];
  docs = {
    gateway: {
      defaultTemperature: "0.7",
      defaultMaxTokens: "",
      idleCheckSeconds: "30",
      corsEnabled: "true",
      logLevel: "info",
    },
    library: { modelRoots: "D:/models", hfToken: "", scanOnStartup: "true" },
    control: {
      securityMode: "os_keyring",
      standbyUrls: "",
      firstRunComplete: "true",
      uiTheme: "dark",
    },
    agent: {
      securityMode: "os_keyring",
      uiFontSize: "medium",
      engineBinaryRoots: "",
      allowUnrestrictedEngineLaunch: "false",
      vllmBinary: "",
      mlxBinary: "",
      kevPython: "",
      updateChannel: "edge",
      allowedHosts: "",
      firstRunComplete: "true",
    },
    "node:Amish_Station": {
      securityMode: "prompt_on_startup",
      uiFontSize: "medium",
      engineBinaryRoots: "",
      allowUnrestrictedEngineLaunch: "false",
      vllmBinary: "/opt/vllm",
      mlxBinary: "",
      kevPython: "",
      updateChannel: "releases",
      allowedHosts: "",
      firstRunComplete: "true",
    },
    qwen: { provider: "openai_compat_http", baseUrl: "http://127.0.0.1:11434" },
  };
  window.location.hash = "";
  Element.prototype.scrollIntoView = vi.fn();
  const seen = calls;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push(url);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      const m = /^\/api\/proxy\/([^/]+)(\/.*)$/.exec(url);
      const target = m?.[1] ?? "";
      const path = m?.[2] ?? url;
      if (target === "agent" && path === "/v1/components") {
        return json({
          components: [{ name: "gateway", kind: "gateway", url: "http://127.0.0.1:8080/" }],
        });
      }
      if (target === "agent" && path === "/v1/node") return json({ enrolled: true, name: "root" });
      if (target === "control" && path === "/v1/components") {
        return json({
          components: [
            { node: "root", name: "gateway", kind: "gateway" },
            { node: "root", name: "library", kind: "library" },
            { node: "root", name: "control", kind: "control" },
            { node: "Amish_Station", name: "qwen", kind: "inference-driver" },
          ],
        });
      }
      if (target === "control" && path === "/v1/nodes") {
        return json({
          nodes: [
            { name: "root", role: "control", reachable: true },
            { name: "Amish_Station", role: "worker", reachable: true },
          ],
        });
      }
      const schemaOf = target.startsWith("node:") ? SCHEMAS.agent : SCHEMAS[target];
      if (path === "/v1/config/schema" && schemaOf) return json(schemaOf);
      if (path === "/v1/config" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        patches.push({ target, body });
        docs[target] = { ...docs[target], ...body };
        return json({ applied: Object.keys(body), rejected: [], requiresRestart: false });
      }
      if (path === "/v1/config" && docs[target]) return json(docs[target]);
      return json({ detail: "Not Found" }, 404);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The card for one topic, once it has rendered: the sections arrive as
 * each owner's schema does, so this waits for the card rather than for
 * a first paint that may hold only this machine's. */
const card = (topic: string) =>
  waitFor(
    () => {
      const found = screen
        .queryAllByTestId("settings-card")
        .find((c) => c.getAttribute("data-topic") === topic);
      if (!found) throw new Error(`no ${topic} card`);
      return found;
    },
    { timeout: 5000 },
  );

const sectionsOf = (el: HTMLElement) =>
  within(el)
    .getAllByTestId("settings-section")
    .map((s) => s.getAttribute("data-target"));

describe("the Settings page", () => {
  it("shows every owner's settings by topic, the other machine's through its proxy", async () => {
    render(<ConfigPage />);
    const access = await card("access");
    // Gateway, then the control root, then this machine, then the other
    // -- one card, four sections, none of them asking the person which
    // process holds a security mode.
    await waitFor(() =>
      expect(sectionsOf(access)).toEqual(["gateway", "control", "agent", "node:Amish_Station"]),
    );
    expect(within(access).getAllByLabelText("Security mode")).toHaveLength(3);
    expect(calls).toContain("/api/proxy/node:Amish_Station/v1/config/schema");
    expect(calls).toContain("/api/proxy/node:Amish_Station/v1/config");
    // The section says whose it is, and the noun stays on hover.
    expect(within(access).getByRole("heading", { name: "Amish_Station" })).toHaveAttribute(
      "title",
      "agent",
    );
    expect(screen.getByTestId("settings-scope")).toHaveTextContent(/across 2 machines/);
  });

  it("orders the cards common tasks first, and reads a fallback category by the schema's label", async () => {
    render(<ConfigPage />);
    await card("access");
    await waitFor(() => {
      const topics = screen
        .getAllByTestId("settings-card")
        .map((c) => c.getAttribute("data-topic"));
      expect(topics.slice(0, 4)).toEqual(["models", "answers", "serving", "engines"]);
    });
  });

  it("hides the wizard's flag and the dead appearance knobs, whichever component serves them", async () => {
    render(<ConfigPage />);
    await card("access");
    await waitFor(() =>
      expect(screen.getAllByTestId("settings-section").length).toBeGreaterThan(6),
    );
    expect(screen.queryByLabelText("First-run setup complete")).toBeNull();
    // "Theme" and "Font size" exist once: the browser's own Appearance
    // card, not the agent's or the root's dead copies.
    expect(screen.getAllByLabelText("Theme")).toHaveLength(1);
    expect(screen.getAllByLabelText("Font size")).toHaveLength(1);
    expect(document.querySelector('[data-topic="appearance"]')).not.toBeNull();
  });

  it("shows one object's share when the tree selects it, and links back to everything", async () => {
    query = "sel=gateway";
    render(<ConfigPage />);
    const answers = await card("answers");
    await waitFor(() => expect(sectionsOf(answers)).toEqual(["gateway"]));
    await waitFor(() =>
      expect(
        screen.getAllByTestId("settings-card").map((c) => c.getAttribute("data-topic")),
      ).toEqual(["answers", "serving", "access", "metrics-logs"]),
    );
    expect(calls.some((c) => c.startsWith("/api/proxy/node:Amish_Station/v1/config"))).toBe(false);
    expect(calls.some((c) => c.startsWith("/api/proxy/library/v1/config"))).toBe(false);
    expect(screen.getByTestId("settings-scope")).toHaveTextContent("The gateway only");
    expect(screen.getByRole("link", { name: "every setting" })).toHaveAttribute(
      "href",
      "/config?sel=install",
    );
  });

  it("still lands on the subject a legacy ?tab= link asked for", async () => {
    // The launch panel's "map it" link writes this, and it is in builds
    // that are already installed.
    query = "tab=node%3AAmish_Station";
    render(<ConfigPage />);
    await waitFor(() => expect(calls).toContain("/api/proxy/node:Amish_Station/v1/config/schema"));
    expect(await screen.findByTestId("settings-scope")).toHaveTextContent("Amish_Station only");
  });

  it("shrinks to what a search matches, and opens the fold a match is behind", async () => {
    render(<ConfigPage />);
    await card("access");
    // The fold: five engine fields are candidates, so on each machine
    // vLLM binary is behind Show more, in the document and not visible.
    await waitFor(() => expect(screen.getAllByText("Show more · 5 settings").length).toBe(2));
    for (const box of screen.getAllByLabelText("vLLM binary")) expect(box).not.toBeVisible();
    fireEvent.change(screen.getByTestId("settings-search"), { target: { value: "vllm" } });
    await waitFor(() =>
      expect(
        screen.getAllByTestId("settings-card").map((c) => c.getAttribute("data-topic")),
      ).toEqual(["engines"]),
    );
    // Opened for the person who searched, on both machines.
    await waitFor(() => {
      const boxes = screen.getAllByLabelText("vLLM binary");
      expect(boxes).toHaveLength(2);
      for (const box of boxes) expect(box).toBeVisible();
    });
    // A search that matches nothing on the cards still answers with the
    // pages settings live on, or says there is nothing.
    fireEvent.change(screen.getByTestId("settings-search"), { target: { value: "firewall" } });
    expect(await screen.findByTestId("settings-elsewhere")).toHaveTextContent(
      "Reach it from other devices",
    );
    fireEvent.change(screen.getByTestId("settings-search"), { target: { value: "zzqx" } });
    expect(await screen.findByTestId("settings-nothing")).toHaveTextContent("zzqx");
  });

  it("lands a deep link on its field and marks it", async () => {
    query = "sel=gateway";
    window.location.hash = "#defaultMaxTokens";
    render(<ConfigPage />);
    await card("answers");
    await waitFor(() => {
      const row = document.querySelector('[data-config-key="defaultMaxTokens"]');
      expect(row).toHaveAttribute("data-focused", "true");
    });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("counts unsaved changes across sections and saves each on Save all", async () => {
    render(<ConfigPage />);
    await card("access");
    await waitFor(() => expect(screen.getAllByLabelText("Security mode")).toHaveLength(3));
    expect(screen.queryByTestId("save-all-bar")).toBeNull();
    fireEvent.change(screen.getByLabelText("Default temperature"), { target: { value: "0.2" } });
    fireEvent.change(screen.getByLabelText("Default max output tokens"), {
      target: { value: "512" },
    });
    // The sections read control, this machine, the other machine; this
    // machine's mode is the one changed (the other's already says so).
    const modes = screen.getAllByLabelText("Security mode");
    fireEvent.change(modes[1]!, { target: { value: "prompt_on_startup" } });
    const bar = await screen.findByTestId("save-all-bar");
    expect(bar).toHaveTextContent("3 unsaved changes in 2 sections");
    // Each dirty section shows its own buttons; a clean one shows none.
    expect(screen.getAllByTestId("section-actions")).toHaveLength(2);
    fireEvent.click(screen.getByTestId("save-all"));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches.map((p) => [p.target, p.body])).toEqual([
      ["gateway", { defaultTemperature: "0.2", defaultMaxTokens: "512" }],
      ["agent", { securityMode: "prompt_on_startup" }],
    ]);
    await waitFor(() => expect(screen.queryByTestId("save-all-bar")).toBeNull());
  });

  it("keeps a backend on the plain editor, with which machine it runs on", async () => {
    query = "sel=driver%3Aqwen%40Amish_Station";
    render(<ConfigPage />);
    await waitFor(() => expect(calls).toContain("/api/proxy/qwen/v1/config/schema"));
    expect(await screen.findByText(/not the machine you are browsing from/)).toBeInTheDocument();
    expect(await screen.findByLabelText("Base URL")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-search")).toBeNull();
    expect(screen.getByTestId("remove-driver")).toBeInTheDocument();
  });

  it("says nothing is selected for a stale token rather than showing the wrong thing", async () => {
    query = "sel=nope";
    render(<ConfigPage />);
    expect(await screen.findByText("Nothing selected.")).toBeInTheDocument();
  });

  it("folds a field the same on the topic page as on the machine's own page", async () => {
    // The fold is decided on everything the agent serves -- six
    // candidates here -- and then a section takes its share. Deciding it
    // on the section's own fields would show Allowed host names inline
    // under Access & security (one candidate, no fold) while the
    // machine's own page folds it, and a person would learn two answers
    // to "where is it".
    render(<ConfigPage />);
    const access = await card("access");
    await waitFor(() =>
      expect(within(access).getAllByText("Show more · 1 setting")).toHaveLength(2),
    );
    for (const box of screen.getAllByLabelText("Allowed host names")) expect(box).not.toBeVisible();
  });
});
