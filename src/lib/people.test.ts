import { describe, expect, it } from "vitest";

import {
  appsSummary,
  groupPoliciesBody,
  jobSitesSummary,
  installedByAgent,
  newPersonProblem,
  ownerLabel,
  parseReturnAddresses,
  policiesSummary,
  returnAddressProblem,
  rootKnowsPolicies,
  signInAddress,
  workbenchMachine,
  workbenchRemovalWords,
  summaryPercentChoices,
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

describe("what a person may do with job sites (J77)", () => {
  it("says what is in effect, and that it is the install's defaults", () => {
    expect(
      jobSitesSummary({
        permissions: null,
        permissionsInEffect: ["add-job-sites", "use-job-sites"],
      }),
    ).toEqual({ text: "add machines; use job sites as themselves", source: "defaults" });
  });

  it("reads the root's answer, not the list asked for", () => {
    // A default turned off: the list in effect is shorter than the choices.
    expect(jobSitesSummary({ permissionsInEffect: ["use-job-sites"] })).toEqual({
      text: "use job sites as themselves",
      source: "defaults",
    });
  });

  it("says nothing is allowed, set for them", () => {
    expect(jobSitesSummary({ permissions: [], permissionsInEffect: [] })).toEqual({
      text: "Nothing",
      source: "own",
    });
  });
});

describe("a removed person's data in Workbench (row 7)", () => {
  it("finds the machine Workbench runs on from its registration", () => {
    expect(workbenchMachine(clients)).toBe("Amish_Station");
    expect(workbenchMachine(clients.slice(1))).toBeNull();
  });

  it("says which retention applies, from Workbench's own settings", () => {
    expect(workbenchRemovalWords(null)).toBeNull();
    expect(workbenchRemovalWords({ removedPeopleRetention: "days", removedPeopleDays: 30 })).toBe(
      "Their chats, notes and documents in Workbench are kept hidden for 30 days, then deleted. " +
        "Export them in Workbench first.",
    );
    expect(workbenchRemovalWords({ removedPeopleRetention: "none", removedPeopleDays: 30 })).toBe(
      "Their chats, notes and documents in Workbench are deleted now, within the hour.",
    );
    expect(
      workbenchRemovalWords({ removedPeopleRetention: "days", removedPeopleDays: 1 }),
    ).toContain("for 1 day,");
    expect(workbenchRemovalWords("unreadable")).toBe(
      "Their chats, notes and documents in Workbench are deleted as Workbench's settings say.",
    );
  });
});

describe("group policies (row 70)", () => {
  const groups = [
    { id: "g-desk", name: "Desk" },
    { id: "g-night", name: "Night shift" },
  ];

  it("says each value in effect and the groups that set it", () => {
    expect(
      policiesSummary(
        {
          policiesInEffect: {
            queueBand: "interactive",
            summaryContextPercent: 85,
            setBy: { queueBand: ["g-desk", "g-night"], summaryContextPercent: ["g-gone"] },
          },
        },
        groups,
      ),
    ).toEqual({
      queue: "Interactive (from Desk, Night shift)",
      // A group the page has not loaded is named by its id, never dropped.
      summary: "85% (from g-gone)",
    });
  });

  it("says Not set for a policy no group sets, and nothing for an older root", () => {
    expect(policiesSummary({ policiesInEffect: {} }, groups)).toEqual({
      queue: "Not set",
      summary: "Not set",
    });
    expect(policiesSummary({}, groups)).toBeNull();
  });

  it("offers steps of five and keeps any other percent the root holds", () => {
    expect(summaryPercentChoices(null)).toEqual([50, 55, 60, 65, 70, 75, 80, 85, 90, 95]);
    expect(summaryPercentChoices(72)).toContain(72);
    expect(summaryPercentChoices(70)).toHaveLength(10);
  });

  it("knows a root has policies only from what it answered", () => {
    expect(rootKnowsPolicies([], [])).toBe(false);
    expect(rootKnowsPolicies(null, [{}])).toBe(false);
    expect(rootKnowsPolicies([{ policies: { queueBand: null } }], [])).toBe(true);
    expect(rootKnowsPolicies([], [{ policiesInEffect: {} }])).toBe(true);
  });

  it("sends every policy, null when not set", () => {
    expect(groupPoliciesBody("", null)).toEqual({ queueBand: null, summaryContextPercent: null });
    expect(groupPoliciesBody("background", 70)).toEqual({
      queueBand: "background",
      summaryContextPercent: 70,
    });
  });
});
