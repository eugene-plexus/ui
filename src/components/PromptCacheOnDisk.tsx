"use client";

/**
 * The prompt cache on disk, under its settings on a machine's agent (row 15, DI2; call
 * DI-C4): what is kept now, per model, and Clear.
 *
 * The agent saves what a llama.cpp model holds of each chat when it stops the model, and
 * reads it back at the next start. The files are copies of people's chats, so this shows
 * counts, sizes and the folder, never what a conversation says. Clear deletes every file;
 * it stops nothing and does not turn the setting off, and the line beside the button says
 * so before it is pressed.
 */

import { useCallback, useEffect, useState } from "react";

import { api, describeError } from "@/lib/api";
import type { ProxyTarget } from "@/lib/config";
import { size } from "@/lib/promptCache";
import type { PromptCacheOnDisk as Kept, PromptCacheOnDiskCleared } from "@/lib/types";

function conversations(count: number): string {
  return `${count} saved conversation${count === 1 ? "" : "s"}`;
}

export function PromptCacheOnDisk({ target }: { target: ProxyTarget }) {
  const [kept, setKept] = useState<Kept | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cleared, setCleared] = useState<PromptCacheOnDiskCleared | null>(null);

  const read = useCallback(async () => {
    try {
      setKept(await api.get<Kept>(target, "/v1/prompt-cache"));
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }, [target]);

  useEffect(() => {
    void read();
  }, [read]);

  async function clear() {
    setBusy(true);
    setError(null);
    setCleared(null);
    try {
      setCleared(await api.delete<PromptCacheOnDiskCleared>(target, "/v1/prompt-cache"));
      await read();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2 text-sm" data-testid="prompt-cache-on-disk">
      {kept && (
        <div className="text-[color:var(--muted)]">
          <p data-testid="prompt-cache-on-disk-kept">
            {kept.conversations === 0
              ? "No conversation is saved."
              : `${conversations(kept.conversations)}, ${size(kept.bytes)}.`}
          </p>
          {kept.runtimes.length > 0 && (
            <ul className="mt-1 list-disc pl-4">
              {kept.runtimes.map((r) => (
                <li key={r.runtime}>
                  {r.runtime}: {r.conversations}, {size(r.bytes)}
                </li>
              ))}
            </ul>
          )}
          {kept.folder && (
            <p className="mt-1">
              In <span className="font-mono">{kept.folder}</span>
            </p>
          )}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={clear}
          disabled={busy}
          className="action-button font-ui w-fit rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Deleting…" : "Delete saved conversations"}
        </button>
        <p className="text-[color:var(--muted)]">
          Running models save their conversations again when they stop. Turn the setting off to keep
          none.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-status-error">
          {error}
        </p>
      )}
      {cleared && (
        <div className="text-[color:var(--muted)]" data-testid="prompt-cache-on-disk-cleared">
          <p>
            {cleared.conversations === 0
              ? "There was nothing to delete."
              : `Deleted ${conversations(cleared.conversations)}, ${size(cleared.bytesFreed)}.`}
          </p>
          {cleared.notDeleted > 0 && (
            <p className="text-status-warn">
              {`${cleared.notDeleted} ${cleared.notDeleted === 1 ? "was" : "were"} not deleted: ${
                cleared.reason ?? "no reason given"
              }`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
