"use client";

import { useCallback, useEffect, useState } from "react";

import { ConfirmButton } from "@/components/ConfirmButton";
import { api, describeError } from "@/lib/api";
import {
  formatBytes,
  ownerLabel,
  removedOwners,
  shortDate,
  sweepLine,
  type OwnerNames,
  type StoreOwnerList,
  type StoreStatus,
} from "@/lib/storeOwners";

/**
 * What the store keeps, per owner: counts and bytes, never names of files
 * or their content (row 53). Shown under Settings → Files apps keep.
 *
 * A person Eugene removed has their files hidden from everyone, the owner
 * included, and deleted on their date (row 7's rules, R53-REMOVE): they
 * are listed apart, with the date and Delete now, which deletes at once
 * and for good.
 */
export function StoreOwners() {
  const [owners, setOwners] = useState<StoreOwnerList | null>(null);
  const [status, setStatus] = useState<StoreStatus | null>(null);
  const [names, setNames] = useState<OwnerNames>({ people: new Map(), keys: new Map() });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, state] = await Promise.all([
        api.get<StoreOwnerList>("store", "/v1/owners"),
        api.get<StoreStatus>("store", "/v1/store/status"),
      ]);
      setOwners(list);
      setStatus(state);
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
    // Names are a courtesy: without them a row still says what it holds.
    const [people, keys] = await Promise.all([
      api
        .get<{
          people?: { id: string; displayName?: string | null; name: string }[];
        }>("control", "/v1/people")
        .catch(() => null),
      api
        .get<{ keys?: { id: string; name: string }[] }>("agent", "/v1/auth/client-keys")
        .catch(() => null),
    ]);
    setNames({
      people: new Map((people?.people ?? []).map((p) => [p.id, p.displayName || p.name])),
      keys: new Map((keys?.keys ?? []).map((k) => [k.id, k.name])),
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function deleteNow(owner: string) {
    try {
      await api.post("store", "/v1/removals/delete", { owner });
      await load();
    } catch (e) {
      setError(describeError(e));
    }
  }

  if (error) {
    return (
      <p role="alert" data-testid="store-owners-error" className="text-status-error mt-3 text-sm">
        The store did not answer: {error}
      </p>
    );
  }
  if (!owners || !status) return null;
  const removed = removedOwners(owners);
  const kept = owners.owners.filter((o) => o.deleteAt == null);
  const line = sweepLine(status.lastSweep);
  return (
    <div data-testid="store-owners" className="mt-4 flex flex-col gap-2 text-sm">
      <h3 className="font-ui font-semibold">What is kept, by whom</h3>
      {kept.length === 0 ? (
        <p className="text-[color:var(--muted)]">No app has kept a file yet.</p>
      ) : (
        <table className="w-full text-left">
          <thead className="text-[color:var(--muted)]">
            <tr>
              <th className="font-normal">Owner</th>
              <th className="font-normal">Files</th>
              <th className="font-normal">Space</th>
            </tr>
          </thead>
          <tbody>
            {kept.map((o) => (
              <tr key={o.owner} data-testid="store-owner">
                <td>{ownerLabel(o.owner, names)}</td>
                <td>
                  {o.files}
                  {o.uploads > 0 ? ` (+${o.uploads} uploading)` : ""}
                </td>
                <td>{formatBytes(o.bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-[color:var(--muted)]">
        {owners.files} file{owners.files === 1 ? "" : "s"}, {formatBytes(owners.blobBytes)} on disk.
        You see how much each owner keeps, never what.
      </p>
      {line && <p data-testid="store-sweep">{line}</p>}
      {removed.length > 0 && (
        <div data-testid="store-removed" className="section-panel flex flex-col gap-2">
          <h3 className="font-ui font-semibold">Removed people</h3>
          <p className="text-[color:var(--muted)]">
            Eugene removed {removed.length === 1 ? "this person" : "these people"}: their files are
            hidden from everyone, you included, and deleted on the date shown. If Eugene has them
            again first, their files come back.
          </p>
          <ul className="flex flex-col gap-2">
            {removed.map((o) => (
              <li
                key={o.owner}
                data-testid="store-removed-person"
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span>
                  {ownerLabel(o.owner, names)} · {o.files} file{o.files === 1 ? "" : "s"},{" "}
                  {formatBytes(o.bytes)} · removed {shortDate(o.removedAt ?? 0)} · deleted on{" "}
                  {shortDate(o.deleteAt ?? 0)}
                </span>
                <ConfirmButton
                  label="Delete now"
                  prompt="Their files are deleted now, with every copy. This cannot be undone."
                  onConfirm={() => deleteNow(o.owner)}
                  ariaLabel={`Delete now: ${ownerLabel(o.owner, names)}`}
                  testId="store-delete-now"
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
