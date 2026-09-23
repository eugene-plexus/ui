import { describe, expect, it } from "vitest";

import { isLoopbackUrl, joinTokenState, rootControlUrl } from "./joinCommand";

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
