"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DownloadsPanel, useDownloads } from "@/components/DownloadsPanel";
import { FitBadge, formatBytes, formatMemory } from "@/components/FitBadge";
import { ModelCard } from "@/components/ModelCard";
import { QuantReference } from "@/components/QuantReference";
import { ApiError, api } from "@/lib/api";
import { type NodeBudget, fitQuery, useNodeBudget } from "@/lib/nodeBudget";
import type {
  CatalogueCandidate,
  CatalogueFile,
  CatalogueModel,
  CatalogueSearchPage,
  CatalogueSearchResult,
  CatalogueSort,
  CataloguePreflight,
  Download,
  HostHardware,
  ModelFormat,
} from "@/lib/types";

/**
 * Discovery — find a model, be told which version of it this machine can
 * run, and fetch it.
 *
 * **Guidance and discovery are one screen, deliberately.** The moment
 * someone is choosing between `Q3_K_S` and `Q2_K_M` is the moment they
 * need to be told which one their box can hold, so the candidate list
 * carries fit verdicts rather than linking to them. The context control
 * in the header is the other half of that: watching the recommendation
 * walk down the list as you drag context from 8k to 128k *is* the
 * guidance.
 *
 * Two calls, and the split is forced by upstream rather than chosen.
 * Search returns repos with filenames and no sizes, so a fit verdict per
 * search row would cost one extra call per row — fifty requests for one
 * keystroke against a budget of 500 per five minutes. Sizes, candidates
 * and guidance therefore live on the detail call, which is also why the
 * search box is debounced.
 */

// Long enough that ordinary typing produces one request, short enough
// that it doesn't feel laggy. The library caches upstream answers too;
// neither is a substitute for the other.
const SEARCH_DEBOUNCE_MS = 350;

// The context lengths worth offering. Powers of two an operator actually
// launches with, not a continuous slider — the interesting thing is the
// step where the recommendation changes.
const CONTEXT_CHOICES = [4096, 8192, 16384, 32768, 65536, 131072, 262144];

const SORT_LABEL: Record<CatalogueSort, string> = {
  downloads: "most downloaded",
  trending: "trending",
  likes: "most liked",
  modified: "recently updated",
  created: "newest",
};

