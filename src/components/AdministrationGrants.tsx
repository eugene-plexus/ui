"use client";

import { useEffect, useState } from "react";
import { PersonSection } from "@/components/PersonSection";
import { api, describeError } from "@/lib/api";
import type { AdministrationGrants as Grants, PermissionGroup, Person } from "@/lib/types";

/** The machines an owner can pick for operations powers (row 39). */
export interface MachineChoice {
  name: string;
  label?: string | null;
}

export function AdministrationGrants({
  person,
  groups,
  onChanged,
  machines: given,
}: {
  person: Person;
  groups: PermissionGroup[];
  onChanged: () => Promise<void>;
  /** The install's machines; read from the root when not given. */
  machines?: MachineChoice[];
}) {
  const [draft, setGrants] = useState<Grants | null>(null);
  const [fetched, setFetched] = useState<MachineChoice[] | null>(null);
  const [machinesError, setMachinesError] = useState<string | null>(null);
  useEffect(() => {
    if (given) return;
    let live = true;
    api
      .get<{ nodes?: MachineChoice[] }>("control", "/v1/nodes")
      .then((answer) => {
        if (live) setFetched(answer.nodes ?? []);
      })
      .catch((e) => {
        if (live) setMachinesError(describeError(e));
      });
    return () => {
      live = false;
    };
  }, [given]);
  const machines = given ?? fetched ?? [];
  const grants: Grants = {
    managePeople: false,
    manageGroups: false,
    membershipGroups: [],
    operateModels: false,
    operateMachines: false,
    operationsMachines: null,
    ...(draft ?? person.administration ?? {}),
  };
  const reach = grants.operationsMachines ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const scope = grants.membershipGroups ?? [];
  return (
    <PersonSection title="Administration permissions">
      {draft && <p className="text-xs text-[color:var(--muted)]">Unsaved changes</p>}
      <form
        className="flex flex-col gap-4 text-sm"
        onChange={() => setSaved(false)}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          setSaved(false);
          try {
            await api.put(
              "control",
              `/v1/people/${encodeURIComponent(person.id)}/administration`,
              grants,
            );
            await onChanged();
            setGrants(null);
            setSaved(true);
          } catch (e) {
            setError(describeError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-[color:var(--muted)]">
          {`Grant only what ${person.displayName || person.name} needs. No permission opens`} anyone
          else&rsquo;s private chats.
        </p>
        <fieldset disabled={busy} className="flex flex-col gap-3">
          <label className="flex items-start gap-3 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={grants.managePeople ?? false}
              onChange={(e) => setGrants({ ...grants, managePeople: e.target.checked })}
            />
            <span>
              Manage accounts
              <span className="block text-xs text-[color:var(--muted)]">
                Create accounts without access, change display names, disable or delete ordinary
                accounts. Password recovery and email changes stay with the owner.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={grants.manageGroups ?? false}
              onChange={(e) => setGrants({ ...grants, manageGroups: e.target.checked })}
            />
            <span>
              Define permission groups
              <span className="block text-xs text-[color:var(--muted)]">
                Create, edit and delete groups. Changes affect access for every existing member.
                This does not grant membership assignment.
              </span>
            </span>
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 font-medium">Assign members to these groups</legend>
            {groups.length === 0 && (
              <p>Create a permission group first to delegate membership assignment.</p>
            )}
            {groups.map((g) => (
              <label className="flex gap-2" key={g.id}>
                <input
                  type="checkbox"
                  aria-label={`Allow assigning members to ${g.name}`}
                  checked={scope.includes(g.id)}
                  onChange={(e) =>
                    setGrants({
                      ...grants,
                      membershipGroups: e.target.checked
                        ? [...scope, g.id]
                        : scope.filter((id) => id !== g.id),
                    })
                  }
                />
                {g.name}
              </label>
            ))}
            <p className="text-xs text-[color:var(--muted)]">
              Only accounts already using group access can be assigned. The owner manages
              administrators and switches accounts between individual and group access.
            </p>
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 font-medium">Run the machines</legend>
            <label className="flex items-start gap-3 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={grants.operateModels ?? false}
                onChange={(e) => setGrants({ ...grants, operateModels: e.target.checked })}
              />
              <span>
                Models
                <span className="block text-xs text-[color:var(--muted)]">
                  Download, delete and re-scan models, edit profiles, and create, start, stop and
                  change models that run.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={grants.operateMachines ?? false}
                onChange={(e) => setGrants({ ...grants, operateMachines: e.target.checked })}
              />
              <span>
                Updates and restarts
                <span className="block text-xs text-[color:var(--muted)]">
                  Update Eugene and engines, install engine builds, restart components, and read
                  machine logs. Logs can hold file names and parts of requests.
                </span>
              </span>
            </label>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1">On these machines</legend>
              <label className="flex gap-2">
                <input
                  type="radio"
                  name={`reach-${person.id}`}
                  checked={reach === null}
                  onChange={() => setGrants({ ...grants, operationsMachines: null })}
                />
                Every machine, including machines added later
              </label>
              <label className="flex gap-2">
                <input
                  type="radio"
                  name={`reach-${person.id}`}
                  checked={reach !== null}
                  onChange={() => setGrants({ ...grants, operationsMachines: reach ?? [] })}
                />
                Only the machines I choose
              </label>
              {reach !== null &&
                machines.map((m) => (
                  <label className="ml-6 flex gap-2" key={m.name}>
                    <input
                      type="checkbox"
                      aria-label={`Allow running ${m.label || m.name}`}
                      checked={reach.includes(m.name)}
                      onChange={(e) =>
                        setGrants({
                          ...grants,
                          operationsMachines: e.target.checked
                            ? [...reach, m.name]
                            : reach.filter((n) => n !== m.name),
                        })
                      }
                    />
                    {m.label || m.name}
                  </label>
                ))}
              {machinesError && (
                <p className="status-warn text-xs">Machines could not be loaded. {machinesError}</p>
              )}
            </fieldset>
            <p className="text-xs text-[color:var(--muted)]">
              Never: secrets, chats, sign-in keys. Provider keys, people, adding and removing
              machines, Job Sites, routing, client keys, folder access and settings stay with the
              owner. Each change is recorded on the machine&rsquo;s page with this person&rsquo;s
              name. A machine that cannot reach the root may honour a removed power for up to 15
              minutes: a token lasts 10, and machines allow 5 for clocks that disagree.
            </p>
          </fieldset>
          <p className="text-xs text-[color:var(--muted)]">
            Clearing every permission removes administration access. Changes end this person&rsquo;s
            existing administration sessions.
          </p>
          <button
            className="action-button self-start rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5"
            type="submit"
          >
            {busy ? "Saving…" : "Save administration access"}
          </button>
        </fieldset>
        {error && (
          <p role="alert" className="status-error">
            {error}
          </p>
        )}
        {saved && <p role="status">Administration access saved.</p>}
      </form>
    </PersonSection>
  );
}
