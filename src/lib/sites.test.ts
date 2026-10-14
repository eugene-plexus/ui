import { describe, expect, it } from "vitest";

import {
  describeContact,
  describeOwnerInDevMode,
  machineHref,
  ownerSitesHref,
  personHref,
  siteCountsByOwner,
  siteHref,
  siteInviteCommands,
  siteName,
  sitesHostedBy,
} from "./sites";
import type { Site } from "./types";

const site = (over: Partial<Site>): Site =>
  ({
    id: "s-1",
    label: "Laptop",
    owner: "p-a",
    ownerName: "ada",
    online: true,
    ready: true,
    enrolledAt: "2026-10-06T00:00:00Z",
    ...over,
  }) as Site;

describe("job site links", () => {
  it("point at the page, the owner and the machine", () => {
    expect(siteHref("s-1")).toBe("/sites?sel=site%3As-1");
    expect(ownerSitesHref("p-a")).toBe("/sites?owner=p-a");
    expect(personHref("p-a")).toBe("/people#person-p-a");
    expect(machineHref("Amish_Station")).toBe("/nodes?sel=agent%3AAmish_Station");
  });
});

describe("job site lists", () => {
  it("counts by owner and finds the sites a machine hosts", () => {
    const sites = [
      site({ id: "s-1", owner: "p-a", hostNode: "n1" }),
      site({ id: "s-2", owner: "p-a", hostNode: null }),
      site({ id: "s-3", owner: "p-b", hostNode: "n2" }),
    ];
    expect([...siteCountsByOwner(sites)]).toEqual([
      ["p-a", 2],
      ["p-b", 1],
    ]);
    expect(sitesHostedBy(sites, "n1").map((s) => s.id)).toEqual(["s-1"]);
    expect(sitesHostedBy(sites, "nobody")).toEqual([]);
  });

  it("names a site by its label, else its id", () => {
    expect(siteName({ id: "s-1", label: " Laptop " })).toBe("Laptop");
    expect(siteName({ id: "s-1", label: "" })).toBe("s-1");
  });
});

describe("what a site's connection says", () => {
  const ago = (iso: string) => `ago(${iso})`;
  it("says online, or offline with the last contact", () => {
    expect(describeContact({ online: true, lastContactAt: "t" }, ago).text).toBe("Online");
    expect(describeContact({ online: false, lastContactAt: "t" }, ago)).toEqual({
      state: "offline",
      text: "Offline, last contact ago(t)",
    });
    expect(describeContact({ online: false, lastContactAt: null }, ago).text).toBe(
      "Offline, no contact yet",
    );
  });

  it("reports true, false and not-yet-reported for the owner's door in dev mode", () => {
    expect(describeOwnerInDevMode(true, "ada")).toBeNull();
    expect(describeOwnerInDevMode(false, "ada")).toContain("ada has not let Eugene's owner in");
    expect(describeOwnerInDevMode(null, "ada")).toContain("has not said yet");
  });
});

describe("the invitation commands", () => {
  const invitation = { token: "T0K", ownerName: "ada", rootKey: "AbC+/def=", label: "work-laptop" };

  it("name the owner, the root key and the machine name on each shell", () => {
    const { windows, posix } = siteInviteCommands(invitation, "https://nodes.example.org");
    expect(windows).toMatch(
      /-Join https:\/\/nodes\.example\.org -Token T0K -JobSite -Owner ada -RootKey AbC\+\/def= -NodeName work-laptop$/,
    );
    expect(posix).toMatch(
      /--join https:\/\/nodes\.example\.org --token T0K --job-site --owner ada --root-key AbC\+\/def= --name work-laptop$/,
    );
  });

  it("leave the machine name out when there is none, and quote an owner with a space", () => {
    const { windows, posix } = siteInviteCommands(
      { ...invitation, label: null, ownerName: "Ada O'Neil" },
      "http://10.0.0.2:8083",
    );
    expect(windows).not.toContain("-NodeName");
    expect(posix).not.toContain("--name");
    expect(windows).toContain("-Owner 'Ada O''Neil'");
  });
});