export default function DiscoverPage() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [format, setFormat] = useState<ModelFormat | "">("gguf");
  const [sort, setSort] = useState<CatalogueSort>("downloads");
  const [results, setResults] = useState<CatalogueSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [contextLength, setContextLength] = useState(8192);

  const [hardware, setHardware] = useState<HostHardware | null>(null);
  // Whose memory the verdicts are about: this node's, because a launch
  // from this browser runs here. The library's own reading below is
  // about the host the library runs on, which on a multi-host install
  // is a different machine -- see `nodeBudget.ts`.
  const { budget } = useNodeBudget();
  const { downloads, reload: reloadDownloads, active } = useDownloads();
  const [showDownloads, setShowDownloads] = useState(true);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    void (async () => {
      try {
        setHardware(await api.get<HostHardware>("library", "/v1/hardware"));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return;
        // Fit verdicts will say "no GPU detected" on their own; a failed
        // hardware read is not worth a page-level error.
      }
    })();
  }, []);

  const search = useCallback(async () => {
    setSearching(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams({ sort, limit: "30" });
      if (debouncedQuery) params.set("q", debouncedQuery);
      if (format) params.set("format", format);
      const page = await api.get<CatalogueSearchPage>(
        "library",
        `/v1/catalogue/search?${params.toString()}`,
      );
      setResults(page.results ?? []);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setResults([]);
      setSearchError(errorText(err));
    } finally {
      setSearching(false);
    }
  }, [debouncedQuery, format, sort]);

  useEffect(() => {
    void search();
  }, [search]);

  return (
    <main className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3">
        <div className="flex items-center gap-4">
          <Link
            href="/library"
            className="font-ui text-xs text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
          >
            ← Library
          </Link>
          <h1 className="font-ui text-sm font-semibold tracking-wide">Discover</h1>
          <HardwareSummary budget={budget} hardware={hardware} />
        </div>
        <div className="flex items-center gap-3">
          <label className="font-ui flex items-center gap-1.5 text-xs text-[color:var(--muted)]">
            <span title="Fit verdicts are computed at this context length. The KV cache grows linearly with it, so this is the number that decides which version is recommended.">
              context
            </span>
            <select
              value={contextLength}
              onChange={(event) => setContextLength(Number(event.target.value))}
              className={selectClass}
            >
              {CONTEXT_CHOICES.map((value) => (
                <option key={value} value={value}>
                  {value >= 1024 ? `${value / 1024}k` : value}
                </option>
              ))}
            </select>
          </label>
          <Link href="/config" className={buttonClass}>
            Config
          </Link>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--border)] bg-[color:var(--panel-soft)] px-4 py-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="search models — try a family name, or a publisher"
          className="font-ui min-w-[220px] flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5 text-xs outline-none focus:border-[color:var(--border-hover)]"
          aria-label="Search the model catalogue"
        />
        <select
          value={format}
          onChange={(event) => setFormat(event.target.value as ModelFormat | "")}
          className={selectClass}
          aria-label="Model format"
        >
          <option value="gguf">GGUF</option>
          <option value="safetensors">safetensors</option>
          <option value="">any format</option>
        </select>
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as CatalogueSort)}
          className={selectClass}
          aria-label="Sort order"
        >
          {(Object.keys(SORT_LABEL) as CatalogueSort[]).map((value) => (
            <option key={value} value={value}>
              {SORT_LABEL[value]}
            </option>
          ))}
        </select>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,340px)_1fr] overflow-hidden">
        <ResultsList
          results={results}
          searching={searching}
          error={searchError}
          selected={selectedRepo}
          onSelect={setSelectedRepo}
        />

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          {selectedRepo ? (
            <RepoDetail
              key={selectedRepo}
              repo={selectedRepo}
              contextLength={contextLength}
              budget={budget}
              downloads={downloads}
              onDownloadStarted={() => {
                setShowDownloads(true);
                reloadDownloads();
              }}
            />
          ) : (
            <EmptyDetail budget={budget} hardware={hardware} />
          )}
        </div>
      </div>

      <section className="border-t border-[color:var(--border)] bg-[color:var(--panel)]">
        <button
          type="button"
          onClick={() => setShowDownloads((v) => !v)}
          className="font-ui flex w-full items-center justify-between px-4 py-2 text-xs"
          aria-expanded={showDownloads}
        >
          <span className="font-semibold">
            Downloads
            {downloads.length > 0 && (
              <span className="ml-2 font-normal text-[color:var(--muted)]">
                {active > 0 ? `${active} in flight` : `${downloads.length} recorded`}
              </span>
            )}
          </span>
          <span className="text-[color:var(--muted)]">{showDownloads ? "▾" : "▸"}</span>
        </button>
        {showDownloads && (
          <div className="max-h-[38vh] overflow-y-auto px-4 pb-3">
            <DownloadsPanel
              downloads={downloads}
              onChanged={reloadDownloads}
              emptyHint={
                <>
                  Nothing downloading. Files land in the first of your configured model directories,
                  under their own upstream names — nothing is renamed or hidden in a cache.
                </>
              }
            />
          </div>
        )}
      </section>
    </main>
  );
}

