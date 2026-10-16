"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { PermissionGroups } from "@/components/PermissionGroups";
import { api, ApiError, describeError } from "@/lib/api";
import { appsSummary, MIN_PASSWORD } from "@/lib/people";
import type {
  AdministrationLoginResponse,
  AdministrationSession,
  OidcClient,
  OidcClientList,
  PermissionGroup,
  PermissionGroupList,
  Person,
  PersonList,
} from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

const KEY = "eugene-administration-token";
const button =
  "action-button self-start rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2 text-sm disabled:opacity-40";
const input =
  "w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2";

function remember(token: string | null) {
  try {
    if (token) sessionStorage.setItem(KEY, token);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* memory-only if storage is unavailable */
  }
}

export default function AdministrationPage() {
  const [token, setToken] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    try {
      setToken(sessionStorage.getItem(KEY));
    } catch {
      /* sign in */
    }
    setRestored(true);
    document.title = "People and access · Eugene Plexus";
  }, []);
  const ended = useCallback((message: string) => {
    remember(null);
    setToken(null);
    setNotice(message);
  }, []);
  return (
    <main className="relative z-10 min-h-screen px-4 py-8 sm:px-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--border)] pb-4">
          <div>
            <p className="text-sm text-[color:var(--muted)]">Eugene Plexus</p>
            <h1 className="text-2xl font-semibold">People and access</h1>
          </div>
          {!token && (
            <Link className="text-sm underline" href="/login/">
              Owner sign-in and unlock
            </Link>
          )}
        </header>
        {notice && (
          <p role="status" className="status-warn">
            {notice}
          </p>
        )}
        {!restored ? (
          <p>Loading…</p>
        ) : token ? (
          <Directory key={token} token={token} onEnded={ended} />
        ) : (
          <NamedLogin
            onSignedIn={(value) => {
              remember(value);
              setToken(value);
              setNotice(null);
            }}
          />
        )}
      </div>
    </main>
  );
}

