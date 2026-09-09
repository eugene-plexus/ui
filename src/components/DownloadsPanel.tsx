"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { formatBytes } from "@/components/FitBadge";
import { ApiError, api } from "@/lib/api";
import type { Download, DownloadList, DownloadState } from "@/lib/types";

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
}: {
  downloads: Download[];
  onChanged: () => void;
  emptyHint?: React.ReactNode;
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
      setError(errorText(err));
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
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  if (downloads.length === 0) {
    return emptyHint ? (
      <p className="px-1 py-2 text-xs text-[color:var(--muted)]">{emptyHint}</p>
    ) : null;
  }

  return (
    <div className="space-y-2">
      {error && (
        <p className="status-error rounded-[var(--radius)] border px-3 py-2 text-xs">{error}</p>
      )}
      {downloads.map((download) => (
        <DownloadRow
          key={download.id}
          download={download}
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
  busy,
  confirming,
  onPause,
  onResume,
  onAskCancel,
  onAbandonCancel,
  onCancel,
}: {
  download: Download;
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
    <div className="space-y-1.5 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-ui truncate text-xs font-semibold" title={download.repo}>
            {download.repo}
          </p>
          <p
            className="font-mono-ui truncate text-[11px] text-[color:var(--muted)]"
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

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-[color:var(--muted)]">
        <span className={download.state === "failed" ? "text-status-error" : undefined}>
          {STATE_LABEL[download.state]}
        </span>
        {total > 0 && (
          <span className="tabular-nums">
            {formatBytes(got)} of {formatBytes(total)}
            {percent > 0 && percent < 100 && <> ({percent.toFixed(0)}%)</>}
          </span>
        )}
        {download.bytesPerSecond ? (
          <span className="tabular-nums">{formatBytes(download.bytesPerSecond)}/s</span>
        ) : null}
        {download.etaSeconds != null && active && download.etaSeconds > 0 && (
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
        <p className="text-status-warn text-[11px]">
          This file changed upstream since the download started, so the partial copy was discarded
          and it is being fetched again from the beginning.
        </p>
      )}

      {download.error && (
        <p className="text-status-error text-[11px]">
          {download.error}
          {download.errorCode === "GatedRepo" && (
            <>
              {" "}
              Accept the licence on the model&rsquo;s own page, then set a catalogue token on the{" "}
              <Link href="/config" className="underline">
                Config
              </Link>{" "}
              page.
            </>
          )}
        </p>
      )}

      {!download.error && download.message && download.state !== "done" && (
        <p className="text-[11px] text-[color:var(--muted)]">{download.message}</p>
      )}

      {download.state === "done" && (
        <p className="text-[11px]">
          {download.modelId ? (
            <Link href={`/library?model=${download.modelId}`} className="underline">
              open in the library
            </Link>
          ) : (
            <span className="text-[color:var(--muted)]">
              on disk — it will appear in the library on the next scan
            </span>
          )}
        </p>
      )}
    </div>
  );
}

const smallButton =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-0.5 text-[11px] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";

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

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  return `${hours}h ${Math.round((seconds % 3600) / 60)}m`;
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { detail?: { detail?: string; title?: string } } | undefined;
    return body?.detail?.detail ?? body?.detail?.title ?? err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
