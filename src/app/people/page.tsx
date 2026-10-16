"use client";

/**
 * People, and the apps that sign in with Eugene (C2).
 *
 * **Design:** `specs/docs/design/sign-in-with-eugene.md` §4. On the
 * install root because both live in the control root's log and answer for
 * the whole install, whichever machine an app runs on.
 *
 * Plain words: the workshop names are Workbench's. Every read and write
 * goes to the control root (`/v1/people`, `/v1/oidc/clients`), which is
 * operator-only; a sealed root reads as the sentence it answers with, and
 * the header's Issues badge carries the unlock.
 *
 * **A secret is on screen once.** A new app's client secret is in the
 * answer that made it and nowhere else, so the panel that shows it stays
 * until the person closes it, and says why.
 */

import Link from "next/link";
import { useCallback, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { AdministrationGrants } from "@/components/AdministrationGrants";
import { PersonSection } from "@/components/PersonSection";
import { ExternalSignIn, PersonSignIn } from "@/components/ExternalSignIn";
import { PeopleDirectory } from "@/components/PeopleDirectory";
import { AccessAudit } from "@/components/AccessAudit";
import { ConfirmButton } from "@/components/ConfirmButton";
import { PermissionGroups, PersonGroups } from "@/components/PermissionGroups";
import { CopyButton } from "@/components/CopyButton";
import { api, describeError } from "@/lib/api";
import {
  MIN_PASSWORD,
  appsSummary,
  EMAIL_HINT,
  emailProblem,
  installedByAgent,
  JOB_SITE_PERMISSIONS,
  jobSitesSummary,
  PERMISSION_DEFAULTS_HREF,
  newPersonProblem,
  ownerLabel,
  parseReturnAddresses,
  returnAddressProblem,
  signInAddress,
} from "@/lib/people";
import { ownerSitesHref, siteCountsByOwner } from "@/lib/sites";
import type {
  OidcClient,
  OidcClientCreated,
  OidcClientList,
  Person,
  PermissionGroup,
  PermissionGroupList,
  PersonCreateRequest,
  PersonList,
  SiteList,
} from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

const POLL_MS = 10_000;

const buttonClass =
  "action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2.5 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40";
const primaryClass =
  "action-button action-button--primary font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40";
const inputClass =
  "w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 text-sm outline-none hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)]";
const rowClass =
  "flex flex-col gap-2 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2";

/** The control root's Settings, where the sign-in address is set. */
const ROOT_SETTINGS = "/config?sel=control";

interface Loaded {
  people: Person[];
  owner: PersonList["owner"];
  groups: PermissionGroup[] | null;
  groupsError: string | null;
  operatorName: string;
  clients: OidcClient[];
  issuer: string | null;
  /** How many job sites each person owns, by person id. */
  sites: Map<string, number>;
}

export default function PeoplePage() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [people, clients, sites, groups] = await Promise.all([
        api.get<PersonList>("control", "/v1/people"),
        api.get<OidcClientList>("control", "/v1/oidc/clients"),
        // Job sites are a count beside each person, never a reason to fail.
        api.get<SiteList>("control", "/v1/sites").catch(() => null),
        api.get<PermissionGroupList>("control", "/v1/permission-groups").then(
          (data) => ({
            groups: data.groups ?? null,
            error: data.groups ? null : "The root does not provide groups yet.",
          }),
          (e) => ({ groups: null, error: describeError(e) }),
        ),
      ]);
      setLoaded({
        people: people.people ?? [],
        owner: people.owner,
        groups: groups.groups,
        groupsError: groups.error,
        operatorName: people.operatorName ?? "operator",
        clients: clients.clients ?? [],
        issuer: clients.issuer ?? null,
        sites: siteCountsByOwner(sites?.sites ?? []),
      });
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }, []);
  usePolling(load, POLL_MS);

  return (
    <AppShell>
      <main data-testid="people-scroll" className="relative z-10 min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8">
          <p className="text-sm text-[color:var(--muted)]">
            One account directory for Eugene and its apps, including Workbench. Manage people, their
            app access, shared permission groups, and delegated administration here. Named
            administrators use{" "}
            <Link href="/administration/" className="underline">
              People and access sign-in
            </Link>
            .
          </p>
          {error && (
            <p className="status-error rounded-[var(--radius)] px-2 py-1 text-sm" role="alert">
              {error}
            </p>
          )}
          {loaded === null ? (
            !error && <p className="font-ui text-sm text-[color:var(--muted)]">Loading…</p>
          ) : (
            <PeopleSection loaded={loaded} onChanged={load} />
          )}
        </div>
      </main>
    </AppShell>
  );
}

