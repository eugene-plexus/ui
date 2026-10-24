"use client";

import { useCallback, useEffect, useState } from "react";

import { ConfirmButton } from "@/components/ConfirmButton";
import { api, describeError } from "@/lib/api";
import {
  formatBytes,
  ownerLabel,
  sweepLine,
  type OwnerNames,
  type StoreOwnerList,
  type StoreStatus,
} from "@/lib/storeOwners";

/**
 * What the store keeps, per owner: counts and bytes, never names of files
 * or their content (row 53). Shown under Settings → Files apps keep.
 *
 * Removed people the store holds (several were removed at once, so it
 * waits for the owner) are listed with the one action that deletes what
 * they kept.
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

  async function release() {
    try {
      await api.post("store", "/v1/removals/release", {});
      await load();
    } catch (e) {
      setError(describeError(e));
    }
  }

  if (error) {
    return (
      <p data-testid="store-owners-error" className="mt-3 text-sm text-[color:var(--danger)]">
        The store did not answer: {error}
      </p>
    );
  }
  if (!owners || !status) return null;
  const held = status.held ?? [];
  const line = sweepLine(status.lastSweep);
  return (
    <div data-testid="store-owners" className="mt-4 flex flex-col gap-2 text-sm">
      <h3 className="font-ui font-semibold">What is kept, by whom</h3>
      {owners.owners.length === 0 ? (
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
            {owners.owners.map((o) => (
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
      {held.length > 0 && (
        <div data-testid="store-held" className="section-panel border-dashed">
          <p>
            {held.length} removed {held.length === 1 ? "person's" : "people's"} files are kept until
            you choose: Eugene no longer knows {held.length === 1 ? "this person" : "them"}, and so
            many at once can mean a restored or wrong control root.
          </p>
          <ConfirmButton
            label="Delete their files"
            prompt="Their files are deleted for good. People Eugene knows again are kept."
            onConfirm={release}
            testId="store-release"
          />
        </div>
      )}
    </div>
  );
}
