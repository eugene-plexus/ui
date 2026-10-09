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
import { ConfirmButton } from "@/components/ConfirmButton";
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
      const [people, clients, sites] = await Promise.all([
        api.get<PersonList>("control", "/v1/people"),
        api.get<OidcClientList>("control", "/v1/oidc/clients"),
        // Job sites are a count beside each person, never a reason to fail.
        api.get<SiteList>("control", "/v1/sites").catch(() => null),
      ]);
      setLoaded({
        people: people.people ?? [],
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
        <div className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-8">
          <p className="text-sm text-[color:var(--muted)]">
            Apps can ask Eugene who is using them. With nobody added here, an app asks for
            Eugene&rsquo;s passphrase. Add people to give each one a name and password of their own.
            Nobody added here can open this console.
          </p>
          {error && (
            <p className="status-error rounded-[var(--radius)] px-2 py-1 text-sm" role="alert">
              {error}
            </p>
          )}
          {loaded === null ? (
            !error && <p className="font-ui text-sm text-[color:var(--muted)]">Loading…</p>
          ) : (
            <>
              <PeopleSection loaded={loaded} onChanged={load} />
              <AppsSection loaded={loaded} onChanged={load} />
            </>
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
    <section aria-labelledby="people-heading" className="section-panel flex flex-col gap-3">
      <h2 id="people-heading" className="section-heading font-ui mb-0 text-base font-semibold">
        People
      </h2>
      <p className="text-sm text-[color:var(--muted)]">
        You sign in to apps as <span className="font-mono">{operatorName}</span>, with
        Eugene&rsquo;s passphrase.
        {people.length === 0 ? " Nobody else is added yet." : ""}
      </p>
      {people.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="people-list">
          {people.map((person) => (
            <PersonRow
              key={person.id}
              person={person}
              clients={clients}
              sites={sites.get(person.id) ?? 0}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
      <AddPerson operatorName={operatorName} clients={clients} onAdded={onChanged} />
    </section>
  );
}

function PersonRow({
  person,
  clients,
  sites,
  onChanged,
}: {
  person: Person;
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
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  const path = `/v1/people/${encodeURIComponent(person.id)}`;
  return (
    <li className={rowClass} id={`person-${person.id}`} data-testid={`person-${person.name}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-ui font-semibold">{person.name}</span>
        {person.displayName && (
          <span className="text-sm text-[color:var(--muted)]">{person.displayName}</span>
        )}
        {person.email && (
          <span
            className="text-sm text-[color:var(--muted)]"
            data-testid={`person-email-${person.name}`}
          >
            {person.email}
          </span>
        )}
        <span
          className={`font-ui rounded-[var(--radius)] px-1.5 text-sm ${
            person.disabled ? "status-warn" : "status-success"
          }`}
          data-testid={`person-state-${person.name}`}
        >
          {person.disabled ? "Signing in is off" : "Can sign in"}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() =>
              void change(() => api.patch("control", path, { disabled: !person.disabled }))
            }
            data-testid={`person-toggle-${person.name}`}
          >
            {person.disabled ? "Turn signing in on" : "Turn signing in off"}
          </button>
          <ConfirmButton
            label="Delete"
            confirmLabel={`Delete ${person.name}`}
            prompt="Their apps sign them out within ten minutes."
            onConfirm={() => change(() => api.delete("control", path))}
            className={buttonClass}
            testId={`person-delete-${person.name}`}
          />
        </span>
      </div>
      <p className="text-sm">
        <span className="text-[color:var(--muted)]">Apps: </span>
        <span data-testid={`person-apps-${person.name}`}>{appsSummary(person, clients)}</span>
      </p>
      <p className="text-sm">
        <span className="text-[color:var(--muted)]">Job sites: </span>
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
      </p>
      <JobSitesLine person={person} />
      <div className="flex flex-wrap gap-4">
        <ChooseApps
          person={person}
          clients={clients}
          onSave={(apps) => change(() => api.patch("control", path, { apps }))}
        />
        <ChoosePermissions
          person={person}
          onSave={(permissions) => change(() => api.patch("control", path, { permissions }))}
        />
        <NewPassword
          name={person.name}
          onSave={(password) => change(() => api.put("control", `${path}/password`, { password }))}
        />
        <ChangeEmail
          person={person}
          onSave={(email) => change(() => api.patch("control", path, { email }))}
        />
      </div>
      {error && (
        <p className="status-error text-sm" role="alert">
          {error}
        </p>
      )}
    </li>
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
        <span className="text-[color:var(--muted)]">(set for them)</span>
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
}: {
  person: Pick<Person, "permissions" | "permissionsInEffect" | "name">;
  onSave: (permissions: string[] | null) => Promise<void>;
}) {
  const [defaults, setDefaults] = useState(person.permissions == null);
  const [chosen, setChosen] = useState<string[]>(
    person.permissions ?? person.permissionsInEffect ?? [],
  );
  return (
    <details className="text-sm" data-testid={`person-choose-permissions-${person.name}`}>
      <summary className="font-ui cursor-pointer text-[color:var(--accent-left)]">
        Choose what they may do with job sites
      </summary>
      <div className="mt-2 flex max-w-md flex-col gap-1">
        <p className="text-[color:var(--muted)]">
          These only narrow: a machine still needs their own account on it, a link they make there,
          and their own key on their own changes. A folder a site&rsquo;s owner shares with them
          works either way.
        </p>
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
            Save
          </button>
        </div>
      </div>
    </details>
  );
}

/** Every app, or the ones ticked. Null on the wire is every app. */
function ChooseApps({
  person,
  clients,
  onSave,
}: {
  person: Pick<Person, "apps" | "name">;
  clients: OidcClient[];
  onSave: (apps: string[] | null) => Promise<void>;
}) {
  const [every, setEvery] = useState(person.apps == null);
  const [chosen, setChosen] = useState<string[]>(person.apps ?? []);
  return (
    <details className="text-sm" data-testid={`person-choose-apps-${person.name}`}>
      <summary className="font-ui cursor-pointer text-[color:var(--accent-left)]">
        Choose apps
      </summary>
      <div className="mt-2 flex flex-col gap-1">
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
    </details>
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
}: {
  name: string;
  onSave: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const short = password.length > 0 && password.length < MIN_PASSWORD;
  return (
    <details className="text-sm" data-testid={`person-password-${name}`}>
      <summary className="font-ui cursor-pointer text-[color:var(--accent-left)]">
        Set a new password
      </summary>
      <div className="mt-2 flex max-w-sm flex-col gap-2">
        <p className="text-[color:var(--muted)]">
          Tell them the new one. Their apps sign them out within ten minutes, and they can change it
          when they next sign in.
        </p>
        <input
          type="password"
          autoComplete="new-password"
          className={inputClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label={`New password for ${name}`}
        />
        {short && <p className="status-warn text-sm">At least {MIN_PASSWORD} characters.</p>}
        <div>
          <button
            type="button"
            className={primaryClass}
            disabled={password.length < MIN_PASSWORD}
            onClick={() => void onSave(password).then(() => setPassword(""))}
          >
            Set password
          </button>
        </div>
      </div>
    </details>
  );
}

/** Set or clear a person's address. Null on the wire clears it. */
function ChangeEmail({
  person,
  onSave,
}: {
  person: Pick<Person, "email" | "name">;
  onSave: (email: string | null) => Promise<void>;
}) {
  const [email, setEmail] = useState(person.email ?? "");
  const problem = emailProblem(email);
  return (
    <details className="text-sm" data-testid={`person-change-email-${person.name}`}>
      <summary className="font-ui cursor-pointer text-[color:var(--accent-left)]">
        {person.email ? "Change email" : "Add an email"}
      </summary>
      <div className="mt-2 flex max-w-sm flex-col gap-2">
        <p className="text-[color:var(--muted)]">{EMAIL_HINT}</p>
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
              onClick={() => void onSave(null).then(() => setEmail(""))}
            >
              Remove email
            </button>
          )}
        </div>
      </div>
    </details>
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
            ? "Set on the control root's Settings. "
            : "This is the address this page was opened at. "}
          {address.loopback &&
            "Only this computer can open it, so an app on another machine needs another address. "}
          You can set one address for every app under{" "}
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
              <CopyButton text={made.client.clientId} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span>Client secret:</span>
              <code className="font-mono break-all" data-testid="sign-in-app-secret">
                {made.clientSecret}
              </code>
              <CopyButton text={made.clientSecret} />
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
