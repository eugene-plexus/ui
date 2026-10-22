"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { describeError } from "@/lib/api";
import {
  candidateFinding,
  changeRole,
  readRoles,
  type RoleData,
  type Finding,
} from "@/lib/modelRoles";
import type { ModelRole, ModelRoleDefinition } from "@/lib/types";

const buttonClass =
  "rounded border border-[color:var(--border)] px-2 py-1 text-sm disabled:opacity-40";
const selectClass =
  "rounded border border-[color:var(--border)] bg-[color:var(--panel)] px-2 py-1 text-sm";

function useRoles() {
  const [data, setData] = useState<RoleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const next = await readRoles();
    setData(next);
  }, []);
  useEffect(() => {
    void load().catch((e: unknown) => setError(describeError(e)));
  }, [load]);
  async function save(role: ModelRole, edit: (models: string[]) => string[]) {
    setBusy(true);
    setError(null);
    try {
      await changeRole(role, edit);
      setData(null);
      await load();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }
  return { data, error, busy, save };
}

export function ModelRoles() {
  const { data, error, busy, save } = useRoles();
  return (
    <section aria-label="Model roles" className="space-y-4">
      <h1 className="text-xl font-semibold">Model roles</h1>
      <p>Choose the models apps use for each task. Models are tried in the order shown.</p>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p>Loading model roles…</p>}
      {data?.listingError && (
        <p role="status">Model choices could not be read: {data.listingError}</p>
      )}
      {data?.roles.map((role) => (
        <RoleRow key={role.role} role={role} data={data} busy={busy} save={save} />
      ))}
    </section>
  );
}

function RoleRow({
  role,
  data,
  busy,
  save,
}: {
  role: ModelRoleDefinition;
  data: RoleData;
  busy: boolean;
  save: (role: ModelRole, edit: (models: string[]) => string[]) => Promise<void>;
}) {
  const [chosen, setChosen] = useState("");
  const [manual, setManual] = useState("");
  const targets = data.slots.find((s) => s.model === `role:${role.role}`)?.targets ?? [];
  const models = data.models.filter((m) => !m.id.startsWith("role:") && !targets.includes(m.id));
  const groups: [Finding, string][] = [
    ["yes", "Has the capability"],
    ["unknown", "Capability unknown"],
    ["no", "Lacks it"],
  ];
  const addition = chosen === "manual" ? manual.trim() : chosen;
  return (
    <section
      aria-label={role.label}
      className="space-y-2 rounded border border-[color:var(--border)] p-3"
    >
      <h2 className="font-semibold">{role.label}</h2>
      {targets.length === 0 && <p>No model has this role.</p>}
      <ol className="space-y-2">
        {targets.map((model, index) => {
          const report = role.models.find((m) => m.model === model);
          const found = data.models.find((m) => m.id === model);
          const finding = report?.capability ?? (found ? candidateFinding(found, role) : "unknown");
          return (
            <li key={`${index}:${model}`} className="flex flex-wrap items-center gap-2">
              <span>
                {index + 1}. {model}
              </span>
              {finding !== "yes" && (
                <span role="status">
                  {finding === "no" ? "Lacks the capability" : "Capability unknown"}:{" "}
                  {report?.reason ?? "The model listing does not confirm support."} You can still
                  use it.
                </span>
              )}
              <button
                className={buttonClass}
                disabled={busy || index === 0}
                aria-label={`Move ${model} up in ${role.label}`}
                onClick={() =>
                  void save(role.role, (ids) => {
                    const at = ids.indexOf(model);
                    if (at > 0) [ids[at - 1], ids[at]] = [ids[at]!, ids[at - 1]!];
                    return ids;
                  })
                }
              >
                Move up
              </button>
              <button
                className={buttonClass}
                disabled={busy || index === targets.length - 1}
                aria-label={`Move ${model} down in ${role.label}`}
                onClick={() =>
                  void save(role.role, (ids) => {
                    const at = ids.indexOf(model);
                    if (at >= 0 && at < ids.length - 1)
                      [ids[at], ids[at + 1]] = [ids[at + 1]!, ids[at]!];
                    return ids;
                  })
                }
              >
                Move down
              </button>
              <button
                className={buttonClass}
                disabled={busy}
                aria-label={`Remove ${model} from ${role.label}`}
                onClick={() => void save(role.role, (ids) => ids.filter((id) => id !== model))}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ol>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (addition)
            void save(role.role, (ids) => (ids.includes(addition) ? ids : [...ids, addition]));
        }}
      >
        <select
          className={selectClass}
          aria-label={`Add a model to ${role.label}`}
          value={chosen}
          disabled={busy}
          onChange={(e) => setChosen(e.target.value)}
        >
          <option value="">Choose a model</option>
          {groups.map(([status, label]) => {
            const choices = models.filter((m) => candidateFinding(m, role) === status);
            return (
              choices.length > 0 && (
                <optgroup key={status} label={label}>
                  {choices.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </optgroup>
              )
            );
          })}
          <option value="manual">Enter a model id…</option>
        </select>
        {chosen === "manual" && (
          <input
            className={selectClass}
            aria-label={`Model id for ${role.label}`}
            value={manual}
            disabled={busy}
            onChange={(e) => setManual(e.target.value)}
          />
        )}
        <button className={buttonClass} disabled={busy || !addition || targets.includes(addition)}>
          Add to {role.label}
        </button>
      </form>
    </section>
  );
}

export function ModelRoleChips({ model }: { model: string }) {
  const { data, error, busy, save } = useRoles();
  const [chosen, setChosen] = useState("");
  const assigned =
    data?.roles.filter((r) =>
      data.slots.some((s) => s.model === `role:${r.role}` && s.targets.includes(model)),
    ) ?? [];
  const available = data?.roles.filter((r) => !assigned.includes(r)) ?? [];
  const selectedRole = available.find((r) => r.role === chosen);
  const listedModel = data?.models.find((m) => m.id === model);
  const finding =
    selectedRole && listedModel ? candidateFinding(listedModel, selectedRole) : "unknown";
  return (
    <section aria-label={`Roles for ${model}`} className="space-y-2 text-sm">
      <p className="font-semibold">Roles</p>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p>Loading roles…</p>}
      {data && (
        <>
          <div className="flex flex-wrap gap-2">
            {assigned.map((r) => (
              <button
                key={r.role}
                className={buttonClass}
                disabled={busy}
                aria-label={`Remove ${r.label} from ${model}`}
                onClick={() => void save(r.role, (ids) => ids.filter((id) => id !== model))}
              >
                {r.label} ×
              </button>
            ))}
          </div>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const role = available.find((r) => r.role === chosen);
              if (role)
                void save(role.role, (ids) => (ids.includes(model) ? ids : [...ids, model]));
            }}
          >
            <select
              className={selectClass}
              aria-label={`Add a role to ${model}`}
              value={available.some((r) => r.role === chosen) ? chosen : ""}
              disabled={busy}
              onChange={(e) => setChosen(e.target.value)}
            >
              <option value="">Choose a role</option>
              {available.map((r) => (
                <option key={r.role} value={r.role}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              className={buttonClass}
              disabled={busy || !available.some((r) => r.role === chosen)}
            >
              Add role
            </button>
          </form>
          {selectedRole && finding !== "yes" && (
            <p role="status">
              {finding === "no"
                ? "The model listing lacks this capability."
                : "This capability is unknown."}{" "}
              You can still give it this role.
            </p>
          )}
          <Link className="underline" href="/routing/roles">
            Edit model order under Model roles
          </Link>
        </>
      )}
    </section>
  );
}