// --------------------------------------------------------------------------- #
// people
// --------------------------------------------------------------------------- #

function PeopleSection({ loaded, onChanged }: { loaded: Loaded; onChanged: () => Promise<void> }) {
  const { people, operatorName, clients, sites } = loaded;
  return (
    <PeopleDirectory
      people={people}
      groups={loaded.groups}
      renderPerson={(person) => (
        <>
          {loaded.groupsError && (
            <p role="alert" className="status-error mb-3 text-sm">
              Permission groups could not be loaded. {loaded.groupsError}
            </p>
          )}
          <PersonRow
            person={person}
            clients={clients}
            groups={loaded.groups}
            sites={sites.get(person.id) ?? 0}
            onChanged={onChanged}
          />
        </>
      )}
      introduction={
        <>
          <details className={rowClass} data-testid="protected-owner">
            <summary className="cursor-pointer text-sm">
              <strong>{loaded.owner?.displayName ?? "Owner"}</strong>{" "}
              <span className="font-mono">{loaded.owner?.name ?? operatorName}</span>{" "}
              <span className="status-success">Protected owner</span>
            </summary>
            <p className="text-sm text-[color:var(--muted)]">
              You sign in to apps as <span className="font-mono">{operatorName}</span>, with
              Eugene&rsquo;s passphrase. Full console access. The owner account and recovery
              passphrase are managed separately from member accounts and groups.
            </p>
          </details>
          <AddPerson operatorName={operatorName} clients={clients} onAdded={onChanged} />
        </>
      }
    >
      <PermissionGroups
        groups={loaded.groups}
        clients={clients}
        people={people}
        error={loaded.groupsError}
        onChanged={onChanged}
      />
      <AppsSection loaded={loaded} onChanged={onChanged} />
      <ExternalSignIn />
      <AccessAudit
        names={Object.fromEntries([
          ...people.map((person) => [person.id, person.displayName || person.name]),
          ...(loaded.groups ?? []).map((group) => [group.id, group.name]),
          ...clients.map((client) => [client.clientId, client.name]),
        ])}
      />
    </PeopleDirectory>
  );
}

