/**
 * People, and the apps that sign in with Eugene (C2): the page's words.
 *
 * **Design:** `specs/docs/design/sign-in-with-eugene.md` §4. A person is an
 * account the owner adds so someone can sign in to the apps they are
 * given; nobody added here can open this console. An app that signs in
 * with Eugene is an OpenID Connect client, registered by the agent when a
 * registry app that signs people in is installed, or here by hand for any
 * other app.
 *
 * Pure, so the page's sentences are tested against the wire's shapes.
 */

import type { GroupPolicies, OidcClient, PermissionGroup, Person, QueueBand } from "./types";

/**
 * What a person may do with job sites (J77, `job-sites-own-enrollment.md`
 * §3.3), each with the root's setting that is its default. They only
 * narrow: a site still needs the person's account on its machine, a link
 * made there and their own key.
 */
export const JOB_SITE_PERMISSIONS = [
  {
    id: "add-job-sites",
    label: "Add machines of their own as job sites",
    short: "add machines",
    setting: "peopleMayAddJobSites",
  },
  {
    id: "use-job-sites",
    label: "Use job sites as themselves: link their account on a machine and keep workspaces there",
    short: "use job sites as themselves",
    setting: "peopleMayUseJobSites",
  },
] as const;

export type JobSitePermission = (typeof JOB_SITE_PERMISSIONS)[number]["id"];

/** Where the install's defaults are set: the control root's Settings. */
export const PERMISSION_DEFAULTS_HREF = "/config?sel=control#peopleMayAddJobSites";

/**
 * What a person may do with job sites now, in words, and whether that is
 * the install's defaults or set for them. Read from `permissionsInEffect`,
 * the root's own answer, so the line never shows a value not in effect.
 */
export function jobSitesSummary(
  person: Pick<Person, "permissions" | "permissionsInEffect" | "groups">,
): {
  text: string;
  source: "defaults" | "own" | "groups";
} {
  const inEffect = new Set<string>(person.permissionsInEffect ?? []);
  const may = JOB_SITE_PERMISSIONS.filter((p) => inEffect.has(p.id)).map((p) => p.short);
  const text = may.length === 0 ? "Nothing" : may.join("; ");
  return {
    text,
    source: person.groups != null ? "groups" : person.permissions == null ? "defaults" : "own",
  };
}

/**
 * Row 70: the queue bands a group may set, highest first. The root returns
 * a verified person's band in its admission check; the gateway's queue
 * reads it.
 */
export const QUEUE_BANDS: readonly { id: QueueBand; label: string }[] = [
  { id: "interactive", label: "Interactive" },
  { id: "background", label: "Background" },
  { id: "sheddable", label: "Sheddable" },
];

/** The percents a group may set for summarising, the root's own bounds. */
export const SUMMARY_PERCENT_MIN = 50;
export const SUMMARY_PERCENT_MAX = 95;

/** The summary percents the console offers: steps of five, and any other value the root holds. */
export function summaryPercentChoices(current: number | null | undefined): number[] {
  const steps: number[] = [];
  for (let p = SUMMARY_PERCENT_MIN; p <= SUMMARY_PERCENT_MAX; p += 5) steps.push(p);
  if (current != null && !steps.includes(current)) steps.push(current);
  return steps.sort((a, b) => a - b);
}

export function queueBandLabel(band: QueueBand | null | undefined): string {
  return QUEUE_BANDS.find((b) => b.id === band)?.label ?? "Not set";
}

export function summaryPercentLabel(percent: number | null | undefined): string {
  return percent == null ? "Not set" : `${percent}%`;
}

/** Whether the root's records show it knows group policies (an older root leaves them out). */
export function rootKnowsPolicies(
  groups: Pick<PermissionGroup, "policies">[] | null,
  people: Pick<Person, "policiesInEffect">[],
): boolean {
  return (
    (groups ?? []).some((g) => g.policies !== undefined) ||
    people.some((p) => p.policiesInEffect !== undefined)
  );
}

/** A group's policies as the console sends them: every policy, null when not set. */
export function groupPoliciesBody(
  band: QueueBand | "",
  percent: number | null,
): Required<GroupPolicies> {
  return { queueBand: band || null, summaryContextPercent: percent };
}

/**
 * What applies to a person now, each value with the groups that set it,
 * from the root's `policiesInEffect`. Null for an older root, which has
 * no policies: the page then says nothing rather than "Not set".
 */
export function policiesSummary(
  person: Pick<Person, "policiesInEffect">,
  groups: Pick<PermissionGroup, "id" | "name">[] | null,
): { queue: string; summary: string } | null {
  const effect = person.policiesInEffect;
  if (effect === undefined) return null;
  const from = (ids: string[] | undefined) => {
    const names = (ids ?? []).map((id) => groups?.find((g) => g.id === id)?.name ?? id);
    return names.length ? ` (from ${names.join(", ")})` : "";
  };
  return {
    queue:
      effect.queueBand == null
        ? "Not set"
        : queueBandLabel(effect.queueBand) + from(effect.setBy?.queueBand),
    summary:
      effect.summaryContextPercent == null
        ? "Not set"
        : summaryPercentLabel(effect.summaryContextPercent) +
          from(effect.setBy?.summaryContextPercent),
  };
}

