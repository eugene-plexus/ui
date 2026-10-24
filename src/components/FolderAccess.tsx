"use client";

import { useCallback, useState } from "react";

import { api, describeError } from "@/lib/api";
import type { components } from "@/generated/agent";
import { usePolling } from "@/lib/usePolling";
import { ConfirmButton } from "./ConfirmButton";
import { FolderPicker } from "./FolderPicker";

type Grant = components["schemas"]["FolderAccess"];
const button = "action-button rounded border px-3 py-1 text-sm disabled:opacity-40";

export function FolderAccess({
  target,
  app,
  account,
  initialPath = "",
  initialMode = "read",
}: {
  target: string;
  app: string;
  account: string;
  initialPath?: string;
  initialMode?: "read" | "write";
}) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [path, setPath] = useState(initialPath);
  const [mode, setMode] = useState(initialMode);
  const [browse, setBrowse] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const linuxUser = account.match(/^eapp-[0-9a-f]{12}(?=\s|$)/)?.[0];
  const principal = linuxUser ? `group ${linuxUser}-files` : account;
  const base = `/v1/apps/${encodeURIComponent(app)}/folder-access`;
  const load = useCallback(async () => {
    try {
      const result = await api.get<{ grants: Grant[] }>(target, base);
      setGrants(result.grants);
      setError(null);
    } catch (failure) {
      setError(describeError(failure));
    }
  }, [target, base]);
  usePolling(load, 2000);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  }

  // R23-UNKNOWN: the owner removes or keeps access that Eugene did not add.
  function decide(grant: string, entry: string, action: "remove" | "keep") {
    return act(async () => {
      const result = await api.post<Grant>(
        target,
        `${base}/${encodeURIComponent(grant)}/unknown/${encodeURIComponent(entry)}`,
        { action },
      );
      setMessage(result.message);
    });
  }

  return (
    <section className="section-panel flex flex-col gap-3" aria-label="Folders Workbench can open">
      <h3 className="section-heading font-ui text-sm font-semibold">Folders Workbench can open</h3>
      <p className="text-sm">
        Give Workbench&apos;s account access to a shared project folder. Each person still needs a
        grant in Workbench. Use a Job Site for your own folders.
      </p>
      {error && (
        <p role="alert" className="status-error text-sm">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {grants.map((grant) => (
        <article key={grant.id} className="flex flex-col gap-2 text-sm">
          <p>
            {grant.path} ·{" "}
            {grant.mode === "write"
              ? grant.restartNeeded
                ? "write after restart"
                : "read and write"
              : "read only"}{" "}
            · {grant.state}
          </p>
          <p>{grant.message}</p>
          {(grant.unknown ?? []).map((found) =>
            found.decision === "pending" ? (
              <div key={found.id} className="flex flex-col gap-1">
                <p>
                  {found.kind === "hardlink"
                    ? `Workbench can still open ${found.path}: ${found.entry}.`
                    : `Workbench can still open ${found.path}: ${found.entry}. Eugene did not add this entry.`}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() => decide(grant.id, found.id, "remove")}
                  >
                    {found.kind === "hardlink"
                      ? "Remove access here and there"
                      : "Remove this entry too"}
                  </button>
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() => decide(grant.id, found.id, "keep")}
                  >
                    Keep it
                  </button>
                </div>
              </div>
            ) : (
              <p key={found.id}>
                {found.kind === "hardlink"
                  ? `Workbench can still open ${found.path}: ${found.entry}.`
                  : `Workbench can still open ${found.path} through an entry Eugene did not add: ${found.entry}.`}
              </p>
            ),
          )}
          {grant.restartNeeded && grant.state === "ready" && (
            <ConfirmButton
              label="Restart Workbench"
              cancelLabel="Cancel"
              prompt={`Workbench restarts to write in ${grant.path}. Answers running in it stop.`}
              disabled={busy}
              className={button}
              onConfirm={() =>
                act(() => api.post(target, `/v1/apps/${encodeURIComponent(app)}/restart`, {}))
              }
            />
          )}
          {grant.state !== "removed" && (
            <ConfirmButton
              label="Remove access"
              cancelLabel="Cancel"
              prompt={`Remove only the permission Eugene added for ${grant.path}? Files stay.`}
              disabled={busy || grant.state === "applying" || grant.state === "removing"}
              className={button}
              onConfirm={() =>
                act(async () => {
                  const result = await api.delete<Grant>(
                    target,
                    `${base}/${encodeURIComponent(grant.id)}`,
                  );
                  setMessage(result.message);
                })
              }
            />
          )}
        </article>
      ))}
      <label className="text-sm">
        Folder path
        <input
          aria-label="Folder path"
          className="ml-2 rounded border p-1"
          value={path}
          onChange={(event) => setPath(event.target.value)}
          disabled={busy}
        />
      </label>
      <div>
        <button type="button" className={button} onClick={() => setBrowse(true)}>
          Browse
        </button>
      </div>
      {browse && (
        <FolderPicker
          target={target}
          initialPath={path}
          onPick={(chosen) => {
            setPath(chosen);
            setBrowse(false);
          }}
          onClose={() => setBrowse(false)}
        />
      )}
      <label className="text-sm">
        Access
        <select
          aria-label="Access"
          className="ml-2 rounded border p-1"
          value={mode}
          onChange={(event) => setMode(event.target.value as "read" | "write")}
          disabled={busy}
        >
          <option value="read">Read only</option>
          <option value="write">Read and write</option>
        </select>
      </label>
      <div>
        <ConfirmButton
          key={`${path}:${mode}`}
          label="Give access"
          cancelLabel="Cancel"
          className={button}
          disabled={busy || !path.trim() || !account}
          prompt={
            <>
              <span>{`Give ${principal} ${mode === "write" ? "read and write" : "read"} access to ${path} and everything in it? Everyone granted this folder in Workbench can read it.`}</span>
              <span className="block">
                New files in it follow the folder&apos;s permissions while access is on.
              </span>
            </>
          }
          onConfirm={() =>
            act(async () => {
              const result = await api.post<Grant>(target, base, { path, mode });
              setMessage(result.message);
            })
          }
        />
      </div>
      <details className="text-sm">
        <summary>Expert override</summary>Use the host&apos;s Security tab or ACL editor for manual
        permissions. Eugene leaves preexisting permissions in place.
      </details>
    </section>
  );
}
