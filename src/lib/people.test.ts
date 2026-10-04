import { describe, expect, it } from "vitest";

import {
  appsSummary,
  installedByAgent,
  newPersonProblem,
  ownerLabel,
  parseReturnAddresses,
  returnAddressProblem,
  signInAddress,
} from "./people";
import type { OidcClient } from "./types";

const clients: OidcClient[] = [
  {
    clientId: "c-workbench",
    name: "Workbench",
    redirectUris: ["http://127.0.0.1:8190/oidc/callback"],
    owner: "app:workbench@Amish_Station",
    createdAt: "2026-10-01T00:00:00Z",
  },
  {
    clientId: "c-webui",
    name: "Open WebUI",
    redirectUris: ["http://192.168.1.5:3000/oauth/oidc/callback"],
    createdAt: "2026-10-01T00:00:00Z",
  },
];

describe("which apps a person may use", () => {
  it("says every app for null, which is what the wire means by it", () => {
    expect(appsSummary({ apps: null }, clients)).toBe("Every app");
    expect(appsSummary({}, clients)).toBe("Every app");
  });

  it("names the apps, and says so when there are none", () => {
    expect(appsSummary({ apps: [] }, clients)).toBe("No apps");
    expect(appsSummary({ apps: ["c-webui", "c-workbench"] }, clients)).toBe(
      "Open WebUI, Workbench",
    );
  });

  it("shows an id it cannot name rather than dropping it", () => {
    expect(appsSummary({ apps: ["c-gone"] }, clients)).toBe("c-gone");
  });
});

describe("where a registration came from", () => {
  it("reads the agent's own owner as the machine it is installed on", () => {
    expect(ownerLabel("app:workbench@Amish_Station")).toBe("installed on Amish_Station");
    expect(installedByAgent(clients[0]!)).toBe(true);
  });

  it("reads anything else as added here", () => {
    expect(ownerLabel(undefined)).toBeNull();
    expect(ownerLabel("someone")).toBeNull();
    expect(installedByAgent(clients[1]!)).toBe(false);
  });
});

describe("return addresses", () => {
  it("takes one a line, trimmed, without blanks or repeats", () => {
    expect(parseReturnAddresses(" http://a/cb \n\nhttp://a/cb\r\nhttp://b/cb")).toEqual([
      "http://a/cb",
      "http://b/cb",
    ]);
  });

  it("refuses what the root refuses, with the fix", () => {
    expect(returnAddressProblem("http://192.168.1.5:3000/cb")).toBeNull();
    expect(returnAddressProblem("/cb")).toMatch(/http:\/\//);
    expect(returnAddressProblem("ftp://x/cb")).toMatch(/must start/);
    expect(returnAddressProblem("http://x/cb#here")).toMatch(/#/);
  });
});

describe("the sign-in address an app is given", () => {
  const lan = { protocol: "http:", host: "192.168.1.5:8079", hostname: "192.168.1.5" };
  const local = { protocol: "http:", host: "localhost:8079", hostname: "localhost" };

  it("is the configured one when there is one", () => {
    expect(signInAddress("https://eugene.example/oidc/", lan)).toEqual({
      url: "https://eugene.example/oidc",
      configured: true,
      loopback: false,
    });
  });

  it("is this page's own address otherwise, since every agent forwards it", () => {
    expect(signInAddress(null, lan)).toEqual({
      url: "http://192.168.1.5:8079/oidc",
      configured: false,
      loopback: false,
    });
  });

  it("says when only this computer could open it", () => {
    expect(signInAddress(undefined, local).loopback).toBe(true);
    expect(signInAddress("http://127.0.0.1:8079/oidc", lan).loopback).toBe(true);
  });
});

describe("a new person", () => {
  it("needs a name of their own and a real password", () => {
    expect(newPersonProblem("", "a-long-enough-password", "operator")).toMatch(/name/);
    expect(newPersonProblem("ada@example", "a-long-enough-password", "operator")).toMatch(/@/);
    expect(newPersonProblem("Operator", "a-long-enough-password", "operator")).toMatch(/is you/);
    expect(newPersonProblem("Ada", "short", "operator")).toMatch(/12/);
    expect(newPersonProblem("Ada", "a-long-enough-password", "operator")).toBeNull();
  });
});
