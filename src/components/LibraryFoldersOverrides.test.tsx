/**
 * One machine's Folders view: its overrides, as the agent holds them.
 *
 * Settings never lie (Troy, 2026-09-29). Two ways this view showed a value
 * that was not in effect, found auditing every settings widget
 * (2026-09-30):
 *
 * - an override spelled `/models/` (a trailing slash, or another case on a
 *   Windows path) left the box empty and reading "inherits", while the
 *   agent's own check said "override", because the lookup was by exact text;
 * - overrides that could not be READ left every box empty -- "inherits" --
 *   and a save then sent only what was typed, erasing the ones never loaded.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LibraryFolders } from "./LibraryFolders";
import { overrideKeyFor, sameFolderPath } from "@/lib/libraryReach";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/library/folders",
  useSearchParams: () => new URLSearchParams(),
}));

function stub(config: { status: number; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const route = String(input).replace(/^\/api\/proxy\//, "");
      const key = `${init?.method ?? "GET"} ${route}`;
      let status = 200;
      let body: unknown = {};
      if (key === "GET library/v1/folders") {
        body = { folders: [{ path: "/models", mounts: [] }] };
      } else if (key.endsWith("/v1/library/folders/check")) {
        body = { libraryConsulted: true, folders: [] };
      } else if (key === "GET agent/v1/node") {
        body = { enrolled: false, name: null, devices: [] };
      } else if (key === "GET agent/v1/runtimes") {
        body = { runtimes: [] };
      } else if (key === "GET agent/v1/config") {
        status = config.status;
        body = config.body;
      }
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

describe("one machine's overrides", () => {
  beforeEach(() => sessionStorage.setItem("eugene-session-token", "test-token"));
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("finds an override spelled differently, as the agent does", async () => {
    stub({ status: 200, body: { pathMappings: [{ from: "/models/", to: "Z:\\models" }] } });
    render(<LibraryFolders nodeName={null} />);
    const box = await screen.findByTestId("override-input");
    await waitFor(() => expect(box).toHaveValue("Z:\\models"));
  });

  it("does not offer to save overrides it could not read", async () => {
    stub({ status: 503, body: { detail: "the agent is restarting" } });
    render(<LibraryFolders nodeName={null} />);
    const box = await screen.findByTestId("override-input");
    await waitFor(() => expect(box).toBeDisabled());
    expect(screen.getByTestId("overrides-save")).toBeDisabled();
  });

  it("says when some overrides could not be read", async () => {
    stub({
      status: 200,
      body: { pathMappings: [{ from: "/models", to: "Z:\\models" }, { from: "/x" }] },
    });
    render(<LibraryFolders nodeName={null} />);
    expect(await screen.findByTestId("overrides-note")).toHaveTextContent(
      "1 override on this host could not be read",
    );
  });
});

describe("sameFolderPath", () => {
  it("is blind to a trailing separator, and to case and slash on Windows", () => {
    expect(sameFolderPath("/models", "/models/")).toBe(true);
    expect(sameFolderPath("/models", "/Models")).toBe(false);
    expect(sameFolderPath("Z:\\Models\\", "z:/models")).toBe(true);
    expect(overrideKeyFor({ "/models/": "x" }, "/models")).toBe("/models/");
    expect(overrideKeyFor({}, "/models")).toBe("/models");
  });
});
