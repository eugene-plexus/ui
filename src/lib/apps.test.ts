import { describe, expect, it } from "vitest";

import {
  agentTarget,
  describeApp,
  describeInstall,
  installErrorSummary,
  installFinished,
  openTarget,
  updateAvailable,
} from "./apps";
import type { App, AppCatalogueEntry, AppInstall } from "./types";

function app(overrides: Partial<App> = {}): App {
  return {
    id: "chat",
    name: "Chat",
    version: "v1",
    origin: "catalogue",
    enabled: true,
    status: "running",
    port: 8190,
    ui: true,
    configTrio: true,
    uses: ["inference"],
    uiUrl: "http://192.168.16.75:8190/",
    ...overrides,
  };
}

describe("agentTarget", () => {
  it("talks to this console's own agent for this machine, and hops for any other", () => {
    expect(agentTarget("Amish_Station", "Amish_Station")).toBe("agent");
    expect(agentTarget(null, "Amish_Station")).toBe("agent");
    expect(agentTarget("nas", "Amish_Station")).toBe("node:nas");
    // An unenrolled console has no name of its own; a named node is
    // still another machine.
    expect(agentTarget("nas", null)).toBe("node:nas");
  });
});

describe("installs", () => {
  const at = (state: AppInstall["state"]): AppInstall => ({ app: "chat", state });

  it("is finished only in a terminal state", () => {
    for (const s of ["done", "failed", "cancelled"] as const)
      expect(installFinished(at(s))).toBe(true);
    for (const s of ["resolving", "creating", "installing", "verifying"] as const) {
      expect(installFinished(at(s))).toBe(false);
    }
    expect(installFinished(null)).toBe(false);
  });

  it("says every phase in words", () => {
    for (const s of [
      "resolving",
      "creating",
      "installing",
      "verifying",
      "done",
      "failed",
      "cancelled",
    ] as const) {
      expect(describeInstall(at(s)).length).toBeGreaterThan(3);
    }
  });

  it("leads a failure with the tool's first line, not a blank one", () => {
    expect(installErrorSummary("\n  installing chat failed:\n  x No solution found")).toBe(
      "installing chat failed:",
    );
    expect(installErrorSummary(undefined)).toBeNull();
  });
});

describe("updateAvailable", () => {
  const entry = (installed?: string): AppCatalogueEntry => ({
    manifest: {
      id: "chat",
      name: "Chat",
      source: "https://example.invalid/a.tar.gz",
      version: "v2",
      package: "eugene-plexus-chat",
      entry: "eugene_plexus_chat",
      python: "3.12",
      ui: true,
      configTrio: true,
      uses: ["inference"],
    },
    origin: "catalogue",
    installedVersion: installed,
  });

  it("offers an update only for an installed app on another version", () => {
    expect(updateAvailable(entry("v1"))).toBe(true);
    expect(updateAvailable(entry("v2"))).toBe(false);
    expect(updateAvailable(entry())).toBe(false);
  });
});

describe("describeApp", () => {
  it("puts the operator's stop ahead of whatever the process is doing", () => {
    expect(describeApp(app({ enabled: false, status: "running" })).text).toBe("Stopped");
    expect(describeApp(app({ status: "crashed" })).tone).toBe("error");
    expect(describeApp(app()).tone).toBe("ok");
  });
});

describe("openTarget", () => {
  it("opens an app on its own address", () => {
    expect(openTarget(app(), "192.168.16.75")).toEqual({
      href: "http://192.168.16.75:8190/",
      note: null,
    });
  });

  it("says a loopback address only works on that machine, when this browser is elsewhere", () => {
    const local = app({ uiUrl: "http://127.0.0.1:8190/" });
    expect(openTarget(local, "localhost").note).toBeNull();
    const far = openTarget(local, "192.168.16.20");
    expect(far.href).toBe("http://127.0.0.1:8190/");
    expect(far.note).toMatch(/Reach it from other devices/);
  });

  it("offers nothing for an app without a UI", () => {
    expect(openTarget(app({ ui: false, uiUrl: undefined }), "localhost")).toEqual({
      href: null,
      note: null,
    });
  });
});
