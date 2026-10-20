import { describe, expect, it } from "vitest";

import {
  certificateLine,
  gatewayUrls,
  namesChanged,
  parseNames,
  showTrustSteps,
} from "./connectTls";

const issued = { state: "issued", plainAllowed: true, source: "installCa" } as const;

describe("gatewayUrls", () => {
  it("shows https first and http while plain is allowed", () => {
    expect(gatewayUrls("http://192.168.1.20:8080", issued)).toEqual({
      primary: "https://192.168.1.20:8080",
      plain: "http://192.168.1.20:8080",
      check: "http://192.168.1.20:8080",
    });
  });
  it("drops http once plain is off", () => {
    const urls = gatewayUrls("http://nas.local:8080", { ...issued, plainAllowed: false });
    expect(urls.primary).toBe("https://nas.local:8080");
    expect(urls.plain).toBeNull();
  });
  it("leaves the address alone without a certificate or when it is already https", () => {
    for (const tls of [null, { ...issued, state: "pending" as const }]) {
      expect(gatewayUrls("http://h:8080", tls).primary).toBe("http://h:8080");
    }
    expect(gatewayUrls("https://eugene.example.com", issued)).toEqual({
      primary: "https://eugene.example.com",
      plain: null,
      check: "https://eugene.example.com",
    });
    expect(gatewayUrls(null, issued).primary).toBeNull();
  });
});

describe("showTrustSteps", () => {
  it("is for the install CA only", () => {
    expect(showTrustSteps(issued)).toBe(true);
    expect(showTrustSteps({ ...issued, source: null })).toBe(true);
    expect(showTrustSteps({ ...issued, source: "supplied" })).toBe(false);
    expect(showTrustSteps({ ...issued, state: "none" })).toBe(false);
    expect(showTrustSteps(null)).toBe(false);
  });
});

describe("certificateLine", () => {
  it("says whose certificate and for which names", () => {
    expect(
      certificateLine({
        state: "issued",
        names: ["192.168.1.20", "box.local"],
        source: "installCa",
      }),
    ).toBe("Install certificate for 192.168.1.20, box.local");
    expect(
      certificateLine({ state: "issued", names: ["eugene.example.com"], source: "supplied" }),
    ).toBe("Your own certificate for eugene.example.com");
    expect(certificateLine({ state: "pending", names: ["a"] })).toBeNull();
    expect(certificateLine({ state: "issued", names: [] })).toBeNull();
  });
});

describe("parseNames", () => {
  it("splits on commas and spaces, lowercases and de-duplicates", () => {
    expect(parseNames(" Box.local, nas.LAN  box.local,, ").names).toEqual(["box.local", "nas.lan"]);
  });
  it("drops a trailing dot and flags what cannot be a name", () => {
    expect(parseNames("box.local.").names).toEqual(["box.local"]);
    expect(parseNames("https://box.local/x, ok.lan")).toEqual({
      names: ["ok.lan"],
      invalid: ["https://box.local/x"],
    });
  });
  it("is empty for an empty field", () => {
    expect(parseNames("  ")).toEqual({ names: [], invalid: [] });
  });
});

describe("namesChanged", () => {
  it("compares with what the root holds", () => {
    expect(namesChanged("a.local, b.local", ["a.local", "b.local"])).toBe(false);
    expect(namesChanged("a.local", ["a.local", "b.local"])).toBe(true);
    expect(namesChanged("", undefined)).toBe(false);
  });
});
