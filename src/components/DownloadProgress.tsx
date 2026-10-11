"use client";

import { formatBytes } from "@/components/FitBadge";
import type { Download, DownloadState } from "@/lib/types";

const phase: Record<DownloadState, string> = {
  queued: "Queued",
  resolving: "Finding files",
  downloading: "Downloading",
  verifying: "Verifying files",
  paused: "Download paused",
  done: "Downloaded; waiting for the library",
  failed: "Download failed",
  cancelled: "Download cancelled",
};

export function DownloadProgress({ download }: { download: Download }) {
  const total = download.bytesTotal;
  const got = download.bytesDownloaded;
  const knownTotal = typeof total === "number" && Number.isFinite(total) && total > 0;
  const knownGot = typeof got === "number" && Number.isFinite(got) && got >= 0;
  const transferring = download.state === "downloading" || download.state === "paused";
  const percent =
    knownTotal && knownGot && transferring ? Math.min(100, (got / total) * 100) : null;
  const hasBar = !["done", "failed", "cancelled"].includes(download.state);
  const detail = knownGot
    ? knownTotal
      ? `${formatBytes(got)} of ${formatBytes(total)}`
      : `${formatBytes(got)} so far · size not known yet`
    : "Waiting for a size reading";

  return (
    <div className="w-full min-w-0 space-y-2" data-testid="smaller-file-progress">
      <p
        role="status"
        className="font-ui flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm"
      >
        <span>
          {download.state === "failed"
            ? `The download failed: ${download.error ?? download.message ?? "no reason given"}`
            : phase[download.state]}
        </span>
        {percent !== null && <span className="tabular-nums">{Math.round(percent)}%</span>}
      </p>
      {hasBar && (
        <>
          <div
            role="progressbar"
            aria-label={`${phase[download.state]}: ${download.repo}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent === null ? undefined : percent}
            aria-valuetext={transferring ? detail : phase[download.state]}
            className="h-2 overflow-hidden rounded-full border border-[color:var(--border)] bg-[color:var(--panel-soft)]"
          >
            {percent === null ? (
              <div className="visual-hatch h-full text-[color:var(--border-hover)]" />
            ) : (
              <div
                className="h-full bg-[color:var(--accent-left)]"
                style={{ width: `${percent}%` }}
              />
            )}
          </div>
          {transferring && (
            <p className="font-ui text-xs text-[color:var(--muted)] tabular-nums">{detail}</p>
          )}
        </>
      )}
    </div>
  );
}
