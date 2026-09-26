import { describe, expect, it } from "vitest";

import {
  checkControlAddress,
  installPorts,
  isLoopbackUrl,
  joinTokenState,
  posixJoinCommand,
  rootControlUrl,
  windowsJoinCommand,
} from "./joinCommand";

describe("the join commands", () => {
  const base = "https://raw.githubusercontent.com/eugene-plexus/specs/main/scripts";
  const details = {
    controlUrl: "http://192.168.16.252:8283",
    token: "pAC9GuVWqkqczs0jFnEnRYHP6mYH67qtOWeA_0lkDTo",
    nodeName: "Amish_Station",
  };

  it("installs and joins in one line on Windows", () => {
    expect(windowsJoinCommand(details)).toBe(
      `& ([scriptblock]::Create((irm ${base}/install.ps1))) -Join http://192.168.16.252:8283 ` +
        "-Token pAC9GuVWqkqczs0jFnEnRYHP6mYH67qtOWeA_0lkDTo -NodeName Amish_Station",
    );
  });

  it("installs and joins in one line on Linux or macOS", () => {
    expect(posixJoinCommand(details)).toBe(
      `curl -fsSL ${base}/install.sh | sh -s -- --join http://192.168.16.252:8283 ` +
        "--token pAC9GuVWqkqczs0jFnEnRYHP6mYH67qtOWeA_0lkDTo --name Amish_Station",
    );
  });

  it("leaves the name out when none was asked for", () => {
    expect(windowsJoinCommand({ ...details, nodeName: null })).not.toContain("-NodeName");
    expect(posixJoinCommand({ ...details, nodeName: undefined })).not.toContain("--name");
  });

  it("quotes a word each shell would otherwise split or redirect", () => {
    const odd = { ...details, controlUrl: "http://<this-host>:8083", nodeName: "Troy's box" };
    expect(windowsJoinCommand(odd)).toContain("-Join 'http://<this-host>:8083'");
    expect(windowsJoinCommand(odd)).toContain("-NodeName 'Troy''s box'");
    expect(posixJoinCommand(odd)).toContain("--join 'http://<this-host>:8083'");
    expect(posixJoinCommand(odd)).toContain(`--name 'Troy'"'"'s box'`);
  });
});

describe("installPorts", () => {
  it("is the defaults on an ordinary install, or when the root's address is unknown", () => {
    expect(installPorts("http://10.0.0.5:8079")).toEqual({
      agent: 8079,
      gateway: 8080,
      control: 8083,
      offset: 0,
    });
    expect(installPorts(null)).toEqual({ agent: 8079, gateway: 8080, control: 8083, offset: 0 });
    expect(installPorts("not a url").control).toBe(8083);
  });

  it("moves every port by the agent's offset, as the container template publishes them", () => {
    expect(installPorts("http://192.168.16.252:8279")).toEqual({
      agent: 8279,
      gateway: 8280,
      control: 8283,
      offset: 200,
    });
  });
});

describe("checkControlAddress", () => {
  const ordinary = installPorts("http://10.0.0.5:8079");
  const shifted = installPorts("http://192.168.16.252:8279");

  it("says nothing about a right address, or an empty box", () => {
    expect(checkControlAddress("http://192.168.16.252:8283", shifted)).toBeNull();
    expect(checkControlAddress("https://root.tailnet.ts.net:8083", ordinary)).toBeNull();
    expect(checkControlAddress("   ", ordinary)).toBeNull();
  });

  it("fixes both halves of what was typed on 2026-09-26: no http:// and the console's port", () => {
    const check = checkControlAddress("192.168.16.252:8079", ordinary);
    expect(check?.problems).toEqual([
      "It needs http:// at the start.",
      "Port 8079 is this console, not the control root. The control root is on port 8083.",
    ]);
    expect(check?.suggestion).toBe("http://192.168.16.252:8083");
  });

  it("reads the console's and the apps' ports on a shifted install, not the defaults", () => {
    expect(checkControlAddress("http://192.168.16.252:8279", shifted)?.suggestion).toBe(
      "http://192.168.16.252:8283",
    );
    expect(checkControlAddress("http://192.168.16.252:8280", shifted)?.problems[0]).toMatch(
      /^Port 8280 is where your apps connect/,
    );
    // The DEFAULT control port is the wrong one there, and it says so.
    expect(checkControlAddress("http://192.168.16.252:8083", shifted)?.problems[0]).toMatch(
      /control root is on port 8283, not 8083/,
    );
  });

  it("adds a missing port, and keeps the host and scheme it was given", () => {
    const check = checkControlAddress("https://gpu-box", ordinary);
    expect(check?.problems).toEqual(["It has no port. The control root is on port 8083."]);
    expect(check?.suggestion).toBe("https://gpu-box:8083");
  });

  it("offers no fix for something that is not an address", () => {
    expect(checkControlAddress("http://", ordinary)?.suggestion).toBeNull();
    expect(checkControlAddress("ftp://gpu-box:8083", ordinary)?.suggestion).toBeNull();
  });
});

describe("rootControlUrl", () => {
  it("keeps the agent's port offset, so a remapped install names its own root", () => {
    // The container template publishes every port +200: agent 8279, root
    // 8283. A hard-coded 8083 named a port nothing listened on.
    expect(rootControlUrl("http://192.168.16.252:8279")).toBe("http://192.168.16.252:8283");
    expect(rootControlUrl("http://10.0.0.5:8179/")).toBe("http://10.0.0.5:8183");
  });

  it("is the default port for the default agent port, or for none", () => {
    expect(rootControlUrl("http://10.0.0.5:8079")).toBe("http://10.0.0.5:8083");
    expect(rootControlUrl("http://gpu-box")).toBe("http://gpu-box:8083");
  });
});

describe("isLoopbackUrl", () => {
  it("knows an address only this machine can reach", () => {
    expect(isLoopbackUrl("http://127.0.0.1:8083")).toBe(true);
    expect(isLoopbackUrl("http://localhost:8083")).toBe(true);
    expect(isLoopbackUrl("http://127.0.1.1:8083")).toBe(true);
    expect(isLoopbackUrl("http://192.168.16.252:8283")).toBe(false);
    expect(isLoopbackUrl("not a url")).toBe(false);
  });
});

describe("joinTokenState", () => {
  const now = Date.parse("2026-09-23T12:00:00Z");
  it("is usable until it runs out or is spent", () => {
    expect(joinTokenState({ expiresAt: "2026-09-23T12:10:00Z" }, now)).toBe("usable");
    expect(joinTokenState({ expiresAt: "2026-09-23T11:59:00Z" }, now)).toBe("expired");
    expect(joinTokenState({ expiresAt: "2026-09-23T12:10:00Z", used: true }, now)).toBe("used");
  });
});
