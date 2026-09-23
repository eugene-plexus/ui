"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { formatBytes } from "@/components/FitBadge";
import { RunButton } from "@/components/RunButton";
import { ApiError, api, describeError } from "@/lib/api";
import type { TargetNode } from "@/lib/nodeBudget";
import { formatBytesShort, formatDuration } from "@/lib/tasks";
import type { Download, DownloadList, DownloadState, LibraryModel } from "@/lib/types";

/**
 * Downloads in flight, and the ones that finished.
 *
 * Polled only while something is actually transferring: a finished list
 * does not change on its own, and a steady poll would have the UI asking
 * a component that talks to the network to do work on a timer for
 * nothing.
 *
 * The three verbs are deliberately distinct and the difference matters:
 *
 *   pause   stops transferring and **keeps** the partial file
 *   resume  re-resolves upstream, checks the file has not changed, and
 *           continues from the bytes on disk
 *   cancel  stops and **removes** the `.part`, then forgets the record
 *
 * That is why cancel asks first. A paused 40 GB download is an hour of
 * bandwidth sitting on the disk, and the two buttons are next to each
 * other.
 *
 * **A finished download offers Run in place** (hobbyist UX §7 S3). The
 * library fills `modelId` after its post-completion scan, which is what
 * closes download → library → launch without the person walking to the
 * Library and finding the file again; the row reads the model by that
 * id and hands it to `RunButton` for the node the screen is about.
 */

const POLL_MS = 800;

const ACTIVE: DownloadState[] = ["queued", "resolving", "downloading", "verifying"];

const STATE_LABEL: Record<DownloadState, string> = {
  queued: "queued",
  resolving: "resolving",
  downloading: "downloading",
  verifying: "verifying",
  done: "complete",
  failed: "failed",
  paused: "paused",
  cancelled: "cancelled",
};

