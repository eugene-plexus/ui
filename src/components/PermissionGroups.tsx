"use client";

import { useState } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { api, describeError } from "@/lib/api";
import { JOB_SITE_PERMISSIONS } from "@/lib/people";
import type { OidcClient, PermissionGroup, PermissionGroupWrite, Person } from "@/lib/types";

const button =
  "action-button rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5 text-sm disabled:opacity-40";
const input =
  "w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm";

export function PermissionGroups({
  groups,
  clients,
  people,
  error,
  onChanged,
}: {
  groups: PermissionGroup[] | null;
  clients: OidcClient[];
  people: Person[];
  error: string | null;
  onChanged: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <section className="section-panel flex flex-col gap-4" aria-labelledby="groups-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="groups-heading" className="section-heading mb-0 text-base font-semibold">
          Permission groups
        </h2>
        <button className={button} disabled={groups === null} onClick={() => setAdding(!adding)}>
          {adding ? "Cancel new group" : "Add group"}
        </button>
      </div>
      <p className="text-sm text-[color:var(--muted)]">
        Manage app and job-site access together. People using groups receive the combined access of
        their selected groups. Only the owner can manage accounts and groups currently.
      </p>
      {error && (
        <p role="alert" className="status-error text-sm">
          Groups could not be loaded: {error}
        </p>
      )}
      {failure && (
        <p role="alert" className="status-error text-sm">
          {failure}
        </p>
      )}
      {groups?.length === 0 && (
        <p className="text-sm">
          No groups yet. Create one, then assign it under a person&rsquo;s Access groups.
        </p>
      )}
      {adding && (
        <GroupForm
          clients={clients}
          onSave={async (body) => {
            await api.post("control", "/v1/permission-groups", body);
            await onChanged();
            setAdding(false);
          }}
        />
      )}
      {groups?.map((group) => (
        <article
          key={group.id}
          className="rounded-[var(--radius)] border border-[color:var(--border)] p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold break-words">{group.name}</h3>
              <p className="text-xs text-[color:var(--muted)]">
                {people.filter((p) => p.groups?.includes(group.id)).length} members
              </p>
            </div>
            <ConfirmButton
              label="Delete group"
              ariaLabel={`Delete group ${group.name}`}
              confirmLabel={`Delete ${group.name}`}
              prompt="Members lose this group's access. People with no groups left receive no group access."
              className={button}
              onConfirm={async () => {
                setFailure(null);
                try {
                  await api.delete(
                    "control",
                    `/v1/permission-groups/${encodeURIComponent(group.id)}`,
                  );
                  await onChanged();
                } catch (e) {
                  setFailure(describeError(e));
                }
              }}
            />
          </div>
          {group.description && (
            <p className="mt-2 text-sm break-words text-[color:var(--muted)]">
              {group.description}
            </p>
          )}
          <p className="mt-2 text-sm">
            Apps:{" "}
            {group.apps === null
              ? "Every app"
              : group.apps
                  .map((id) => clients.find((c) => c.clientId === id)?.name ?? id)
                  .join(", ") || "No apps"}
          </p>
          <p className="text-sm">
            Job sites:{" "}
            {JOB_SITE_PERMISSIONS.filter((p) => group.permissions.includes(p.id))
              .map((p) => p.short)
              .join("; ") || "No permissions"}
          </p>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-[color:var(--accent-left)]">
              Edit {group.name}
            </summary>
            <GroupForm
              key={group.updatedAt}
              group={group}
              clients={clients}
              onSave={async (body) => {
                await api.put(
                  "control",
                  `/v1/permission-groups/${encodeURIComponent(group.id)}`,
                  body,
                );
                await onChanged();
              }}
            />
          </details>
        </article>
      ))}
      <p className="text-xs text-[color:var(--muted)]">
        Changes apply at the next sign-in or token refresh. Workbench refreshes within ten minutes.
        Job-site permissions use the current policy.
      </p>
    </section>
  );
}

