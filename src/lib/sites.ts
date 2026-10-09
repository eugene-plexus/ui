/**
 * Job sites, as the console shows them: membership only.
 *
 * **Design:** `specs/docs/design/job-sites-own-enrollment.md` §2.9. A job
 * site is a machine that is its own enrollment, separate from a node (J19).
 * What it shares, who may use it and which folders it offers are the
 * owner's, in Workbench. This console lists the sites, invites one and
 * removes one; only in dev mode does a site carry a section of its own
 * (J33).
 *
 * Pure, so the commands and the wording are tested as data.
 */

import { posixJoinCommand, windowsJoinCommand } from "./joinCommand";
import type { Site, SiteInvitation } from "./types";

/** Where a site's page is, filtered to that site. */
export function siteHref(id: string): string {
  return `/sites?sel=${encodeURIComponent(`site:${id}`)}`;
}

/** The Job sites page, filtered to the sites one person owns. */
export function ownerSitesHref(personId: string): string {
  return `/sites?owner=${encodeURIComponent(personId)}`;
}

/** Where a person is on the People page. */
export function personHref(personId: string): string {
  return `/people#person-${encodeURIComponent(personId)}`;
}

/** Where a machine is, on the Machines page. */
export function machineHref(node: string): string {
  return `/nodes?sel=${encodeURIComponent(`agent:${node}`)}`;
}

/** How many sites each person owns, by person id. */
export function siteCountsByOwner(sites: readonly Pick<Site, "owner">[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const site of sites) counts.set(site.owner, (counts.get(site.owner) ?? 0) + 1);
  return counts;
}

/** The sites whose machine is the named node, for the Machines page. */
export function sitesHostedBy(sites: readonly Site[], node: string): Site[] {
  return sites.filter((site) => site.hostNode === node);
}

/** The site's name for a person: its label, else a short form of its id. */
export function siteName(site: Pick<Site, "id" | "label">): string {
  return site.label?.trim() || site.id;
}

/** What the page says about a site's connection. */
export function describeContact(
  site: Pick<Site, "online" | "lastContactAt">,
  ago: (iso: string) => string | null,
): { state: "online" | "offline"; text: string } {
  const when = site.lastContactAt ? ago(site.lastContactAt) : null;
  if (site.online) return { state: "online", text: "Online" };
  return {
    state: "offline",
    text: when ? `Offline, last contact ${when}` : "Offline, no contact yet",
  };
}

/** What dev mode says about whether the site's owner has let Eugene's owner in. */
export function describeOwnerInDevMode(
  ownerInDevMode: boolean | null,
  ownerName: string,
): string | null {
  if (ownerInDevMode === true) return null;
  if (ownerInDevMode === false) {
    return (
      `${ownerName} has not let Eugene's owner in on this machine. ` +
      "Access you give yourself here does nothing until they do (Workbench, Job sites). " +
      "Dev mode alone opens nothing on a job site."
    );
  }
  return "This machine has not said yet whether its owner lets Eugene's owner in.";
}

export interface SiteCommands {
  windows: string;
  posix: string;
}

/**
 * The two one-line commands an invitation gives, run on a machine that is
 * already a node. `controlUrl` is what the root said, else what the person
 * typed; the label becomes the machine's name for the site.
 */
export function siteInviteCommands(
  invitation: Pick<SiteInvitation, "token" | "ownerName" | "rootKey" | "label">,
  controlUrl: string,
): SiteCommands {
  const details = {
    controlUrl,
    token: invitation.token,
    nodeName: invitation.label ?? null,
    jobSite: { owner: invitation.ownerName, rootKey: invitation.rootKey },
  };
  return { windows: windowsJoinCommand(details), posix: posixJoinCommand(details) };
}