function HardwareSummary({
  budget,
  hardware,
}: {
  budget: NodeBudget | null;
  hardware: HostHardware | null;
}) {
  // The node's own reading wins, and the line names the node: "no GPU
  // detected" with no machine attached is how a worker with an RTX 5090
  // was told it had none -- the library had measured the NAS it runs on.
  if (budget) {
    const where = budget.node ?? "this host";
    const measured = hardware
      ? ` The library itself runs on ${hardware.hostname} and measures that host; that reading is not used here.`
      : "";
    return (
      <span
        className="font-ui text-xs text-[color:var(--muted)]"
        title={`Scored against ${where}, the machine a launch from this browser runs on. Verdicts use free memory, not total.${measured}`}
      >
        {where} ·{" "}
        {budget.gpu ? (
          <>
            {budget.gpu.name} · {formatMemory(budget.gpu.freeBytes)} free
            {budget.gpu.totalBytes != null && <> of {formatMemory(budget.gpu.totalBytes)}</>}
          </>
        ) : (
          <>
            no GPU · {budget.ramBytes != null ? formatMemory(budget.ramBytes) : "unknown"} host
            memory free
          </>
        )}
        {budget.gpuCount > 1 && <> · {budget.gpuCount} GPUs, largest card counts</>}
      </span>
    );
  }

  // No device list from this node's agent: fall back to what the library
  // measured, and say whose machine that is.
  if (!hardware) return null;
  const gpu = (hardware.gpus ?? [])[0];
  const free = gpu?.vramFreeBytes ?? gpu?.vramTotalBytes;
  return (
    <span
      className="font-ui text-xs text-[color:var(--muted)]"
      title={
        (hardware.warnings ?? []).join(" ") ||
        "Detected on the host the library runs on. Fit verdicts are measured against free memory, not total."
      }
    >
      {hardware.hostname} ·{" "}
      {gpu ? (
        <>
          {gpu.name} · {formatMemory(free)} free of {formatMemory(gpu.vramTotalBytes)}
        </>
      ) : (
        <>no GPU detected · {formatMemory(hardware.ramAvailableBytes)} host memory free</>
      )}
      {(hardware.gpus ?? []).length > 1 && <> · {(hardware.gpus ?? []).length} GPUs</>}
    </span>
  );
}

