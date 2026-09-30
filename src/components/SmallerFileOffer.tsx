"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ApiError, api, describeError } from "@/lib/api";
import { fitQuery, type TargetNode } from "@/lib/nodeBudget";
import {
  SMALLER_CAVEAT,
  UNKNOWN_ORIGIN,
  noneLine,
  offerLine,
  originOf,
  pickSmaller,
} from "@/lib/smallerFile";
import type {
  CacheType,
  CatalogueCandidate,
  CatalogueModel,
  Download,
  DownloadList,
  LibraryModel,
  ModelFit,
} from "@/lib/types";

type Check =
  | { kind: "checking" }
  /** The file already fits entirely at this context: nothing to offer. */
  | { kind: "fits" }
  | { kind: "unknown-origin" }
  | { kind: "none" }
  | { kind: "offer"; repo: string; revision: string | null; candidate: CatalogueCandidate }
  | { kind: "error"; message: string };

/**
 * After a build at Low: a smaller file of the same model, if one would fit
 * entirely on the card at the chosen context (A3d, moe-aware-fit §6).
 *
 * Three reads, each soft: the model's fit at this context on this node,
 * its download record (which names its repository), and that repository's
 * candidates scored against the same node. The download is the person's
 * press; the rebuild is another, once the file has landed.
 */
export function SmallerFileOffer({
  model,
  contextLength,
  cacheType,
  node,
}: {
  model: LibraryModel;
  contextLength: number;
  /** The chosen stop's cache precision, which sets the cache's size. */
  cacheType: CacheType;
  node: TargetNode;
}) {
  const [check, setCheck] = useState<Check>({ kind: "checking" });
  const [download, setDownload] = useState<Download | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const budget = node.budget;
  const { id: modelId, sizeBytes } = model;

  useEffect(() => {
    let cancelled = false;
    setCheck({ kind: "checking" });
    // The slider moves in steps; ask once it has settled, not per step.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          // At the chosen context AND cache type: a 4-bit cache at 64k is
          // 1.7 GiB of this model where full precision is 6.0.
          const scored = new URLSearchParams({
            contextLength: String(contextLength),
            kvCacheType: cacheType,
            ...fitQuery(budget),
          });
          const fit = await api.get<ModelFit>(
            "library",
            `/v1/models/${encodeURIComponent(modelId)}/fit?${scored}`,
          );
          if (cancelled) return;
          if (fit.fit.verdict === "fits") return setCheck({ kind: "fits" });
          const list = await api.get<DownloadList>("library", "/v1/downloads");
          if (cancelled) return;
          const origin = originOf(list.downloads ?? [], modelId);
          if (!origin) return setCheck({ kind: "unknown-origin" });
          // Only the repository's sizes are wanted: the arithmetic is this
          // file's own (see `roomForWeights`).
          const query = new URLSearchParams({ repo: origin.repo });
          if (origin.revision) query.set("revision", origin.revision);
          const detail = await api.get<CatalogueModel>("library", `/v1/catalogue/model?${query}`);
          if (cancelled) return;
          const candidate = pickSmaller(detail.candidates ?? [], fit.fit, sizeBytes ?? 0);
          setCheck(
            candidate
              ? { kind: "offer", repo: origin.repo, revision: origin.revision, candidate }
              : { kind: "none" },
          );
        } catch (e) {
          if (cancelled || (e instanceof ApiError && e.status === 401)) return;
          setCheck({ kind: "error", message: describeError(e) });
        }
      })();
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [modelId, sizeBytes, contextLength, cacheType, budget]);

  // A download in flight is followed until it lands and names its model.
  const downloadId = download?.id;
  const landed = download?.state === "done" && download.modelId;
  useEffect(() => {
    if (!downloadId || landed) return;
    const timer = setInterval(() => {
      void api
        .get<Download>("library", `/v1/downloads/${encodeURIComponent(downloadId)}`)
        .then(setDownload)
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [downloadId, landed]);

  async function fetchIt(repo: string, revision: string | null, candidate: CatalogueCandidate) {
    setBusy(true);
    setError(null);
    try {
      const started = await api.post<Download>("library", "/v1/downloads", {
        repo,
        revision: revision ?? "main",
        files: candidate.files.map((f) => f.path),
      });
      setDownload(started);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  if (check.kind === "checking" || check.kind === "fits") return null;
  const box = "mt-2 rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2";
  if (check.kind === "error") {
    return (
      <p className={`${box} text-[color:var(--muted)]`} data-testid="smaller-file">
        Could not check for a smaller version: {check.message}
      </p>
    );
  }
  if (check.kind === "unknown-origin") {
    return (
      <p className={box} data-testid="smaller-file" data-state="unknown-origin">
        {UNKNOWN_ORIGIN}{" "}
        <Link href="/discover" className="underline">
          Discover
        </Link>
      </p>
    );
  }
  if (check.kind === "none") {
    return (
      <p
        className={`${box} text-[color:var(--muted)]`}
        data-testid="smaller-file"
        data-state="none"
      >
        {noneLine(contextLength)}
      </p>
    );
  }
  const { candidate, repo, revision } = check;
  const owned = candidate.alreadyOwned;
  return (
    <div className={box} data-testid="smaller-file" data-state="offer">
      <p>{offerLine(candidate, contextLength)}</p>
      <p className="text-[color:var(--muted)]">{SMALLER_CAVEAT}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {owned ? (
          <Link
            href={`/library?model=${encodeURIComponent(owned.modelId)}`}
            className="underline"
            data-testid="smaller-file-owned"
          >
            It is already on disk. Build settings for it
          </Link>
        ) : landed ? (
          <Link
            href={`/library?model=${encodeURIComponent(String(download.modelId))}`}
            className="underline"
            data-testid="smaller-file-build"
          >
            Downloaded. Build settings for it
          </Link>
        ) : download ? (
          <p role="status" data-testid="smaller-file-progress">
            {download.state === "failed"
              ? `The download failed: ${download.error ?? download.message ?? "no reason given"}`
              : `Downloading… ${Math.round(((download.bytesDownloaded ?? 0) / Math.max(1, download.bytesTotal ?? 1)) * 100)}%`}
          </p>
        ) : (
          <button
            type="button"
            className="action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5 text-sm disabled:opacity-40"
            disabled={busy}
            onClick={() => void fetchIt(repo, revision, candidate)}
            data-testid="smaller-file-download"
          >
            Download it
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