function PersonRow({
  person,
  clients,
  groups,
  sites,
  onChanged,
}: {
  person: Person;
  groups: PermissionGroup[] | null;
  clients: OidcClient[];
  /** How many job sites this person owns. */
  sites: number;
  onChanged: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function change(run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      await onChanged();
      return true;
    } catch (e) {
      setError(describeError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const path = `/v1/people/${encodeURIComponent(person.id)}`;
  return (
    <article
      className="flex min-w-0 flex-col gap-5"
      id={`person-${person.id}`}
      data-testid={`person-${person.name}`}
    >
      <PersonSection title="Account details">
        <div className="grid min-w-0 gap-6 md:grid-cols-2">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] content-start gap-x-5 gap-y-3 text-sm">
            <dt className="text-[color:var(--muted)]">Account name</dt>
            <dd className="break-words">{person.name}</dd>
            <dt className="text-[color:var(--muted)]">Display name</dt>
            <dd className="break-words">{person.displayName || "Not set"}</dd>
            <dt className="text-[color:var(--muted)]">Sign-in status</dt>
            <dd
              className={person.disabled ? "status-warn" : "status-success"}
              data-testid={`person-state-${person.name}`}
            >
              {person.disabled ? "Signing in is off" : "Can sign in"}
            </dd>
            <dt className="text-[color:var(--muted)]">Job sites</dt>
            <dd>
              {sites > 0 ? (
                <Link
                  href={ownerSitesHref(person.id)}
                  className="underline"
                  data-testid={`person-sites-${person.name}`}
                >
                  {sites === 1 ? "1 job site" : `${sites} job sites`}
                </Link>
              ) : (
                <span data-testid={`person-sites-${person.name}`}>None</span>
              )}
            </dd>
          </dl>
          <ChangeEmail
            person={person}
            busy={busy}
            onSave={(email) => change(() => api.patch("control", path, { email }))}
          />
        </div>
      </PersonSection>
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
        <PersonSection title="Groups and app access">
          <div className="space-y-2 rounded-[var(--radius)] bg-[color:var(--panel-soft)] p-3 text-sm">
            <p className="font-semibold">Current access</p>
            <p>
              <span className="text-[color:var(--muted)]">Apps: </span>
              <span data-testid={`person-apps-${person.name}`}>{appsSummary(person, clients)}</span>
            </p>
            <JobSitesLine person={person} />
            {person.groups != null && (
              <p className="break-words">
                <span className="text-[color:var(--muted)]">Access from groups: </span>
                {person.groups
                  .map((id) => groups?.find((g) => g.id === id)?.name ?? id)
                  .join(", ") || "None selected"}
              </p>
            )}
          </div>
          {groups !== null && (
            <PersonGroups
              key={JSON.stringify(person.groups)}
              person={person}
              groups={groups}
              onSave={(groups) => change(() => api.patch("control", path, { groups }))}
            />
          )}
          {person.groups == null && (
            <div className="space-y-5 border-t border-[color:var(--border)] pt-4">
              <ChooseApps
                person={person}
                clients={clients}
                busy={busy}
                onSave={(apps) => change(() => api.patch("control", path, { apps }))}
              />
              <ChoosePermissions
                person={person}
                busy={busy}
                onSave={(permissions) => change(() => api.patch("control", path, { permissions }))}
              />
            </div>
          )}
        </PersonSection>
        {groups !== null && (
          <AdministrationGrants person={person} groups={groups} onChanged={onChanged} />
        )}
      </div>
      <PersonSignIn personId={person.id} />
      <PersonSection title="Account actions">
        <div className="grid min-w-0 gap-6 md:grid-cols-2">
          <NewPassword
            name={person.name}
            busy={busy}
            onSave={(password) =>
              change(() => api.put("control", `${path}/password`, { password }))
            }
          />
          <div className="flex flex-col gap-5 border-t border-[color:var(--border)] pt-5 md:border-t-0 md:border-l md:pt-0 md:pl-6">
            <div className="space-y-2">
              <h4 className="font-ui font-semibold">Account status</h4>
              <p className="text-sm text-[color:var(--muted)]">
                {person.disabled
                  ? "Allow this person to sign in again."
                  : "Turn off signing in while keeping the account and its settings."}
              </p>
              <button
                type="button"
                className={buttonClass}
                disabled={busy}
                onClick={() =>
                  void change(() => api.patch("control", path, { disabled: !person.disabled }))
                }
                data-testid={`person-toggle-${person.name}`}
                aria-label={`${person.disabled ? "Turn signing in on" : "Turn signing in off"} for ${person.name}`}
              >
                {person.disabled ? "Turn signing in on" : "Turn signing in off"}
              </button>
            </div>
            <div className="space-y-2 border-t border-[color:var(--border)] pt-4">
              <h4 className="font-ui font-semibold">Delete account</h4>
              <p className="text-sm text-[color:var(--muted)]">
                Permanently remove this account and its owned job sites.
              </p>
              <ConfirmButton
                label="Delete account"
                ariaLabel={`Delete ${person.name}`}
                confirmLabel={`Delete ${person.name}`}
                prompt="This cannot be undone. Their apps sign them out within ten minutes."
                onConfirm={async () => {
                  await change(() => api.delete("control", path));
                }}
                disabled={busy}
                className={`${buttonClass} status-error`}
                testId={`person-delete-${person.name}`}
              />
            </div>
          </div>
        </div>
      </PersonSection>
      {error && (
        <p className="status-error text-sm" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

/**
 * What a person may do with job sites now (J77): read from the root's
 * `permissionsInEffect`, and said to be the install's defaults when they
 * have none of their own, linking to where those are set.
 */
function JobSitesLine({ person }: { person: Person }) {
  const summary = jobSitesSummary(person);
  return (
    <p className="text-sm" data-testid={`person-permissions-${person.name}`}>
      <span className="text-[color:var(--muted)]">May with job sites: </span>
      <span data-testid={`person-permissions-text-${person.name}`}>{summary.text}</span>{" "}
      {summary.source === "defaults" ? (
        <span className="text-[color:var(--muted)]">
          (the install&rsquo;s defaults, set under{" "}
          <Link href={PERMISSION_DEFAULTS_HREF} className="underline">
            the control root&rsquo;s Settings
          </Link>
          )
        </span>
      ) : (
        <span className="text-[color:var(--muted)]">
          {summary.source === "groups" ? "(from groups)" : "(set for them)"}
        </span>
      )}
    </p>
  );
}

/**
 * The install's defaults, or exactly the permissions ticked. Null on the
 * wire is the defaults, so changing a default changes everyone left on it.
 */
function ChoosePermissions({
  person,
  onSave,
  busy,
}: {
  person: Pick<Person, "permissions" | "permissionsInEffect" | "name">;
  onSave: (permissions: string[] | null) => Promise<boolean>;
  busy: boolean;
}) {
  const [defaults, setDefaults] = useState(person.permissions == null);
  const [chosen, setChosen] = useState<string[]>(
    person.permissions ?? person.permissionsInEffect ?? [],
  );
  return (
    <fieldset
      disabled={busy}
      className="min-w-0 text-sm"
      data-testid={`person-choose-permissions-${person.name}`}
    >
      <legend className="font-ui font-semibold">Job-site permissions</legend>
      <div className="mt-2 flex flex-col gap-3">
        <details className="text-[color:var(--muted)]">
          <summary className="cursor-pointer">How job-site permissions work</summary>
          <p className="mt-2">
            These only narrow: a machine still needs their own account on it, a link they make
            there, and their own key on their own changes. A folder a site&rsquo;s owner shares with
            them works either way.
          </p>
        </details>
        <label className="font-ui flex items-center gap-2">
          <input
            type="checkbox"
            checked={defaults}
            onChange={(e) => setDefaults(e.target.checked)}
          />
          Follow the install&rsquo;s defaults (
          <Link href={PERMISSION_DEFAULTS_HREF} className="underline">
            set in Settings
          </Link>
          )
        </label>
        {!defaults &&
          JOB_SITE_PERMISSIONS.map((permission) => (
            <label key={permission.id} className="font-ui flex items-center gap-2 pl-5">
              <input
                type="checkbox"
                checked={chosen.includes(permission.id)}
                onChange={(e) =>
                  setChosen(
                    e.target.checked
                      ? [...chosen, permission.id]
                      : chosen.filter((id) => id !== permission.id),
                  )
                }
              />
              {permission.label}
            </label>
          ))}
        <div>
          <button
            type="button"
            className={primaryClass}
            onClick={() =>
              void onSave(
                defaults
                  ? null
                  : JOB_SITE_PERMISSIONS.map((p) => p.id).filter((id) => chosen.includes(id)),
              )
            }
          >
            Save job-site permissions
          </button>
        </div>
      </div>
    </fieldset>
  );
}

/** Every app, or the ones ticked. Null on the wire is every app. */
function ChooseApps({
  person,
  clients,
  onSave,
  busy,
}: {
  person: Pick<Person, "apps" | "name">;
  clients: OidcClient[];
  onSave: (apps: string[] | null) => Promise<boolean>;
  busy: boolean;
}) {
  const [every, setEvery] = useState(person.apps == null);
  const [chosen, setChosen] = useState<string[]>(person.apps ?? []);
  return (
    <fieldset
      disabled={busy}
      className="min-w-0 text-sm"
      data-testid={`person-choose-apps-${person.name}`}
    >
      <legend className="font-ui font-semibold">Allowed apps</legend>
      <div className="mt-2 flex flex-col gap-3">
        <AppChoices
          clients={clients}
          every={every}
          chosen={chosen}
          onEvery={setEvery}
          onChosen={setChosen}
        />
        <div>
          <button
            type="button"
            className={primaryClass}
            onClick={() => void onSave(every ? null : chosen)}
          >
            Save apps
          </button>
        </div>
      </div>
    </fieldset>
  );
}

function AppChoices({
  clients,
  every,
  chosen,
  onEvery,
  onChosen,
}: {
  clients: OidcClient[];
  every: boolean;
  chosen: string[];
  onEvery: (every: boolean) => void;
  onChosen: (chosen: string[]) => void;
}) {
  return (
    <>
      <label className="font-ui flex items-center gap-2">
        <input type="checkbox" checked={every} onChange={(e) => onEvery(e.target.checked)} />
        Every app, including ones added later
      </label>
      {!every &&
        (clients.length === 0 ? (
          <p className="text-[color:var(--muted)]">No apps sign in with Eugene yet.</p>
        ) : (
          clients.map((client) => (
            <label key={client.clientId} className="font-ui flex items-center gap-2 pl-5">
              <input
                type="checkbox"
                checked={chosen.includes(client.clientId)}
                onChange={(e) =>
                  onChosen(
                    e.target.checked
                      ? [...chosen, client.clientId]
                      : chosen.filter((id) => id !== client.clientId),
                  )
                }
              />
              {client.name}
            </label>
          ))
        ))}
    </>
  );
}

function NewPassword({
  name,
  onSave,
  busy,
}: {
  name: string;
  onSave: (password: string) => Promise<boolean>;
  busy: boolean;
}) {
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState(false);
  const short = password.length > 0 && password.length < MIN_PASSWORD;
  return (
    <form
      className="flex min-w-0 flex-col gap-3 text-sm"
      data-testid={`person-password-${name}`}
      onSubmit={async (e) => {
        e.preventDefault();
        setSaved(false);
        if (await onSave(password)) {
          setPassword("");
          setSaved(true);
        }
      }}
    >
      <h4 className="font-ui font-semibold">Reset password</h4>
      <p className="text-[color:var(--muted)]">
        Tell them the new one. Their apps sign them out within ten minutes, and they can change it
        when they next sign in.
      </p>
      <label className="flex max-w-sm flex-col gap-2">
        New password
        <input
          type="password"
          autoComplete="new-password"
          className={inputClass}
          value={password}
          disabled={busy}
          minLength={MIN_PASSWORD}
          required
          onChange={(e) => {
            setPassword(e.target.value);
            setSaved(false);
          }}
          aria-label={`New password for ${name}`}
        />
      </label>
      {short && <p className="status-warn text-sm">At least {MIN_PASSWORD} characters.</p>}
      <button
        type="submit"
        className={`${primaryClass} self-start`}
        disabled={busy || password.length < MIN_PASSWORD}
      >
        Set password
      </button>
      {saved && (
        <p role="status" className="status-success">
          Password updated.
        </p>
      )}
    </form>
  );
}

/** Set or clear a person's address. Null on the wire clears it. */
function ChangeEmail({
  person,
  onSave,
  busy,
}: {
  person: Pick<Person, "email" | "name">;
  onSave: (email: string | null) => Promise<boolean>;
  busy: boolean;
}) {
  const [email, setEmail] = useState(person.email ?? "");
  const problem = emailProblem(email);
  return (
    <fieldset
      disabled={busy}
      className="min-w-0 text-sm"
      data-testid={`person-change-email-${person.name}`}
    >
      <legend className="font-ui font-semibold">Email address</legend>
      <div className="mt-2 flex max-w-sm flex-col gap-2">
        <p className="text-[color:var(--muted)]">{EMAIL_HINT}</p>
        {person.email && (
          <p className="break-words" data-testid={`person-email-${person.name}`}>
            Current: {person.email}
          </p>
        )}
        <input
          type="email"
          autoComplete="off"
          className={inputClass}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label={`Email for ${person.name}`}
        />
        {problem && <p className="status-warn text-sm">{problem}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={primaryClass}
            disabled={!email.trim() || Boolean(problem)}
            onClick={() => void onSave(email.trim())}
          >
            Save email
          </button>
          {person.email && (
            <button
              type="button"
              className={buttonClass}
              onClick={async () => {
                if (await onSave(null)) setEmail("");
              }}
            >
              Remove email
            </button>
          )}
        </div>
      </div>
    </fieldset>
  );
}

function AddPerson({
  operatorName,
  clients,
  onAdded,
}: {
  operatorName: string;
  clients: OidcClient[];
  onAdded: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [every, setEvery] = useState(true);
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const problem = newPersonProblem(name, password, operatorName) ?? emailProblem(email);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const body: PersonCreateRequest = {
        name: name.trim(),
        password,
        apps: every ? null : chosen,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
      };
      await api.post("control", "/v1/people", body);
      setName("");
      setDisplayName("");
      setEmail("");
      setPassword("");
      setEvery(true);
      setChosen([]);
      await onAdded();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <details
      className="rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2"
      data-testid="people-add"
    >
      <summary className="font-ui cursor-pointer text-sm font-semibold">Add a person</summary>
      <div className="mt-3 flex max-w-md flex-col gap-3 text-sm">
        <label className="font-ui flex flex-col gap-1">
          Name they sign in with
          <input
            className={inputClass}
            value={name}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
            data-testid="people-add-name"
          />
        </label>
        <label className="font-ui flex flex-col gap-1">
          <span>
            Full name <span className="text-[color:var(--muted)]">— optional, shown in apps</span>
          </span>
          <input
            className={inputClass}
            value={displayName}
            autoComplete="off"
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>
        <label className="font-ui flex flex-col gap-1">
          <span>
            Email <span className="text-[color:var(--muted)]">— optional. {EMAIL_HINT}</span>
          </span>
          <input
            type="email"
            className={inputClass}
            value={email}
            autoComplete="off"
            onChange={(e) => setEmail(e.target.value)}
            data-testid="people-add-email"
          />
        </label>
        <label className="font-ui flex flex-col gap-1">
          <span>
            First password{" "}
            <span className="text-[color:var(--muted)]">
              — at least {MIN_PASSWORD} characters; they can change it when they sign in
            </span>
          </span>
          <input
            type="password"
            autoComplete="new-password"
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="people-add-password"
          />
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend className="font-ui mb-1">Apps they may sign in to</legend>
          <AppChoices
            clients={clients}
            every={every}
            chosen={chosen}
            onEvery={setEvery}
            onChosen={setChosen}
          />
        </fieldset>
        {(name || password) && problem && <p className="status-warn">{problem}</p>}
        {error && (
          <p className="status-error" role="alert">
            {error}
          </p>
        )}
        <div>
          <button
            type="button"
            className={primaryClass}
            disabled={problem !== null || saving}
            onClick={() => void submit()}
            data-testid="people-add-submit"
          >
            {saving ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </details>
  );
}

// --------------------------------------------------------------------------- #
// apps that sign in with Eugene
// --------------------------------------------------------------------------- #

function AppsSection({ loaded, onChanged }: { loaded: Loaded; onChanged: () => Promise<void> }) {
  const page =
    typeof window === "undefined"
      ? { protocol: "http:", host: "localhost", hostname: "localhost" }
      : window.location;
  const address = signInAddress(loaded.issuer, page);
  return (
    <section aria-labelledby="sign-in-apps-heading" className="section-panel flex flex-col gap-3">
      <h2
        id="sign-in-apps-heading"
        className="section-heading font-ui mb-0 text-base font-semibold"
      >
        Apps that sign in with Eugene
      </h2>
      <div className={rowClass} data-testid="people-sign-in-address">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-ui">Sign-in address for apps:</span>
          <code className="font-mono" data-testid="people-sign-in-address-url">
            {address.url}
          </code>
          <CopyButton text={address.url} />
        </div>
        <p className="text-sm text-[color:var(--muted)]">
          {address.configured
            ? "Eugene’s configured sign-in address. "
            : "This is the address this page was opened at. "}
          {address.loopback &&
            "Only this computer can open it, so an app on another machine needs another address. "}
          Container access setup chooses it automatically. An explicit override is available under{" "}
          <Link href={ROOT_SETTINGS} className="underline">
            the control root&rsquo;s Settings
          </Link>
          .
        </p>
      </div>
      {loaded.clients.length === 0 ? (
        <p className="text-sm text-[color:var(--muted)]" data-testid="people-no-apps">
          No apps sign in with Eugene yet. Installing one from{" "}
          <Link href="/apps" className="underline">
            Apps
          </Link>{" "}
          that does sets it up for you.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="people-apps">
          {loaded.clients.map((client) => (
            <SignInApp key={client.clientId} client={client} onChanged={onChanged} />
          ))}
        </ul>
      )}
      <AddSignInApp onAdded={onChanged} />
    </section>
  );
}

function SignInApp({ client, onChanged }: { client: OidcClient; onChanged: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const owner = ownerLabel(client.owner);
  const fromAgent = installedByAgent(client);
  return (
    <li className={rowClass} data-testid={`sign-in-app-${client.clientId}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-ui font-semibold">{client.name}</span>
        <span className="text-sm text-[color:var(--muted)]">{owner ?? "added here"}</span>
        <span className="ml-auto">
          <ConfirmButton
            label="Remove"
            confirmLabel={`Remove ${client.name}`}
            prompt={
              fromAgent
                ? "Nobody can sign in to it until it is installed again. Uninstalling it on Apps removes this too."
                : "Nobody can sign in to it any more."
            }
            onConfirm={async () => {
              try {
                await api.delete(
                  "control",
                  `/v1/oidc/clients/${encodeURIComponent(client.clientId)}`,
                );
                await onChanged();
              } catch (e) {
                setError(describeError(e));
              }
            }}
            className={buttonClass}
            testId={`sign-in-app-remove-${client.clientId}`}
          />
        </span>
      </div>
      <p className="text-sm">
        <span className="text-[color:var(--muted)]">Client ID: </span>
        <code className="font-mono">{client.clientId}</code>
      </p>
      <details className="text-sm">
        <summary className="font-ui cursor-pointer text-[color:var(--muted)]">
          Return addresses
        </summary>
        <ul className="mt-1 font-mono">
          {client.redirectUris.map((uri) => (
            <li key={uri}>{uri}</li>
          ))}
        </ul>
      </details>
      {error && (
        <p className="status-error text-sm" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

function AddSignInApp({ onAdded }: { onAdded: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [addresses, setAddresses] = useState("");
  const [made, setMade] = useState<OidcClientCreated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const uris = parseReturnAddresses(addresses);
  const problem = uris.map(returnAddressProblem).find((p) => p !== null) ?? null;

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const created = await api.post<OidcClientCreated>("control", "/v1/oidc/clients", {
        name: name.trim(),
        redirectUris: uris,
      });
      setMade(created);
      setName("");
      setAddresses("");
      await onAdded();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <details
      className="rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2"
      data-testid="sign-in-app-add"
    >
      <summary className="font-ui cursor-pointer text-sm font-semibold">Add another app</summary>
      <div className="mt-3 flex max-w-xl flex-col gap-3 text-sm">
        <p className="text-[color:var(--muted)]">
          For an app you run yourself that can sign in with OpenID Connect. Its settings ask for the
          sign-in address above, a client ID and a client secret.
        </p>
        {made && (
          <div
            className="status-success flex flex-col gap-2 rounded-[var(--radius)] px-3 py-2"
            data-testid="sign-in-app-made"
          >
            <p className="font-ui font-semibold">Added {made.client.name}. Copy its secret now.</p>
            <p>Eugene keeps no copy, so this is the only time it is shown.</p>
            <div className="flex flex-wrap items-center gap-2">
              <span>Client ID:</span>
              <code className="font-mono">{made.client.clientId}</code>
              <CopyButton text={made.client.clientId} label="Copy client ID" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span>Client secret:</span>
              <code className="font-mono break-all" data-testid="sign-in-app-secret">
                {made.clientSecret}
              </code>
              <CopyButton text={made.clientSecret} label="Copy client secret" />
            </div>
            <div>
              <button type="button" className={buttonClass} onClick={() => setMade(null)}>
                I have copied it
              </button>
            </div>
          </div>
        )}
        <label className="font-ui flex flex-col gap-1">
          Its name, as people should see it
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="sign-in-app-name"
          />
        </label>
        <label className="font-ui flex flex-col gap-1">
          <span>
            Return addresses{" "}
            <span className="text-[color:var(--muted)]">
              — one a line; the app&rsquo;s own settings name it
            </span>
          </span>
          <textarea
            className={`${inputClass} font-mono`}
            rows={3}
            value={addresses}
            onChange={(e) => setAddresses(e.target.value)}
            placeholder="http://192.168.1.5:3000/oauth/oidc/callback"
            data-testid="sign-in-app-addresses"
          />
        </label>
        {problem && <p className="status-warn">{problem}</p>}
        {error && (
          <p className="status-error" role="alert">
            {error}
          </p>
        )}
        <div>
          <button
            type="button"
            className={primaryClass}
            disabled={!name.trim() || uris.length === 0 || problem !== null || saving}
            onClick={() => void submit()}
            data-testid="sign-in-app-submit"
          >
            {saving ? "Adding…" : "Add app"}
          </button>
        </div>
      </div>
    </details>
  );
}