function ResultsList({
  results,
  searching,
  error,
  selected,
  onSelect,
}: {
  results: CatalogueSearchResult[] | null;
  searching: boolean;
  error: string | null;
  selected: string | null;
  onSelect: (repo: string) => void;
}) {
  return (
    <div className="min-h-0 overflow-y-auto border-r border-[color:var(--border)]">
      {error && (
        <p className="status-error m-3 rounded-[var(--radius)] border px-3 py-2 text-xs">{error}</p>
      )}
      {results === null && !error && (
        <p className="px-4 py-3 text-xs text-[color:var(--muted)]">searching…</p>
      )}
      {results?.length === 0 && !error && (
        <p className="px-4 py-3 text-xs text-[color:var(--muted)]">
          Nothing matched. The catalogue&rsquo;s own search is what it is — a publisher name often
          works better than a description.
        </p>
      )}
      <ul className={searching ? "opacity-60 transition-opacity" : undefined}>
        {(results ?? []).map((result) => (
          <li key={result.repo}>
            <button
              type="button"
              onClick={() => onSelect(result.repo)}
              className={`w-full border-b border-[color:var(--border)] px-4 py-2.5 text-left transition-colors hover:bg-[color:var(--panel-hover)] ${
                selected === result.repo ? "bg-[color:var(--panel-soft)]" : ""
              }`}
            >
              <p className="font-ui truncate text-xs font-semibold" title={result.repo}>
                {result.name ?? result.repo}
              </p>
              <p className="truncate text-[11px] text-[color:var(--muted)]">
                {result.owner}
                {result.gated && result.gated !== "open" && (
                  <span className="text-status-warn"> · gated</span>
                )}
              </p>
              <p className="mt-0.5 flex gap-3 text-[11px] text-[color:var(--muted)] tabular-nums">
                {result.downloads != null && (
                  <span>{compactCount(result.downloads)} downloads</span>
                )}
                {result.likes != null && <span>{compactCount(result.likes)} likes</span>}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyDetail({
  budget,
  hardware,
}: {
  budget: NodeBudget | null;
  hardware: HostHardware | null;
}) {
  const where = budget?.node ?? "this host";
  return (
    <div className="max-w-2xl space-y-4 text-xs text-[color:var(--muted)]">
      <p>Pick a model on the left to see what it actually ships and which version fits here.</p>
      {budget && !budget.gpu && (
        <div className="status-warn rounded-[var(--radius)] border px-3 py-2">
          <p className="mb-1 font-semibold">No GPU on {where}</p>
          <p>
            Verdicts are scored against host memory alone, because a model launched from this
            browser runs on this machine. If the GPU is on another node of this install, open
            Discover from that node&rsquo;s own address.
          </p>
        </div>
      )}
      {budget?.unifiedMemory && (
        <div className="status-warn rounded-[var(--radius)] border px-3 py-2">
          <p className="mb-1 font-semibold">Apple silicon: one memory pool</p>
          <p>
            Scored as {formatMemory(budget.vramBytes)} of GPU memory. There is nothing to offload
            to, so a &ldquo;partial offload&rdquo; verdict does not apply here.
          </p>
        </div>
      )}
      <p>
        One repository usually holds a dozen or more versions of the same model at different
        precisions. This screen groups them into the choices that can actually be launched — the
        vision projectors, calibration files and draft models that sit alongside them are listed
        separately — and scores each one against this machine.
      </p>
      <p>
        Downloads land in the first of your configured model directories, keeping their upstream
        filenames. Nothing is renamed, hashed, or moved into a cache: delete Eugene Plexus and every
        model is still where it was.
      </p>
      {/* The library's warnings are about the host the LIBRARY runs on.
          Shown only when its reading is the one in use -- otherwise a
          worker would read "nvidia-smi is not on PATH" about a NAS. */}
      {!budget && hardware && (hardware.warnings ?? []).length > 0 && (
        <div className="status-warn rounded-[var(--radius)] border px-3 py-2">
          <p className="mb-1 font-semibold">
            About the hardware readings, from {hardware.hostname}
          </p>
          <ul className="list-disc space-y-0.5 pl-4">
            {(hardware.warnings ?? []).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RepoDetail({
  repo,
  contextLength,
  budget,
  downloads,
  onDownloadStarted,
}: {
  repo: string;
  contextLength: number;
  budget: NodeBudget | null;
  downloads: Download[];
  onDownloadStarted: () => void;
}) {
  const [detail, setDetail] = useState<CatalogueModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [projector, setProjector] = useState<string | null>(null);
  const [preflights, setPreflights] = useState<Record<string, CataloguePreflight>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    void (async () => {
      try {
        // `fitQuery` points the library's arithmetic at this node's
        // memory. Without it every verdict is about the library's host.
        const params = new URLSearchParams({
          repo,
          contextLength: String(contextLength),
          ...fitQuery(budget),
        });
        const body = await api.get<CatalogueModel>(
          "library",
          `/v1/catalogue/model?${params.toString()}`,
        );
        // A slower earlier request must not overwrite a newer answer —
        // the context control can fire several of these in a row.
        if (id !== requestId.current) return;
        setDetail(body);
        setError(null);
        setProjector((current) => current ?? (body.projectors ?? [])[0]?.path ?? null);
      } catch (err) {
        if (id !== requestId.current) return;
        if (err instanceof ApiError && err.status === 401) return;
        setError(errorText(err));
        setDetail(null);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    })();
  }, [repo, contextLength, budget]);

  async function preflight(candidate: CatalogueCandidate) {
    const weights = candidate.files[0]?.path;
    if (!weights) return;
    setBusy(candidate.label);
    setActionError(null);
    try {
      const params = new URLSearchParams({
        repo,
        file: weights,
        contextLength: String(contextLength),
        ...fitQuery(budget),
      });
      const body = await api.get<CataloguePreflight>(
        "library",
        `/v1/catalogue/model/preflight?${params.toString()}`,
      );
      setPreflights((current) => ({ ...current, [candidate.label]: body }));
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function download(candidate: CatalogueCandidate, includeProjector: boolean) {
    setBusy(candidate.label);
    setActionError(null);
    try {
      const files = candidate.files.map((file) => file.path);
      if (includeProjector && projector) files.push(projector);
      await api.post("library", "/v1/downloads", {
        repo,
        revision: detail?.resolvedCommit ?? detail?.revision ?? "main",
        files,
      });
      onDownloadStarted();
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return <p className="status-error rounded-[var(--radius)] border px-3 py-2 text-xs">{error}</p>;
  }
  if (!detail) {
    return <p className="text-xs text-[color:var(--muted)]">loading {repo}…</p>;
  }

  const activeDestinations = new Set(
    downloads
      .filter((d) => !["done", "failed", "cancelled"].includes(d.state))
      .flatMap((d) => d.files.map((f) => f.path)),
  );

  return (
    <div className={`max-w-4xl space-y-4 ${loading ? "opacity-60 transition-opacity" : ""}`}>
      <div>
        <h2 className="font-ui text-base font-semibold">{detail.name ?? detail.repo}</h2>
        <p className="text-xs text-[color:var(--muted)]">
          {detail.owner}
          {detail.license && <> · {detail.license}</>}
          {detail.parameters != null && <> · {(detail.parameters / 1e9).toFixed(1)}B parameters</>}
          {detail.architecture && <> · {detail.architecture}</>}
          {detail.contextLength != null && (
            <>
              {" "}
              ·{" "}
              <span title="What the model was trained for. Not what this machine can serve — that is what the fit verdicts below answer.">
                trained for {detail.contextLength.toLocaleString()} tokens
              </span>
            </>
          )}
        </p>
      </div>

      {(detail.warnings ?? []).map((warning) => (
        <p key={warning} className="status-warn rounded-[var(--radius)] border px-3 py-2 text-xs">
          {warning}
        </p>
      ))}

      {detail.recommended && (
        <div className="status-success rounded-[var(--radius)] border px-3 py-2 text-xs">
          <p className="font-ui font-semibold">Recommended: {detail.recommended.label}</p>
          <p className="mt-0.5">{detail.recommended.reason}</p>
        </div>
      )}

      {actionError && (
        <p className="status-error rounded-[var(--radius)] border px-3 py-2 text-xs">
          {actionError}
        </p>
      )}

      <CandidateTable
        candidates={detail.candidates}
        recommended={detail.recommended?.label ?? null}
        preflights={preflights}
        busy={busy}
        hasProjectors={(detail.projectors ?? []).length > 0}
        activeDestinations={activeDestinations}
        onPreflight={preflight}
        onDownload={download}
      />

      {(detail.projectors ?? []).length > 0 && (
        <ProjectorPicker
          projectors={detail.projectors ?? []}
          chosen={projector}
          onChoose={setProjector}
        />
      )}

      {(detail.otherFiles ?? []).length > 0 && <OtherFiles files={detail.otherFiles ?? []} />}

      <QuantReference />

      <ModelCard repo={repo} />
    </div>
  );
}

function CandidateTable({
  candidates,
  recommended,
  preflights,
  busy,
  hasProjectors,
  activeDestinations,
  onPreflight,
  onDownload,
}: {
  candidates: CatalogueCandidate[];
  recommended: string | null;
  preflights: Record<string, CataloguePreflight>;
  busy: string | null;
  hasProjectors: boolean;
  activeDestinations: Set<string>;
  onPreflight: (candidate: CatalogueCandidate) => void;
  onDownload: (candidate: CatalogueCandidate, includeProjector: boolean) => void;
}) {
  // Largest first: the operator is usually looking for the best thing
  // that fits, and the recommendation is near the top of that order.
  const ordered = useMemo(
    () => [...candidates].sort((a, b) => b.sizeBytes - a.sizeBytes),
    [candidates],
  );

  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-[color:var(--border)]">
      <table className="w-full text-xs">
        <thead className="font-ui bg-[color:var(--panel-soft)] text-[11px] text-[color:var(--muted)]">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium">version</th>
            <th className="px-3 py-1.5 text-right font-medium">size</th>
            <th
              className="px-3 py-1.5 text-right font-medium"
              title="Measured: file size × 8 ÷ parameter count. The one number that makes different naming schemes comparable."
            >
              bits/weight
            </th>
            <th className="px-3 py-1.5 text-left font-medium">fits here?</th>
            <th className="px-3 py-1.5 text-right font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((candidate) => {
            const preflighted = preflights[candidate.label];
            const fit = preflighted?.fit ?? candidate.fit;
            const downloading = candidate.files.some((f) => activeDestinations.has(f.path));
            return (
              <tr key={candidate.label} className="border-t border-[color:var(--border)] align-top">
                <td className="px-3 py-2">
                  <span className="font-ui font-semibold">{candidate.label}</span>
                  {recommended === candidate.label && (
                    <span className="text-status-success ml-2 text-[10px] uppercase">
                      recommended
                    </span>
                  )}
                  {candidate.files.length > 1 && (
                    <span
                      className="ml-2 text-[10px] text-[color:var(--muted)]"
                      title="A split model. Every shard is fetched; the size shown is the whole set."
                    >
                      {candidate.files.length} files
                    </span>
                  )}
                  {candidate.alreadyOwned && (
                    <p
                      className="text-status-success mt-0.5 text-[11px]"
                      title={candidate.alreadyOwned.path}
                    >
                      already on disk
                      {candidate.alreadyOwned.matchedOn === "name_and_size" && (
                        <span className="text-[color:var(--muted)]"> (by name and size)</span>
                      )}
                    </p>
                  )}
                  {preflighted?.agreesWithFilename === false && (
                    <p className="text-status-warn mt-0.5 text-[11px]">
                      the file&rsquo;s own metadata says {preflighted.quantization}, which is not
                      what its name says
                    </p>
                  )}
                </td>
                <td className="font-mono-ui px-3 py-2 text-right tabular-nums">
                  {formatBytes(candidate.sizeBytes)}
                </td>
                <td className="font-mono-ui px-3 py-2 text-right text-[color:var(--muted)] tabular-nums">
                  {candidate.bitsPerWeight?.toFixed(2) ?? "—"}
                </td>
                <td className="px-3 py-2">{fit ? <FitBadge fit={fit} /> : "—"}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => onPreflight(candidate)}
                    disabled={busy !== null || !!preflighted}
                    className={smallButton}
                    title="Reads this file's own metadata over the network — about 11 MB of a multi-gigabyte file — so the fit is computed from the model's real shape instead of estimated from its size."
                  >
                    {preflighted ? "checked" : busy === candidate.label ? "checking…" : "check"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDownload(candidate, hasProjectors)}
                    disabled={busy !== null || downloading}
                    className={`${smallButton} ml-1`}
                  >
                    {downloading ? "downloading" : "download"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProjectorPicker({
  projectors,
  chosen,
  onChoose,
}: {
  projectors: CatalogueFile[];
  chosen: string | null;
  onChoose: (path: string) => void;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2 text-xs">
      <p className="font-ui font-semibold">Vision projector</p>
      <p className="mt-0.5 text-[color:var(--muted)]">
        This model can take images, and the part that does it ships separately. One of these is
        downloaded alongside whichever version you pick.
      </p>
      <div className="mt-2 space-y-1">
        {projectors.map((file) => (
          <label key={file.path} className="flex items-center gap-2">
            <input
              type="radio"
              name="projector"
              checked={chosen === file.path}
              onChange={() => onChoose(file.path)}
            />
            <span className="font-mono-ui">{file.path}</span>
            <span className="text-[color:var(--muted)] tabular-nums">
              {formatBytes(file.sizeBytes)}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function OtherFiles({ files }: { files: CatalogueFile[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[var(--radius)] border border-[color:var(--border)] text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="font-ui flex w-full items-center justify-between px-3 py-2"
        aria-expanded={open}
      >
        <span>
          <span className="font-semibold">{files.length} other file(s)</span>
          <span className="ml-2 text-[color:var(--muted)]">
            in this repository that are not launchable models
          </span>
        </span>
        <span className="text-[color:var(--muted)]">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="border-t border-[color:var(--border)] px-3 py-2">
          {/* Listed rather than hidden, for the same reason the scan
              reports what it skipped: a screen that silently drops files
              it did not understand is indistinguishable from a broken
              one. */}
          <p className="mb-1.5 text-[color:var(--muted)]">
            Calibration matrices, draft models for speculative decoding, and documentation. Nothing
            here is launched on its own.
          </p>
          <ul className="space-y-0.5">
            {files.map((file) => (
              <li key={file.path} className="flex justify-between gap-4">
                <span className="font-mono-ui truncate" title={file.path}>
                  {file.path}
                </span>
                <span className="shrink-0 text-[color:var(--muted)] tabular-nums">
                  {formatBytes(file.sizeBytes)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const buttonClass =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs text-[color:var(--foreground)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";

const smallButton =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-0.5 text-[11px] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";

const selectClass =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-2 py-1 text-xs outline-none focus:border-[color:var(--border-hover)]";

function compactCount(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}k`;
  return String(value);
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { detail?: { detail?: string; title?: string } } | undefined;
    return body?.detail?.detail ?? body?.detail?.title ?? err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