/** The shortest password the root accepts, the console's passphrase rule. */
export const MIN_PASSWORD = 12;

/** Which apps a person may sign in to, in words. */
export function appsSummary(
  person: Pick<Person, "apps" | "appsInEffect" | "groups">,
  clients: OidcClient[],
): string {
  const apps =
    person.groups != null || "appsInEffect" in person ? person.appsInEffect : person.apps;
  if (apps == null) return "Every app";
  if (apps.length === 0) return "No apps";
  const names = apps.map((id) => clients.find((c) => c.clientId === id)?.name ?? id);
  return names.join(", ");
}

/**
 * Where an app's registration came from. The agent registers an app it
 * installs as `app:<id>@<machine>`; anything else was added on this page.
 */
export function ownerLabel(owner: string | null | undefined): string | null {
  if (!owner) return null;
  const installed = /^app:([^@]+)@(.+)$/.exec(owner);
  if (installed) return `installed on ${installed[2]}`;
  return null;
}

/** Whether removing this registration here would break an installed app. */
export function installedByAgent(client: Pick<OidcClient, "owner">): boolean {
  return ownerLabel(client.owner) !== null;
}

/**
 * The machine Workbench runs on, from the registration the agent made for it
 * (`app:workbench@<machine>`), or null when no machine runs it.
 */
export function workbenchMachine(clients: Pick<OidcClient, "owner">[]): string | null {
  for (const client of clients) {
    const found = /^app:workbench@(.+)$/.exec(client.owner ?? "");
    if (found?.[1]) return found[1];
  }
  return null;
}

/**
 * What Delete account says of the person's data in Workbench (row 7), from
 * Workbench's own settings: kept hidden for its days, then deleted, or
 * deleted at once. Workbench learns of a removal within the hour. Null when
 * no Workbench runs; a general sentence when its settings cannot be read.
 */
export function workbenchRemovalWords(
  settings: Record<string, unknown> | "unreadable" | null,
): string | null {
  if (settings === null) return null;
  const subject = "Their chats, notes and documents in Workbench";
  if (settings === "unreadable") {
    return `${subject} are deleted as Workbench's settings say.`;
  }
  if (settings.removedPeopleRetention === "none") {
    return `${subject} are deleted now, within the hour.`;
  }
  const days = typeof settings.removedPeopleDays === "number" ? settings.removedPeopleDays : 30;
  return `${subject} are kept hidden for ${days} ${days === 1 ? "day" : "days"}, then deleted. Export them in Workbench first.`;
}

/** One return address per line, blank lines dropped, each trimmed. */
export function parseReturnAddresses(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}

/** Why a return address will be refused, or null. The root's own rule. */
export function returnAddressProblem(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return `${address} is not a full address. Start it with http:// or https://.`;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `${address} must start with http:// or https://.`;
  }
  if (address.includes("#")) return `${address} cannot have a # part.`;
  return null;
}

const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

export interface SignInAddress {
  /** The issuer to give an app, ending in /oidc. */
  url: string;
  /** Set on the root's Settings, rather than this page's own address. */
  configured: boolean;
  /** Only this computer can open it. */
  loopback: boolean;
}

/**
 * The address an app is set up with. The root names the configured one
 * when there is one; otherwise every agent forwards `/oidc` to the root,
 * so the address this page was opened at is one an app can use too.
 */
export function signInAddress(
  configured: string | null | undefined,
  page: { protocol: string; host: string; hostname: string },
): SignInAddress {
  if (configured && configured.trim()) {
    const url = configured.trim().replace(/\/+$/, "");
    let loopback = false;
    try {
      loopback = LOOPBACK.test(new URL(url).hostname);
    } catch {
      loopback = false;
    }
    return { url, configured: true, loopback };
  }
  return {
    url: `${page.protocol}//${page.host}/oidc`,
    configured: false,
    loopback: LOOPBACK.test(page.hostname),
  };
}

/** Why a new person will be refused, or null. The root's own rules. */
/** What the email field is for, said where it is asked (C4). */
export const EMAIL_HINT =
  "Apps that know people by their email, such as Open WebUI, are given it. Eugene sends no mail to it.";

/** Why an address cannot be saved, or null. Blank is allowed: it is optional. */
export function emailProblem(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return null;
  return /^[^@\s]+@[^@\s]+$/.test(trimmed) ? null : "That does not look like an email address.";
}

export function newPersonProblem(
  name: string,
  password: string,
  operatorName: string,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give them a name to sign in with.";
  if (trimmed.includes("@")) return "A name cannot have an @ in it.";
  if (trimmed.toLowerCase() === operatorName.toLowerCase()) {
    return `${operatorName} is you, with Eugene's passphrase. Pick another name.`;
  }
  if (password.length < MIN_PASSWORD) {
    return `A password needs at least ${MIN_PASSWORD} characters.`;
  }
  return null;
}