function GroupForm({
  group,
  clients,
  onSave,
}: {
  group?: PermissionGroup;
  clients: OidcClient[];
  onSave: (body: PermissionGroupWrite) => Promise<void>;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [all, setAll] = useState(group?.apps === null);
  const [apps, setApps] = useState<string[]>(group?.apps ?? []);
  const [permissions, setPermissions] = useState<PermissionGroup["permissions"]>(
    group?.permissions ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="mt-3 flex max-w-xl flex-col gap-3"
      onChange={() => setSaved(false)}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        setSaved(false);
        try {
          await onSave({ name: name.trim(), description, apps: all ? null : apps, permissions });
          setSaved(true);
        } catch (e) {
          setError(describeError(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="flex flex-col gap-3">
        <label>
          Group name
          <input
            className={input}
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Description
          <textarea
            className={input}
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-semibold">App access</legend>
          <label className="flex gap-2">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            Every app, including future apps
          </label>
          {!all &&
            clients.map((c) => (
              <label className="flex gap-2" key={c.clientId}>
                <input
                  type="checkbox"
                  checked={apps.includes(c.clientId)}
                  onChange={(e) =>
                    setApps(
                      e.target.checked
                        ? [...apps, c.clientId]
                        : apps.filter((id) => id !== c.clientId),
                    )
                  }
                />
                {c.name}
              </label>
            ))}
          {!all && apps.length === 0 && (
            <p className="text-xs text-[color:var(--muted)]">
              No apps selected: this group grants no app access.
            </p>
          )}
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-semibold">Job-site permissions</legend>
          {JOB_SITE_PERMISSIONS.map((p) => (
            <label key={p.id} className="flex gap-2">
              <input
                type="checkbox"
                checked={permissions.includes(p.id)}
                onChange={(e) =>
                  setPermissions(
                    e.target.checked
                      ? [...permissions, p.id]
                      : permissions.filter((id) => id !== p.id),
                  )
                }
              />
              {p.label}
            </label>
          ))}
        </fieldset>
        <button className={`${button} self-start`} disabled={!name.trim()}>
          {busy ? "Saving…" : group ? "Save group" : "Create group"}
        </button>
      </fieldset>
      {error && (
        <p role="alert" className="status-error">
          {error}
        </p>
      )}
      {saved && <p role="status">Group saved.</p>}
    </form>
  );
}

export function PersonGroups({
  person,
  groups,
  onSave,
}: {
  person: Person;
  groups: PermissionGroup[];
  onSave: (groups: string[] | null) => Promise<unknown>;
}) {
  const [individual, setIndividual] = useState(person.groups == null);
  const [chosen, setChosen] = useState<string[]>(person.groups ?? []);
  const [busy, setBusy] = useState(false);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-[color:var(--accent-left)]">Access groups</summary>
      <fieldset disabled={busy} className="mt-3 flex max-w-md flex-col gap-2">
        <label className="flex gap-2">
          <input
            type="radio"
            name={`access-${person.id}`}
            checked={individual}
            onChange={() => setIndividual(true)}
          />
          Individual access
        </label>
        <label className="flex gap-2">
          <input
            type="radio"
            name={`access-${person.id}`}
            checked={!individual}
            onChange={() => setIndividual(false)}
          />
          Use permission groups
        </label>
        {individual ? (
          <p className="text-xs text-[color:var(--muted)]">
            Use this person&rsquo;s individual app and job-site settings. Switching back restores
            their saved settings.
          </p>
        ) : (
          <>
            {groups.map((g) => (
              <label key={g.id} className="flex gap-2">
                <input
                  type="checkbox"
                  checked={chosen.includes(g.id)}
                  onChange={(e) =>
                    setChosen(
                      e.target.checked ? [...chosen, g.id] : chosen.filter((id) => id !== g.id),
                    )
                  }
                />
                {g.name}
              </label>
            ))}
            {chosen.length === 0 && (
              <p className="status-warn">
                No groups selected. This person will have no app or job-site access through groups.
              </p>
            )}
          </>
        )}
        <button
          className={`${button} self-start`}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(individual ? null : chosen);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Save access"}
        </button>
      </fieldset>
    </details>
  );
}
