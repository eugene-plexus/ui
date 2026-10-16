"use client";

import { useState } from "react";
import { api, describeError } from "@/lib/api";
import type { AdministrationGrants as Grants, PermissionGroup, Person } from "@/lib/types";

export function AdministrationGrants({
  person,
  groups,
  onChanged,
}: {
  person: Person;
  groups: PermissionGroup[];
  onChanged: () => Promise<void>;
}) {
  const [draft, setGrants] = useState<Grants | null>(null);
  const grants = draft ??
    person.administration ?? {
      managePeople: false,
      manageGroups: false,
      membershipGroups: [],
    };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const scope = grants.membershipGroups ?? [];
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-[color:var(--accent-left)]">
        Administration access{draft && <span className="ml-2 text-xs">Unsaved changes</span>}
      </summary>
      <form
        className="mt-3 flex max-w-xl flex-col gap-3"
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
        <p>
          Grant only what {person.displayName || person.name} needs. These permissions do not open
          machine controls or anyone else&rsquo;s private chats.
        </p>
        <fieldset disabled={busy} className="flex flex-col gap-3">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
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
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
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
    </details>
  );
}
