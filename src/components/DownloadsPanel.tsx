"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { CopyButton } from "@/components/CopyButton";
import { DownloadProgress } from "@/components/DownloadProgress";
import { formatBytes } from "@/components/FitBadge";
import { RunButton } from "@/components/RunButton";
import { ApiError, api, describeError } from "@/lib/api";
import { downloadTarget, modelLibraryHref } from "@/lib/downloadHandoff";
import {
  betterAfterPreparing,
  eligibilityEngines,
  judge,
  type EngineVerdict,
  type FitQuestion,
} from "@/lib/eligibility";
import { engineName } from "@/lib/issues";
import { fitQuestion, type TargetNode } from "@/lib/nodeBudget";
import { formatBytesShort, formatDuration } from "@/lib/tasks";
import type { Download, DownloadList, DownloadState, LibraryModel, Scan } from "@/lib/types";
import { postEligibility, useNodeEngines } from "@/lib/useEligibility";

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
const NO_NODES: readonly TargetNode[] = [];

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
  nodes = NO_NODES,
}: {
  downloads: Download[];
  onChanged: () => void;
  emptyHint?: React.ReactNode;
  /** Where Run goes for a finished download. Absent: no Run is offered. */
  node?: TargetNode | null;
  nodes?: readonly TargetNode[];
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
          nodes={nodes}
          onChanged={onChanged}
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
  nodes,
  onChanged,
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
  nodes: readonly TargetNode[];
  onChanged: () => void;
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
          <div className="flex items-center gap-1">
            <p
              className="font-mono-ui min-w-0 truncate text-[0.6875rem] text-[color:var(--muted)]"
              title={download.destinationDirectory ?? undefined}
            >
              {download.files.length === 1
                ? (download.files[0]?.destinationPath ?? "")
                : `${download.files.length} files → ${download.destinationDirectory ?? ""}`}
            </p>
            {download.destinationDirectory && (
              <CopyButton
                text={download.destinationDirectory}
                label={`Copy folder of ${download.repo}`}
                title="Copy the folder path"
                iconOnly
                className="shrink-0 !px-1 !py-0"
              />
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {active && (
            <button
              type="button"
              onClick={onPause}
              disabled={busy}
              aria-label={`Pause ${download.repo}`}
              className={smallButton}
            >
              Pause
            </button>
          )}
          {resumable && (
            <button
              type="button"
              onClick={onResume}
              disabled={busy}
              aria-label={`Resume ${download.repo}`}
              className={smallButton}
            >
              Resume
            </button>
          )}
          {confirming ? (
            <>
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                aria-label={`${download.state === "done" ? "Forget" : "Delete partial of"} ${download.repo}`}
                className={`${smallButton} text-status-error`}
                title="Stops the transfer and deletes the partial file. Anything already finished stays."
              >
                {download.state === "done" ? "Forget" : "Delete partial"}
              </button>
              <button
                type="button"
                onClick={onAbandonCancel}
                aria-label={`Keep ${download.repo}`}
                className={smallButton}
              >
                Keep
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onAskCancel}
              disabled={busy}
              aria-label={`${download.state === "done" ? "Forget" : "Cancel"} ${download.repo}`}
              className={smallButton}
            >
              {download.state === "done" ? "Forget" : "Cancel"}
            </button>
          )}
        </div>
      </div>

      {/* Named, and indeterminate while the size is not known yet: it
          used to be an unnamed bar that said 0% for a transfer that had
          no total to be a percentage of. */}
      {(active || download.state === "paused") && (
        <div
          className="h-1 overflow-hidden rounded-full bg-[color:var(--panel-hover)]"
          role="progressbar"
          aria-label={`Downloading ${download.repo}`}
          aria-valuenow={total > 0 ? Math.round(percent) : undefined}
          aria-valuetext={total > 0 ? undefined : `${formatBytes(got)} so far, size not known yet`}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          {total > 0 ? (
            <div
              className="h-full rounded-full bg-[color:var(--accent-left)] transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          ) : (
            <div className="h-full w-full animate-pulse rounded-full bg-[color:var(--accent-left)] opacity-40" />
          )}
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
        <p className="text-status-error text-[0.6875rem]" role="alert">
          {download.error}
          {download.errorCode === "GatedRepo" && (
            <>
              {" "}
              Accept the licence on the model&rsquo;s own page, then give this hub a token under{" "}
              {/* The Library's own settings, opened on the sources field (LS4). */}
              <Link href="/config?sel=library#catalogueSources" className="underline">
                Where to find models
              </Link>{" "}
              in Settings.
            </>
          )}
        </p>
      )}

      {!download.error && download.message && download.state !== "done" && (
        <p className="text-[0.6875rem] text-[color:var(--muted)]">{download.message}</p>
      )}

      {download.state === "done" && (
        <DownloadNextStep download={download} node={node} nodes={nodes} onChanged={onChanged} />
      )}
    </div>
  );
}

/**
 * Run, on a finished download. The library entry is read once by the id
 * the download record carries; a read that fails leaves the link to the
 * Library, which is where the same button lives.
 */
