import { describe, expect, it } from "vitest";

import { doorLine, plainSwitch, stateLine, type ClientDoor, type ClientTls } from "./clientDoors";

function door(over: Partial<ClientDoor> = {}): ClientDoor {
  return {
    name: "gateway",
    port: 8080,
    listening: true,
    tls: true,
    plainConnections: 0,
    plainClients: [],
    ...over,
  };
}

function tls(doors: ClientDoor[], over: Partial<ClientTls> = {}): ClientTls {
  return { state: "issued", plainAllowed: true, doors, ...over };
}

describe("doorLine", () => {
  it("says no plain connections", () => {
    expect(doorLine(door())).toBe("Gateway · 8080 · TLS · no plain connections in 7 days");
  });
  it("names the clients", () => {
    const line = doorLine(
      door({
        plainConnections: 3,
        plainClients: [
          { address: "192.168.1.40", count: 2, lastSeen: "2026-10-20T10:00:00Z" },
          { address: "192.168.1.41", count: 1, lastSeen: "2026-10-19T10:00:00Z" },
        ],
      }),
    );
    expect(line).toBe(
      "Gateway · 8080 · TLS · 3 plain connections in 7 days (192.168.1.40, 192.168.1.41)",
    );
  });
  it("is singular for one and caps long lists", () => {
    expect(doorLine(door({ plainConnections: 1 }))).toContain("1 plain connection in 7 days");
    const many = ["a", "b", "c", "d", "e"].map((address) => ({
      address,
      count: 1,
      lastSeen: "2026-10-20T10:00:00Z",
    }));
    expect(doorLine(door({ plainConnections: 5, plainClients: many }))).toContain(
      "(a, b, c and 2 more)",
    );
  });
  it("labels the console and apps, and says when a door is not listening", () => {
    expect(doorLine(door({ name: "console", port: 8079 }))).toMatch(/^Console · 8079/);
    expect(doorLine(door({ name: "app:workbench", port: 8100 }))).toMatch(/^App workbench · 8100/);
    expect(doorLine(door({ listening: false, error: "address in use" }))).toBe(
      "Gateway · 8080 · not listening: address in use",
    );
  });
});

describe("stateLine", () => {
  it("says what each state means", () => {
    expect(stateLine(tls([], { state: "pending" }))).toBe(
      "Waiting for a certificate from the root",
    );
    expect(stateLine(tls([], { state: "error", error: "root is sealed" }))).toBe("root is sealed");
    expect(stateLine(tls([], { state: "none" }))).toBe("Not part of an install; plain HTTP only");
    expect(stateLine(tls([]))).toBeNull();
    expect(stateLine(null)).toMatch(/Not reported/);
  });
});

describe("plainSwitch", () => {
  it("allows turning off when every door is clean", () => {
    expect(plainSwitch([tls([door()]), tls([door({ name: "console" })])])).toEqual({
      canTurnOff: true,
      usedBy: [],
    });
  });
  it("blocks on any door and lists distinct addresses, newest first", () => {
    const a = door({
      plainConnections: 2,
      plainClients: [{ address: "10.0.0.2", count: 2, lastSeen: "2026-10-18T00:00:00Z" }],
    });
    const b = door({
      name: "console",
      plainConnections: 2,
      plainClients: [
        { address: "10.0.0.2", count: 1, lastSeen: "2026-10-19T00:00:00Z" },
        { address: "10.0.0.9", count: 1, lastSeen: "2026-10-20T00:00:00Z" },
      ],
    });
    expect(plainSwitch([tls([a]), tls([b])])).toEqual({
      canTurnOff: false,
      usedBy: ["10.0.0.9", "10.0.0.2"],
    });
  });
});
