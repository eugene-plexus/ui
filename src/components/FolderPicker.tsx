"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, api, describeError } from "@/lib/api";
import type { DirectoryListing } from "@/lib/types";

/**
 * A directory picker over one component's host (M11).
 *
 * `path_list` has promised this since M2 -- *"an add/remove list of
 * directory pickers"* -- and rendered text rows for three milestones,
 * because no component could list a directory. `GET /v1/directories`
 * exists on the library (its host holds the model roots) and on the agent
 * (its host holds a mapping's `to`), with one schema, so this is one
 * picker pointed at whichever component owns the field.
 *
 * **Whose disk this is** is the thing an operator gets wrong on a
 * multi-host install, so the header names the host the component
 * reported, not the machine the browser is on.
 *
 * Not a file browser: directories only, a path box beside the list for
 * the places that cannot be browsed to (a UNC share, a mount that is not
 * there yet), and "use this folder" for whatever is currently listed. A
 * component that does not implement the endpoint answers 404 or 405 and
 * the picker says so rather than pretending the disk is empty.
 */
export function FolderPicker({
  target,
  initialPath,
  onPick,
  onClose,
}: {
  /** Proxy target of the component whose host to browse. */
  target: string;
  /** Where to start; the host's roots when empty. */
  initialPath?: string | null;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [typed, setTyped] = useState<string>(initialPath ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(
    async (path: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const query = path && path.trim() ? `?path=${encodeURIComponent(path.trim())}` : "";
        const result = await api.get<DirectoryListing>(target, `/v1/directories${query}`);
        setListing(result);
        setTyped(result.path ?? "");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return;
        if (err instanceof ApiError && (err.status === 405 || isNotImplemented(err))) {
          setError(
            "This component cannot list directories, so there is nothing to browse. Type the path.",
          );
        } else {
          setError(describeError(err));
        }
      } finally {
        setLoading(false);
      }
    },
    [target],
  );

  useEffect(() => {
    void open(initialPath ?? null);
  }, [open, initialPath]);

  const current = listing?.path ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a directory"
    >
      <div className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] shadow-xl">
        <header className="flex items-center justify-between gap-3 border-b border-[color:var(--border)] px-4 py-3">
          <div>
            <h2 className="font-ui text-sm font-semibold">Choose a directory</h2>
            <p className="text-[11px] text-[color:var(--muted)]">
              {listing ? (
                <>
                  on <span className="font-mono">{listing.host}</span> — the machine this component
                  runs on, not necessarily the one you are browsing from
                </>
              ) : (
                "loading…"
              )}
            </p>
          </div>
          <button type="button" onClick={onClose} className={buttonClass} aria-label="Close">
            close
          </button>
        </header>

        <form
          className="flex items-center gap-2 border-b border-[color:var(--border)] px-4 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            void open(typed);
          }}
        >
          <input
            type="text"
            value={typed}
            spellCheck={false}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="type a path, or pick below"
            aria-label="Path"
            className="flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-1.5 font-mono text-xs outline-none focus:border-[color:var(--accent-left)]"
          />
          <button type="submit" className={buttonClass} disabled={loading}>
            go
          </button>
          <button
            type="button"
            onClick={() => void open(listing?.parent ?? null)}
            className={buttonClass}
            disabled={loading || !listing || (listing.parent == null && listing.path == null)}
            title={listing?.parent ? `up to ${listing.parent}` : "up to the roots"}
          >
            up
          </button>
        </form>

        <div className="min-h-[12rem] flex-1 overflow-y-auto px-2 py-2">
          {error && (
            <p className="status-error mx-2 rounded-[var(--radius)] border px-3 py-2 text-xs">
              {error}
            </p>
          )}
          {!error && listing && listing.entries.length === 0 && (
            <p className="px-2 py-1 text-xs text-[color:var(--muted)] italic">
              No subdirectories here.
            </p>
          )}
          {!error &&
            listing?.entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => void open(entry.path)}
                className="flex w-full items-center justify-between gap-3 rounded-[var(--radius)] px-2 py-1 text-left text-xs hover:bg-[color:var(--panel-hover)]"
                title={entry.path}
              >
                <span className="truncate">
                  <span className="mr-1.5 opacity-60" aria-hidden="true">
                    ▸
                  </span>
                  {entry.name}
                </span>
                {current === null && (
                  <span className="truncate font-mono text-[10px] text-[color:var(--muted)]">
                    {entry.path}
                  </span>
                )}
              </button>
            ))}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[color:var(--border)] px-4 py-3">
          <span
            className="truncate font-mono text-[11px] text-[color:var(--muted)]"
            title={current ?? ""}
          >
            {current ?? "pick a starting point"}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className={buttonClass}>
              cancel
            </button>
            <button
              type="button"
              onClick={() => current !== null && onPick(current)}
              disabled={current === null || loading}
              className="font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1 text-xs font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
            >
              use this folder
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/** A 404 that is FastAPI's "no such route", not the endpoint's "no such
 * directory" -- the latter carries a Problem document with a title. */
function isNotImplemented(err: ApiError): boolean {
  if (err.status !== 404) return false;
  const body = err.body as { detail?: unknown } | null;
  return typeof body?.detail === "string";
}

const buttonClass =
  "font-ui shrink-0 rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";
