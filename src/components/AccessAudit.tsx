"use client";

import { useState } from "react";
import { api, describeError } from "@/lib/api";
import type { components } from "@/generated/control";

type Audit = components["schemas"]["AccessAudit"];

const actions: Record<string, string> = {
  putPerson: "Saved account",
  deletePerson: "Deleted account",
  setPersonPassword: "Changed password",
  putPermissionGroup: "Saved permission group",
  deletePermissionGroup: "Deleted permission group",
  putOidcClient: "Registered app",
  deleteOidcClient: "Removed app",
  setOidcClientRedirects: "Changed app sign-in addresses",
  putClientKey: "Created client key",
  revokeClientKey: "Revoked client key",
  setClientKeyLimits: "Changed client key limits",
  revokeSignIn: "Signed out",
  revokeSession: "Ended console session",
};

export function AccessAudit({ names }: { names: Record<string, string> }) {
  const [data, setData] = useState<Audit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    setError(null);
    try {
      setData(await api.get<Audit>("control", "/v1/auth/audit"));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }
  const label = (id: string) => names[id] ?? (id === "operator" ? "Owner" : id);
  return (
    <details
      className="rounded-[var(--radius)] border border-[color:var(--border)] p-4"
      onToggle={(event) => {
        if (event.currentTarget.open && data === null && !busy) void load();
      }}
    >
      <summary className="cursor-pointer font-medium">Access history</summary>
      <p className="my-2 text-sm text-[color:var(--muted)]">
        Committed account, group, app and key changes. The latest 1,000 are retained across
        restarts. Model requests appear in Gateway Metrics; job-site activity stays in each
        site&apos;s audit history.
      </p>
      <button
        type="button"
        className="action-button mb-3 rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5 text-sm disabled:opacity-40"
        disabled={busy}
        onClick={() => void load()}
      >
        {busy ? "Loading history…" : "Refresh history"}
      </button>
      {error && (
        <p role="alert" className="status-error">
          {error}
        </p>
      )}
      {data && (
        <>
          <p className="mb-2 text-sm text-[color:var(--muted)]">
            Showing the latest {Math.min(50, data.events.length)} of {data.events.length} retained
            changes.
          </p>
          <ol className="space-y-2">
            {data.events.slice(0, 50).map((event) => (
              <li
                key={event.index}
                className="rounded-[var(--radius)] bg-[color:var(--panel-soft)] p-2 text-sm"
              >
                <time className="text-[color:var(--muted)]" dateTime={event.at}>
                  {event.at ? new Date(event.at).toLocaleString() : "Earlier record"}
                </time>
                <div className="break-words">
                  <strong title={event.actor}>{label(event.actor)}</strong>
                  {" · "}
                  {actions[event.action] ?? event.action}
                  {" · "}
                  <span title={event.target}>
                    {event.action === "revokeSignIn" || event.action === "revokeSession"
                      ? "Session"
                      : label(event.target)}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </details>
  );
}
