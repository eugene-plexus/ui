"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { ConfirmButton } from "@/components/ConfirmButton";
import { api, describeError } from "@/lib/api";
import type { HelperGrant, NodeHelper, Person } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

type Helper = NodeHelper & {
  online: boolean;
  ready?: boolean;
  supported?: boolean | null;
  reason?: string | null;
  account?: string | null;
  /** A job site (remote-nodes.md §3.3): its folders and who may use them are
   * its owner's. In production mode only that it exists and whether it is
   * online is shown (`hidden`); dev mode shows its folders, read-only, and
   * lets the owner give themselves access. */
  jobSite?: boolean;
  hidden?: boolean;
  ownerName?: string | null;
};
const button =
  "action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-sm disabled:opacity-40";
const input =
  "rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 text-sm";

export function NodeHelpers({
  people,
  onChanged,
}: {
  people: Person[];
  onChanged: () => Promise<void>;
}) {
  const [helpers, setHelpers] = useState<Helper[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [personId, setPersonId] = useState("");
  const load = useCallback(async () => {
    try {
      const data = await api.get<{ helpers: Helper[] }>("control", "/v1/node-helpers");
      setHelpers(data.helpers);
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }, []);
  usePolling(load, 5000);
  const person = people.find((p) => p.id === personId);
  return (
    <section
      id="node-files"
      aria-labelledby="node-files-heading"
      className="section-panel flex flex-col gap-4"
    >
      <h2 id="node-files-heading" className="section-heading font-ui text-base font-semibold">
        Files on your machines
      </h2>
      <p className="text-sm text-[color:var(--muted)]">
        Enable file support on an enrolled machine, register a folder, then choose who can use it.
        Workbench can reach these folders from another machine. Inference is optional.
        <Link href="/nodes" className="ml-1 underline">
          Manage machines
        </Link>
      </p>
      {error && (
        <p role="status" className="text-sm">
          {error}
        </p>
      )}
      {helpers?.length === 0 && <p>No enrolled machines yet.</p>}
      {helpers?.map((helper) =>
        helper.jobSite ? (
          <JobSiteMachine key={helper.node} helper={helper} onChanged={load} />
        ) : (
          <HelperMachine key={helper.node} helper={helper} onChanged={load} />
        ),
      )}
      {helpers && people.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-[color:var(--border)] pt-4">
          <label className="flex flex-col gap-1 text-sm">
            Folder access for
            <select
              className={input}
              value={personId}
              onChange={(e) => setPersonId(e.target.value)}
            >
              <option value="">Choose a person</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName || p.name}
                  {p.disabled ? " (sign-in disabled)" : ""}
                </option>
              ))}
            </select>
          </label>
          {person && (
            <PersonFolders
              key={`${person.id}:${JSON.stringify(person.helperGrants)}`}
              person={person}
              helpers={helpers}
              onChanged={onChanged}
            />
          )}
        </div>
      )}
      <p className="text-sm text-[color:var(--muted)]">
        Folder access does not allow managing this machine or its inference engines. Each file
        operation still requires approval in Workbench. Removing access leaves files and saved
        conversations intact.
      </p>
    </section>
  );
}