export function FinishedRun({ modelId, node }: { modelId: string; node: TargetNode }) {
  const [model, setModel] = useState<LibraryModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { engines, error: enginesError } = useNodeEngines(node.target);
  const [verdicts, setVerdicts] = useState<EngineVerdict[] | null>(null);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setModel(null);
    setError(null);
    void (async () => {
      try {
        const entry = await api.get<LibraryModel>(
          "library",
          `/v1/models/${encodeURIComponent(modelId)}`,
        );
        if (!cancelled) setModel(entry);
      } catch (err) {
        if (!cancelled) setError(describeError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modelId, attempt]);

  // The Library's own question, as its page asks it (LS9): which engine
  // suits this machine, and does preparing first beat running as it is.
  // When the judge cannot be asked, Run stays as it was and nothing is said.
  const fitKey = JSON.stringify(fitQuestion(node.budget));
  useEffect(() => {
    setVerdicts(null);
    setAsked(false);
    if (engines === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const judged = await judge(postEligibility, {
          models: [modelId],
          engines: eligibilityEngines(engines),
          fit: JSON.parse(fitKey) as FitQuestion,
        });
        const answer = judged.models.find((m) => m.modelId === modelId);
        if (!cancelled && answer) setVerdicts(answer.engines);
      } catch {
        // Not asked is not answered: keep Run.
      } finally {
        if (!cancelled) setAsked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [engines, modelId, fitKey]);

  // Run waits for the answer, so it never turns into a link under the
  // pointer; an engine list or judge that fails leaves Run as it was.
  if (error)
    return (
      <div role="alert" className="text-status-error text-sm">
        Could not load this model: {error}{" "}
        <button type="button" className={smallButton} onClick={() => setAttempt((a) => a + 1)}>
          Try again
        </button>
      </div>
    );
  if (!model || (engines !== null && !asked) || (engines === null && !enginesError)) {
    return (
      <p role="status" className="text-sm text-[color:var(--muted)]">
        Checking how to run on {node.label}…
      </p>
    );
  }
  const route = betterAfterPreparing(verdicts);
  if (route) {
    return (
      <Link
        href={modelLibraryHref(modelId, node)}
        className="min-w-0 flex-1 self-center underline"
        data-testid="download-run-from-page"
      >
        Run from its page: {engineName(route.prepare.engine)} suits this machine better after
        preparing
      </Link>
    );
  }
  return (
    <RunButton
      model={model}
      node={node}
      label={node.local ? "Run" : `Run on ${node.label}`}
      disabledReason={!node.reachable ? (node.lastError ?? "This machine is unavailable.") : null}
      className="min-w-0 flex-1"
    />
  );
}

/** Visible both beside the selected model and in Downloads. */
export function DownloadNextStep({
  download,
  node,
  nodes,
  onChanged,
}: {
  download: Download;
  node: TargetNode | null;
  nodes: readonly TargetNode[];
  onChanged: () => void;
}) {
  const [destination, setDestination] = useState<TargetNode | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    setDestination(downloadTarget(download.id, nodes.length ? nodes : node ? [node] : [], node));
  }, [download.id, node, nodes]);
  useEffect(() => {
    if (scan?.state !== "scanning") return;
    let cancelled = false;
    const id = setInterval(() => {
      void api
        .get<Scan>("library", "/v1/scan")
        .then((next) => {
          if (cancelled) return;
          setScan(next);
          if (next.state !== "scanning") onChanged();
        })
        .catch((err) => {
          if (!cancelled) {
            setError(describeError(err));
            setScan(null);
          }
        });
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [scan?.state, onChanged]);
  async function rescan() {
    setStarting(true);
    setError(null);
    try {
      const next = await api.post<Scan>("library", "/v1/scan", { full: false });
      setScan(next);
      onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setStarting(false);
    }
  }
  if (download.state !== "done") return <DownloadProgress download={download} />;
  return (
    <div className="space-y-2 text-sm" data-testid="download-next-step">
      {download.modelId ? (
        <>
          <p className="text-status-success">
            Downloaded{destination ? ` · Run on ${destination.label}` : ""}
          </p>
          {destination && <FinishedRun modelId={download.modelId} node={destination} />}
          {destination && !destination.reachable && (
            <p role="alert">{destination.lastError}</p>
          )}{" "}
          <Link
            href={modelLibraryHref(download.modelId, destination)}
            className="inline-block underline"
            data-testid="download-open-library"
          >
            Open in the Library
          </Link>
        </>
      ) : (
        <>
          <p>
            {download.message && download.message !== "complete"
              ? download.message
              : "Downloaded. Adding to your Library; if this does not finish, scan again."}
          </p>
          <button
            type="button"
            className={smallButton}
            disabled={starting || scan?.state === "scanning"}
            onClick={() => void rescan()}
          >
            {starting || scan?.state === "scanning" ? "Scanning Library…" : "Scan Library again"}
          </button>{" "}
          <Link href="/library" className="underline">
            Open the Library
          </Link>
          {scan?.state === "failed" && (
            <p role="alert" className="text-status-error">
              {scan.error ?? "The Library scan failed."}
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-status-error">
          {error}
        </p>
      )}
    </div>
  );
}

const smallButton =
  "action-button action-button--compact font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-0.5 text-[0.6875rem] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";

/**
 * Poll downloads while any is active. Shared by the discovery page and
 * the library page, so a transfer started on one is visible on the other
 * — a download outlives the screen it was started from.
 */
export function useDownloads(): {
  downloads: Download[];
  /** Resolves once the list has been read again, so a caller can wait
   * for a download it just started to be on it. */
  reload: () => Promise<void>;
  active: number;
} {
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
  // Older Libraries may mark a transfer done before their scan supplies modelId.
  // Follow that handoff briefly as well; a permanent scan problem has a retry.
  const [handoffPolls, setHandoffPolls] = useState(0);
  const waiting = downloads.some((d) => d.state === "done" && !d.modelId);

  useEffect(() => {
    if (active === 0 && (!waiting || handoffPolls >= 30)) return;
    const id = setInterval(() => {
      if (active === 0) setHandoffPolls((n) => n + 1);
      else setHandoffPolls(0);
      void reload();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [active, waiting, handoffPolls, reload]);

  return { downloads, reload, active };
}
