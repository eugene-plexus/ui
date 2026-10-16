"use client";

import { useEffect } from "react";
import { DownloadNextStep, FinishedRun } from "./DownloadsPanel";
import { RunStatus } from "./RunButton";
import { rememberDownloadTarget } from "@/lib/downloadHandoff";
import type { TargetNode } from "@/lib/nodeBudget";
import { startDownloadAndRun, useRuns, type RunDownloadSpec } from "@/lib/oneClickRun";
import type { Download } from "@/lib/types";

/** One place to continue from the selected file, through downloading and launch.
 * The run operation owns the combined action even after this page is closed. */
export function ModelDownloadAction({
  spec,
  ownedModelId,
  downloads,
  node,
  nodes,
  busy,
  downloadLabel,
  onDownload,
  onChanged,
  testId,
  runnable = true,
}: {
  spec: RunDownloadSpec;
  ownedModelId?: string | null;
  downloads: readonly Download[];
  node: TargetNode | null;
  nodes: readonly TargetNode[];
  busy: boolean;
  downloadLabel: string;
  onDownload: () => void;
  onChanged: () => void;
  testId?: string;
  runnable?: boolean;
}) {
  const runs = useRuns();
  const download = downloads.find(
    (d) =>
      d.repo === spec.repo &&
      (!spec.source || d.source === spec.source) &&
      d.files.some((file) => file.path === spec.file) &&
      d.state !== "cancelled",
  );
  const run = runs.find(
    (r) =>
      r.downloadSpec?.repo === spec.repo &&
      (r.downloadSpec.source ?? null) === (spec.source ?? null) &&
      r.downloadSpec.files.includes(spec.file),
  );
  const runNode = run ? (nodes.find((n) => n.name === run.node.name) ?? null) : null;
  useEffect(() => {
    if (run?.download?.id && runNode) rememberDownloadTarget(run.download.id, runNode);
  }, [run?.download?.id, runNode]);
  if (run)
    return (
      <div className="min-w-0 text-left">
        <p className="text-sm">Run on {run.node.label}</p>
        <RunStatus
          task={run}
          onRetry={() => {
            if (runNode) startDownloadAndRun({ ...spec, ...run.downloadSpec }, runNode);
          }}
          retryDisabled={!runNode?.reachable}
        />
      </div>
    );
  if (download)
    return (
      <div className="min-w-0 text-left">
        <DownloadNextStep download={download} node={node} nodes={nodes} onChanged={onChanged} />
        {["failed", "paused"].includes(download.state) && (
          <a href="#downloads" className="text-sm underline">
            Resume or manage this download
          </a>
        )}
      </div>
    );
  if (ownedModelId && node) return <FinishedRun modelId={ownedModelId} node={node} />;
  return (
    <div className="flex flex-wrap items-center gap-2 text-left">
      {runnable && (
        <button
          type="button"
          disabled={busy || !node?.reachable}
          onClick={() => node && startDownloadAndRun(spec, node)}
          className="action-button action-button--primary font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1.5 text-sm font-semibold text-[color:var(--on-accent-left)] disabled:opacity-40"
        >
          Download and run{node && !node.local ? ` on ${node.label}` : ""}
        </button>
      )}
      <button
        type="button"
        onClick={onDownload}
        disabled={busy}
        data-testid={testId}
        className="action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5 text-sm disabled:opacity-40"
      >
        {busy ? "Starting download…" : downloadLabel.replace(/^download/i, "Download only")}
      </button>
    </div>
  );
}