function NamedLogin({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="section-panel mx-auto flex w-full max-w-md flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const answer = await api.post<AdministrationLoginResponse>(
            "control",
            "/v1/auth/administration/login",
            { name, password },
            { skipAuth: true },
          );
          onSignedIn(answer.sessionToken);
        } catch (e) {
          setError(describeError(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-lg font-semibold">Administrator sign-in</h2>
      <p className="text-sm text-[color:var(--muted)]">
        Use your Eugene account after the owner grants administration access. Your permitted account
        and group tools will appear here.
      </p>
      <label>
        Account name
        <input
          className={input}
          autoComplete="username"
          required
          maxLength={64}
          value={name}
          onChange={(e) => setName(e.target.value)}
          readOnly={busy}
        />
      </label>
      <label>
        Password
        <input
          className={input}
          type="password"
          autoComplete="current-password"
          required
          maxLength={1024}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          readOnly={busy}
        />
      </label>
      {error && (
        <p role="alert" className="status-error">
          {error}
        </p>
      )}
      <button className={button} disabled={busy} type="submit">
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-xs text-[color:var(--muted)]">
        This session lasts one hour. The owner must unlock Eugene after a restart if automatic
        unlock is off.
      </p>
    </form>
  );
}

type Loaded = {
  session: AdministrationSession;
  people: Person[];
  groups: PermissionGroup[];
  clients: OidcClient[];
};

function Directory({ token, onEnded }: { token: string; onEnded: (message: string) => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const load = useCallback(async () => {
    try {
      const options = { bearer: token };
      const [session, people, groups, clients] = await Promise.all([
        api.get<AdministrationSession>("control", "/v1/auth/administration/session", options),
        api.get<PersonList>("control", "/v1/people", options),
        api.get<PermissionGroupList>("control", "/v1/permission-groups", options),
        api.get<OidcClientList>("control", "/v1/oidc/clients", options),
      ]);
      setLoaded({
        session,
        people: people.people,
        groups: groups.groups,
        clients: clients.clients,
      });
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401)
        onEnded("Your administration session ended. Sign in again.");
      else {
        setLoaded(null);
        setError(describeError(e));
      }
    }
  }, [token, onEnded]);
  usePolling(load, 10_000);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          {loaded ? `Signed in as ${loaded.session.name}` : "Checking your administration access…"}
        </p>
        <button
          className={button}
          onClick={async () => {
            try {
              await api.delete("control", "/v1/auth/administration/session", { bearer: token });
              onEnded("Signed out.");
            } catch (e) {
              if (e instanceof ApiError && e.status === 401) onEnded("Your session has ended.");
              else setError(`Sign-out could not be confirmed. Try again. ${describeError(e)}`);
            }
          }}
        >
          Sign out
        </button>
      </div>
      {error && (
        <p role="alert" className="status-error">
          {error}{" "}
          <button className={button} onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}
      {loaded && (
        <>
          <section className="section-panel flex flex-col gap-3" aria-label="Your permissions">
            <h2 className="font-semibold">Your permissions</h2>
            <ul className="list-inside list-disc text-sm">
              {loaded.session.grants.managePeople && <li>Manage ordinary accounts</li>}
              {loaded.session.grants.manageGroups && (
                <li>Define permission groups and their access</li>
              )}
              {!!loaded.session.grants.membershipGroups?.length && (
                <li>
                  Assign memberships:{" "}
                  {loaded.session.grants.membershipGroups
                    .map((id) => loaded.groups.find((g) => g.id === id)?.name ?? id)
                    .join(", ")}
                </li>
              )}
            </ul>
            <p className="text-sm text-[color:var(--muted)]">
              Account recovery, email identities and administration grants stay with the owner.
              Private conversations belong to each person.
            </p>
          </section>
          {loaded.session.grants.managePeople && <CreateAccount token={token} onChanged={load} />}
          <section className="flex flex-col gap-3" aria-label="People">
            <h2 className="text-lg font-semibold">People ({loaded.people.length})</h2>
            <label className="text-sm">
              Find a person
              <input
                type="search"
                className={`${input} mt-1`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {loaded.people
              .filter((p) =>
                `${p.name} ${p.displayName ?? ""}`.toLowerCase().includes(query.toLowerCase()),
              )
              .map((person) => (
                <Account
                  key={person.id}
                  person={person}
                  loaded={loaded}
                  token={token}
                  onChanged={load}
                />
              ))}
            {loaded.people.length === 0 && <p>No member accounts yet.</p>}
          </section>
          {loaded.session.grants.manageGroups && (
            <PermissionGroups
              groups={loaded.groups}
              clients={loaded.clients}
              people={loaded.people}
              error={null}
              bearer={token}
              onChanged={load}
            />
          )}
        </>
      )}
    </>
  );
}

function CreateAccount({ token, onChanged }: { token: string; onChanged: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <details className="section-panel">
      <summary className="cursor-pointer font-semibold">Add a person</summary>
      <form
        className="mt-4 flex max-w-md flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          setSaved(false);
          try {
            await api.post("control", "/v1/people", { name, password }, { bearer: token });
            await onChanged();
            setName("");
            setPassword("");
            setSaved(true);
          } catch (e) {
            setError(describeError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-sm text-[color:var(--muted)]">
          New accounts start with no app or job-site access. Assign an allowed group after creating
          the account.
        </p>
        <label>
          Account name
          <input
            className={input}
            required
            maxLength={64}
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            readOnly={busy}
          />
        </label>
        <label>
          First password
          <input
            className={input}
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD}
            maxLength={1024}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            readOnly={busy}
          />
        </label>
        <button className={button} disabled={busy}>
          Create account
        </button>
        {error && (
          <p role="alert" className="status-error">
            {error}
          </p>
        )}
        {saved && <p role="status">Account created. Assign group access below.</p>}
      </form>
    </details>
  );
}

function Account({
  person,
  loaded,
  token,
  onChanged,
}: {
  person: Person;
  loaded: Loaded;
  token: string;
  onChanged: () => Promise<void>;
}) {
  const grants = loaded.session.grants;
  const protectedAccount =
    person.id === loaded.session.personId ||
    !!(
      person.administration?.managePeople ||
      person.administration?.manageGroups ||
      person.administration?.membershipGroups?.length
    );
  const editable = !protectedAccount;
  const scope = grants.membershipGroups ?? [];
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const path = `/v1/people/${encodeURIComponent(person.id)}`;
  async function change(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      await api.patch("control", path, body, { bearer: token });
      await onChanged();
      return true;
    } catch (e) {
      setError(describeError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="section-panel flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-3">
        <h3 className="font-semibold break-words">{person.displayName || person.name}</h3>
        {person.displayName && (
          <span className="text-sm text-[color:var(--muted)]">{person.name}</span>
        )}
        <span className={person.disabled ? "status-warn" : "status-success"}>
          {person.disabled ? "Disabled" : "Active"}
        </span>
        {protectedAccount && <span className="text-xs">Protected administrator</span>}
      </header>
      <p className="text-sm">Apps: {appsSummary(person, loaded.clients)}</p>
      <p className="text-sm">
        {person.groups == null
          ? "Individual access — the owner manages assignments."
          : `Groups: ${person.groups.map((id) => loaded.groups.find((g) => g.id === id)?.name ?? id).join(", ") || "None"}`}
      </p>
      {editable && scope.length > 0 && person.groups != null && (
        <Memberships
          person={person}
          groups={loaded.groups.filter((g) => scope.includes(g.id))}
          busy={busy}
          onSave={(groups) => change({ groups })}
        />
      )}
      {editable && grants.managePeople && (
        <div className="flex flex-wrap gap-3">
          <DisplayName
            key={person.displayName}
            person={person}
            busy={busy}
            onChange={async (value) => {
              await change({ displayName: value });
            }}
          />
          <button
            className={button}
            disabled={busy}
            onClick={() => void change({ disabled: !person.disabled })}
          >
            {person.disabled ? "Enable account" : "Disable account"}
          </button>
          <ConfirmButton
            disabled={busy}
            className={button}
            label="Delete account"
            ariaLabel={`Delete account ${person.name}`}
            confirmLabel={`Delete ${person.name}`}
            prompt="This removes the account and its owned job sites. It cannot be undone."
            onConfirm={async () => {
              setError(null);
              setBusy(true);
              try {
                await api.delete("control", path, { bearer: token });
                await onChanged();
              } catch (e) {
                setError(describeError(e));
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="status-error">
          {error}
        </p>
      )}
    </article>
  );
}

function DisplayName({
  person,
  busy,
  onChange,
}: {
  person: Person;
  busy: boolean;
  onChange: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(person.displayName ?? "");
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-[color:var(--accent-left)]">
        Edit display name
      </summary>
      <form
        className="mt-2 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void onChange(value);
        }}
      >
        <label>
          Display name
          <input
            className={input}
            maxLength={120}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
          />
        </label>
        <button className={button} disabled={busy}>
          Save display name
        </button>
      </form>
    </details>
  );
}

function Memberships({
  person,
  groups,
  busy,
  onSave,
}: {
  person: Person;
  groups: PermissionGroup[];
  busy: boolean;
  onSave: (groups: string[]) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<string[]>(person.groups ?? []);
  const [saved, setSaved] = useState(false);
  const scope = groups.map((g) => g.id);
  return (
    <details>
      <summary className="cursor-pointer text-sm text-[color:var(--accent-left)]">
        Assign groups
      </summary>
      <form
        className="mt-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaved(false);
          // Merge the latest out-of-scope memberships, never replace them from an old draft.
          const kept = (person.groups ?? []).filter((id) => !scope.includes(id));
          setSaved(await onSave([...kept, ...selected.filter((id) => scope.includes(id))]));
        }}
      >
        <fieldset disabled={busy} className="flex flex-col gap-2">
          <legend className="sr-only">Groups for {person.name}</legend>
          {groups.map((g) => (
            <label className="flex gap-2 text-sm" key={g.id}>
              <input
                type="checkbox"
                checked={selected.includes(g.id)}
                onChange={(e) => {
                  setSaved(false);
                  setSelected(
                    e.target.checked ? [...selected, g.id] : selected.filter((id) => id !== g.id),
                  );
                }}
              />
              {g.name}
            </label>
          ))}
          <p className="text-xs text-[color:var(--muted)]">
            Other memberships are kept when you save.
          </p>
          <button className={button}>Save memberships</button>
        </fieldset>
        {saved && (
          <p role="status" className="mt-2 text-sm">
            Memberships saved.
          </p>
        )}
      </form>
    </details>
  );
}