export function DownloadsPanel({
  downloads,
  onChanged,
  emptyHint,
  node = null,
}: {
  downloads: Download[];
  onChanged: () => void;
  emptyHint?: React.ReactNode;
  /** Where Run goes for a finished download. Absent: no Run is offered. */
  node?: TargetNode | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

  async function act(id: string, verb: "pause" | "resume") {
    setBusy(id);
    setError(null);
    try {
      await api.post(`library`, `/v1/downloads/${id}/${verb}`, {});
      onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  async function cancel(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api.delete(`library`, `/v1/downloads/${id}`);
      setConfirmCancel(null);
      onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  if (downloads.length === 0) {
    return emptyHint ? (
      <p className="px-1 py-2 text-sm text-[color:var(--muted)]">{emptyHint}</p>
    ) : null;
  }

  return (
    <div className="space-y-2">
      {error && (
        <p className="status-error rounded-[var(--radius)] border px-3 py-2 text-sm" role="alert">
          {error}
        </p>
      )}
      {downloads.map((download) => (
        <DownloadRow
          key={download.id}
          download={download}
          node={node}
          busy={busy === download.id}
          confirming={confirmCancel === download.id}
          onPause={() => void act(download.id, "pause")}
          onResume={() => void act(download.id, "resume")}
          onAskCancel={() => setConfirmCancel(download.id)}
          onAbandonCancel={() => setConfirmCancel(null)}
          onCancel={() => void cancel(download.id)}
        />
      ))}
    </div>
  );
}

function DownloadRow({
  download,
  node,
  busy,
  confirming,
  onPause,
  onResume,
  onAskCancel,
  onAbandonCancel,
  onCancel,
}: {
  download: Download;
  node: TargetNode | null;
  busy: boolean;
  confirming: boolean;
  onPause: () => void;
  onResume: () => void;
  onAskCancel: () => void;
  onAbandonCancel: () => void;
  onCancel: () => void;
}) {
  const total = download.bytesTotal ?? 0;
  const got = download.bytesDownloaded ?? 0;
  const percent = total > 0 ? Math.min(100, (got / total) * 100) : 0;
  const active = ACTIVE.includes(download.state);
  const resumable = download.state === "paused" || download.state === "failed";

  return (
    <div
      className="space-y-1.5 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2"
      data-testid="download-row"
      data-download-state={download.state}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-ui truncate text-sm font-semibold" title={download.repo}>
            {download.repo}
          </p>
          <p
            className="font-mono-ui truncate text-[0.6875rem] text-[color:var(--muted)]"
            title={download.destinationDirectory ?? undefined}
          >
            {download.files.length === 1
              ? (download.files[0]?.destinationPath ?? "")
              : `${download.files.length} files → ${download.destinationDirectory ?? ""}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {active && (
            <button type="button" onClick={onPause} disabled={busy} className={smallButton}>
              pause
            </button>
          )}
          {resumable && (
            <button type="button" onClick={onResume} disabled={busy} className={smallButton}>
              resume
            </button>
          )}
          {confirming ? (
            <>
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className={`${smallButton} text-status-error`}
                title="Stops the transfer and deletes the partial file. Anything already finished stays."
              >
                {download.state === "done" ? "forget" : "delete partial"}
              </button>
              <button type="button" onClick={onAbandonCancel} className={smallButton}>
                keep
              </button>
            </>
          ) : (
            <button type="button" onClick={onAskCancel} disabled={busy} className={smallButton}>
              {download.state === "done" ? "forget" : "cancel"}
            </button>
          )}
        </div>
      </div>

      {(active || download.state === "paused") && (
        <div
          className="h-1 overflow-hidden rounded-full bg-[color:var(--panel-hover)]"
          role="progressbar"
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-[color:var(--accent-left)] transition-[width] duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[0.6875rem] text-[color:var(--muted)]">
        <span className={download.state === "failed" ? "text-status-error" : undefined}>
          {STATE_LABEL[download.state]}
        </span>
        {total > 0 && (
          <span className="tabular-nums">
            {formatBytes(got)} of {formatBytes(total)}
            {percent > 0 && percent < 100 && <> ({percent.toFixed(0)}%)</>}
          </span>
        )}
        {/* Speed and time left only while bytes are moving. The library
            keeps the last rate on the record, so a finished or paused row
            read "97 MB/s" as though it were still running -- and the
            tray, which reads the same record, already said nothing. */}
        {download.state === "downloading" && download.bytesPerSecond ? (
          <span className="tabular-nums">{formatBytesShort(download.bytesPerSecond)}/s</span>
        ) : null}
        {download.state === "downloading" &&
          download.etaSeconds != null &&
          download.etaSeconds > 0 && (
            <span className="tabular-nums">{formatDuration(download.etaSeconds)} left</span>
          )}
        {(download.attempts ?? 0) > 1 && (
          <span title="Each attempt re-resolves upstream and continues from the bytes already on disk.">
            attempt {download.attempts}
          </span>
        )}
      </div>

      {/* A file replaced upstream mid-download. Worth saying out loud:
          the operator is about to re-spend bandwidth they already spent,
          and the reason is that a publisher requantized under the same
          filename. */}
      {download.restartedFromZero && (
        <p className="text-status-warn text-[0.6875rem]">
          This file changed upstream since the download started, so the partial copy was discarded
          and it is being fetched again from the beginning.
        </p>
      )}

      {download.error && (
        <p className="text-status-error text-[0.6875rem]">
          {download.error}
          {download.errorCode === "GatedRepo" && (
            <>
              {" "}
              Accept the licence on the model&rsquo;s own page, then set a catalogue token on the{" "}
              {/* The Library's own settings, where `hfToken` lives. A bare
                  `/config` selects nothing and opens an empty page. */}
              <Link href="/config?sel=library" className="underline">
                Config
              </Link>{" "}
              page.
            </>
          )}
        </p>
      )}

      {!download.error && download.message && download.state !== "done" && (
        <p className="text-[0.6875rem] text-[color:var(--muted)]">{download.message}</p>
      )}

      {download.state === "done" && (
        <div className="flex flex-wrap items-start gap-3 text-[0.6875rem]">
          {download.modelId ? (
            <>
              {node && <FinishedRun modelId={download.modelId} node={node} />}
              <Link
                href={`/library?model=${download.modelId}`}
                className="self-center underline"
                data-testid="download-open-library"
              >
                open in the library
              </Link>
            </>
          ) : (
            <span className="text-[color:var(--muted)]">
              on disk — it will appear in the library on the next scan
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Run, on a finished download. The library entry is read once by the id
 * the download record carries; a read that fails leaves the link to the
 * Library, which is where the same button lives.
 */
function FinishedRun({ modelId, node }: { modelId: string; node: TargetNode }) {
  const [model, setModel] = useState<LibraryModel | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const entry = await api.get<LibraryModel>(
          "library",
          `/v1/models/${encodeURIComponent(modelId)}`,
        );
        if (!cancelled) setModel(entry);
      } catch {
        // The link beside this button still leads to the model.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modelId]);
  if (!model) return null;
  return <RunButton model={model} node={node} size="small" className="min-w-0 flex-1" />;
}

const smallButton =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-0.5 text-[0.6875rem] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";

/**
 * Poll downloads while any is active. Shared by the discovery page and
 * the library page, so a transfer started on one is visible on the other
 * — a download outlives the screen it was started from.
 */
export function useDownloads(): { downloads: Download[]; reload: () => void; active: number } {
  const [downloads, setDownloads] = useState<Download[]>([]);

  const reload = useCallback(async () => {
    try {
      const list = await api.get<DownloadList>("library", "/v1/downloads");
      setDownloads(list.downloads ?? []);
    } catch (err) {
      // A download-list read failing must not blank the page around it;
      // whatever else is on screen is still true.
      if (err instanceof ApiError && err.status === 401) return;
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const active = downloads.filter((d) => ACTIVE.includes(d.state)).length;

  useEffect(() => {
    if (active === 0) return;
    const id = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(id);
  }, [active, reload]);

  return { downloads, reload: () => void reload(), active };
}