function JobSiteMachine({ helper, onChanged }: { helper: Helper; onChanged: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const endpoint = `/v1/node-helpers/${encodeURIComponent(helper.node)}`;
  return (
    <details
      className="rounded-[var(--radius)] border border-[color:var(--border)] p-3"
      data-testid={`job-site-files-${helper.node}`}
    >
      <summary className="font-ui cursor-pointer text-sm font-semibold">
        {helper.node} · job site of {helper.ownerName ?? "a person"} ·{" "}
        {helper.online ? "Online" : "Offline"}
      </summary>
      <div className="mt-3 flex flex-col gap-3 text-sm">
        <p>
          A job site&apos;s folders, and who may use them, are its owner&apos;s: they manage them
          from Workbench (Job sites).
          {helper.hidden
            ? " This install is in production mode, so they are not shown here."
            : " This install is in dev mode, so they are shown, and you may give yourself access."}
        </p>
        {error && (
          <p role="alert" className="status-error">
            {error}
          </p>
        )}
        {!helper.hidden &&
          helper.folders.map((folder) => (
            <div
              key={folder.id}
              className="flex flex-col gap-2 border-t border-[color:var(--border)] pt-2"
            >
              <p className="font-semibold">
                {folder.name} · {folder.writable ? "Text writes allowed" : "Read only"}
              </p>
              <p className="break-all text-[color:var(--muted)]">{folder.path}</p>
              <label className="flex flex-wrap items-center gap-2">
                Your Workbench access (dev mode only)
                <select
                  aria-label={`Owner access to ${folder.name} on ${helper.node}`}
                  className={input}
                  value={folder.ownerAccess}
                  onChange={(e) => {
                    setError(null);
                    api
                      .patch("control", `${endpoint}/folders/${folder.id}`, {
                        ownerAccess: e.target.value,
                      })
                      .then(onChanged)
                      .catch((problem) => setError(describeError(problem)));
                  }}
                >
                  <option value="none">No access</option>
                  <option value="read">Read only</option>
                  {folder.writable && <option value="write">Read and write text</option>}
                </select>
              </label>
            </div>
          ))}
      </div>
    </details>
  );
}

function HelperMachine({ helper, onChanged }: { helper: Helper; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [writable, setWritable] = useState(false);
  const [ownerAccess, setOwnerAccess] = useState("none");
  const endpoint = `/v1/node-helpers/${encodeURIComponent(helper.node)}`;
  async function change(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="rounded-[var(--radius)] border border-[color:var(--border)] p-3">
      <summary className="font-ui cursor-pointer text-sm font-semibold">
        {helper.node} ·{" "}
        {!helper.enabled
          ? "File support off"
          : helper.ready
            ? "Ready"
            : helper.online
              ? "Not ready"
              : "Offline"}
      </summary>
      <div className="mt-3 flex flex-col gap-3 text-sm">
        {helper.reason && <p>{helper.reason}</p>}
        <button
          className={`${button} self-start`}
          disabled={busy || (!helper.enabled && helper.supported === false)}
          onClick={() =>
            void change(() => api.put("control", endpoint, { enabled: !helper.enabled }))
          }
        >
          {helper.enabled ? "Disable file support" : "Enable file support"}
        </button>
        {helper.account && (
          <p className="break-all text-[color:var(--muted)]">
            File helper account: {helper.account}
          </p>
        )}
        {error && (
          <p role="alert" className="status-error">
            {error}
          </p>
        )}
        {helper.folders.length === 0 && <p>No folders shared on this machine.</p>}
        {helper.folders.map((folder) => (
          <div
            key={folder.id}
            className="flex flex-col gap-2 border-t border-[color:var(--border)] pt-2"
          >
            <p className="font-semibold">
              {folder.name} · {folder.writable ? "Text writes allowed" : "Read only"}
            </p>
            <p className="break-all text-[color:var(--muted)]">{folder.path}</p>
            <label className="flex flex-wrap items-center gap-2">
              Owner&apos;s Workbench access
              <select
                aria-label={`Owner access to ${folder.name} on ${helper.node}`}
                className={input}
                value={folder.ownerAccess}
                disabled={busy}
                onChange={(e) =>
                  void change(() =>
                    api.patch("control", `${endpoint}/folders/${folder.id}`, {
                      ownerAccess: e.target.value,
                    }),
                  )
                }
              >
                <option value="none">No access</option>
                <option value="read">Read only</option>
                {folder.writable && <option value="write">Read and write text</option>}
              </select>
            </label>
            <ConfirmButton
              label="Remove folder"
              confirmLabel="Remove access"
              onConfirm={() =>
                change(() => api.delete("control", `${endpoint}/folders/${folder.id}`))
              }
            />
          </div>
        ))}
        {helper.enabled && (
          <form
            className="flex flex-col gap-3 border-t border-[color:var(--border)] pt-3"
            aria-label={`Register folder on ${helper.node}`}
            onSubmit={(event) => {
              event.preventDefault();
              void change(async () => {
                await api.post("control", `${endpoint}/folders`, {
                  name,
                  path,
                  writable,
                  ownerAccess,
                });
                setName("");
                setPath("");
                setWritable(false);
                setOwnerAccess("none");
              });
            }}
          >
            <p>
              Choose an existing folder. The helper account must already have OS permission to use
              it. Registering a folder does not change those permissions.
            </p>
            <label className="flex flex-col gap-1">
              Folder name
              <input
                required
                maxLength={80}
                className={input}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              Full folder path on {helper.node}
              <input
                required
                maxLength={4096}
                spellCheck={false}
                className={input}
                value={path}
                onChange={(e) => setPath(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={writable}
                onChange={(e) => {
                  setWritable(e.target.checked);
                  if (!e.target.checked && ownerAccess === "write") setOwnerAccess("read");
                }}
              />
              Allow creating and editing text files
            </label>
            <label className="flex flex-col gap-1">
              Owner&apos;s access
              <select
                className={input}
                value={ownerAccess}
                onChange={(e) => setOwnerAccess(e.target.value)}
              >
                <option value="none">No access</option>
                <option value="read">Read only</option>
                {writable && <option value="write">Read and write text</option>}
              </select>
            </label>
            <p className="text-[color:var(--muted)]">
              UTF-8 text only: reads up to 32 KiB and 16384 characters; writes up to 8192
              characters. No links, deletion or program execution.
            </p>
            <button className={`${button} self-start`} disabled={busy || !helper.ready}>
              Register folder
            </button>
          </form>
        )}
      </div>
    </details>
  );
}

function PersonFolders({
  person,
  helpers,
  onChanged,
}: {
  person: Person;
  helpers: Helper[];
  onChanged: () => Promise<void>;
}) {
  const [grants, setGrants] = useState<HelperGrant[]>(person.helperGrants || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A job site's folders are granted by its owner, never from here.
  const folders = helpers
    .filter((helper) => !helper.jobSite)
    .flatMap((helper) => helper.folders.map((folder) => ({ ...folder, node: helper.node })));
  const missing = grants.filter((grant) => !folders.some((f) => f.id === grant.folderId));
  return (
    <form
      aria-label={`Node folder access for ${person.name}`}
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.patch("control", `/v1/people/${person.id}`, { helperGrants: grants });
          await onChanged();
        } catch (problem) {
          setError(describeError(problem));
        } finally {
          setBusy(false);
        }
      }}
    >
      {folders.length === 0 && <p>Register a folder on a machine above before assigning access.</p>}
      {folders.map((folder) => {
        const grant = grants.find((g) => g.folderId === folder.id);
        return (
          <label
            key={folder.id}
            className="flex flex-wrap items-center justify-between gap-2 text-sm"
          >
            {folder.node} · {folder.name}
            <select
              className={input}
              aria-label={`${person.name} access to ${folder.name} on ${folder.node}`}
              value={grant ? (grant.writable ? "write" : "read") : "none"}
              onChange={(e) =>
                setGrants([
                  ...grants.filter((g) => g.folderId !== folder.id),
                  ...(e.target.value === "none"
                    ? []
                    : [{ folderId: folder.id, writable: e.target.value === "write" }]),
                ])
              }
            >
              <option value="none">No access</option>
              <option value="read">Read only</option>
              {folder.writable && <option value="write">Read and write text</option>}
            </select>
          </label>
        );
      })}
      {missing.length > 0 && (
        <p className="text-sm">
          {missing.length} previously granted folder(s) were removed or their machine changed.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setGrants(grants.filter((g) => !missing.includes(g)))}
          >
            Clear unavailable grants
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="status-error text-sm">
          {error}
        </p>
      )}
      <button className={`${button} self-start`} disabled={busy || missing.length > 0}>
        Save folder access
      </button>
    </form>
  );
}
