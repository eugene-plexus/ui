"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { DownloadsPanel, useDownloads } from "@/components/DownloadsPanel";
import { FitBadge, formatBytes, formatMemory } from "@/components/FitBadge";
import { ModelCard } from "@/components/ModelCard";
import { QuantReference } from "@/components/QuantReference";
import { ApiError, api, describeError } from "@/lib/api";
import { NodePicker } from "@/components/NodePicker";
import { StarterSetPanel } from "@/components/StarterSetPanel";
import { contextLabel } from "@/lib/starter";
import { relativeAge } from "@/lib/relativeTime";
import { type NodeBudget, fitQuery, useTargetNode } from "@/lib/nodeBudget";
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
  StarterModel,
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
 * **With nothing typed, this is not a search result.** It is the
 * starter set (§6.3): a handful of models, one per size class, with the
 * one this machine should take named and a Download button on it. The
 * screen used to open on "whatever the hub sorted to the top today",
 * which for a person with no candidate in mind is four hundred thousand
 * rows deep — and the starter panel answers with the hub down, because
 * nothing behind it is an upstream call.
 *
 * **A pasted link is a lookup, not a query.** The commonest way someone
 * arrives with a model in mind is that a friend sent them a URL, and
 * putting that URL through a full-text index returns nothing. The
 * library parses it and hands back one repo, which this screen selects
 * outright rather than making them click the only row.
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

/** Format, sort and the scoring context survive a reload, per browser.
 * The person who always scores at 32k was being reset to 8k every
 * visit, and the number silently decides every verdict on the screen. */
const PREFS_KEY = "eugene-discover-prefs";

interface DiscoverPrefs {
  contextLength?: number;
  format?: ModelFormat | "";
  sort?: CatalogueSort;
}

export default function DiscoverPage() {
  // `useSearchParams` suspends during prerender, so the boundary is
  // required rather than decorative — the library page's own pattern.
  return (
    <Suspense fallback={null}>
      <DiscoverPageInner />
    </Suspense>
  );
}

function DiscoverPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [format, setFormat] = useState<ModelFormat | "">("gguf");
  const [sort, setSort] = useState<CatalogueSort>("downloads");
  const [results, setResults] = useState<CatalogueSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // `?repo=` seeds the selection, so a reload keeps the repo open and a
  // link from anywhere else lands on the detail — the `?sel=` rule the
  // tree already follows, applied to this screen's own subject.
  const [selectedRepo, setSelectedRepo] = useState<string | null>(
    () => searchParams.get("repo") || null,
  );
  const [contextLength, setContextLength] = useState(8192);
  // What the library made of the query: `repo` means it parsed as a
  // pasted reference and `results` holds that one repo.
  const [interpreted, setInterpreted] = useState<"search" | "repo">("search");
  const [starterBusy, setStarterBusy] = useState<string | null>(null);
  // The starter card's own refusal, shown on the card that was pressed.
  // It went to the search results' error line, in the other column.
  const [starterError, setStarterError] = useState<string | null>(null);

  const [hardware, setHardware] = useState<HostHardware | null>(null);
  // Whose memory the verdicts are about: the chosen node's, defaulting
  // to this one. The library's own reading below is about the host the
  // library runs on, which on a multi-host install is a different
  // machine -- see `nodeBudget.ts`.
  const { nodes, selected, select, budget } = useTargetNode();
  const { downloads, reload: reloadDownloads, active } = useDownloads();
  // Files a transfer is writing right now, by their path in the repo.
  const inFlightFiles = useMemo(
    () =>
      new Set(
        downloads
          .filter((d) => !["done", "failed", "cancelled"].includes(d.state))
          .flatMap((d) => d.files.map((f) => f.path)),
      ),
    [downloads],
  );
  const [showDownloads, setShowDownloads] = useState(true);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  // Preferences restored after mount, the way the playground does it —
  // a lazy initializer reading localStorage would render differently
  // than the static export's prerender and React would warn.
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const prefs = JSON.parse(raw) as DiscoverPrefs;
        if (
          typeof prefs.contextLength === "number" &&
          CONTEXT_CHOICES.includes(prefs.contextLength)
        ) {
          setContextLength(prefs.contextLength);
        }
        if (prefs.format === "" || prefs.format === "gguf" || prefs.format === "safetensors") {
          setFormat(prefs.format);
        }
        if (typeof prefs.sort === "string" && prefs.sort in SORT_LABEL) setSort(prefs.sort);
      }
    } catch {
      // Private mode or a stale shape: the defaults stand.
    }
    setPrefsLoaded(true);
  }, []);

  useEffect(() => {
    if (!prefsLoaded) return;
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ contextLength, format, sort } satisfies DiscoverPrefs),
      );
    } catch {
      // The screen just does not remember.
    }
  }, [prefsLoaded, contextLength, format, sort]);

  // The URL mirrors the selection; state drives. `replace` rather than
  // `push` so paging through repos does not bury Back under every
  // click. The other params are preserved — `?sel=` is the tree's and
  // clobbering it would deselect the tree on every repo click — and
  // read off `window.location` rather than `useSearchParams`, whose
  // object in the dependency list would re-fire this effect on its own
  // replace.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if ((params.get("repo") || null) === selectedRepo) return;
    if (selectedRepo) params.set("repo", selectedRepo);
    else params.delete("repo");
    const qs = params.toString();
    router.replace(qs ? `/discover?${qs}` : "/discover", { scroll: false });
  }, [router, selectedRepo]);

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

  // **Only the newest search may answer.** Format and sort fire at once
  // and typing after the debounce, and the hub's latency varies, so an
  // earlier request could land last: the list then showed the old query's
  // results, the fade cleared while the newer one was still out, and a
  // stale pasted-link answer re-selected its repo over whatever had just
  // been clicked. RepoDetail already guarded this way; search did not.
  const searchSeq = useRef(0);
  const search = useCallback(async () => {
    const mine = ++searchSeq.current;
    const current = () => mine === searchSeq.current;
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
      if (!current()) return;
      setResults(page.results ?? []);
      setInterpreted(page.interpretedAs === "repo" ? "repo" : "search");
      // A pasted link named one repo. Selecting it is the whole point:
      // making someone click the only row is the click this removes.
      if (page.interpretedAs === "repo" && page.interpretedFrom) {
        setSelectedRepo(page.interpretedFrom);
      }
    } catch (err) {
      if (!current()) return;
      if (err instanceof ApiError && err.status === 401) return;
      setResults([]);
      setInterpreted("search");
      setSearchError(describeError(err));
    } finally {
      if (current()) setSearching(false);
    }
  }, [debouncedQuery, format, sort]);

  /** Fetch a starter entry's one recommended file. Same endpoint the
   * candidate table posts to; the starter set just already knows which
   * file, which is the choice it exists to make. */
  const downloadStarter = useCallback(
    async (model: StarterModel) => {
      setStarterBusy(model.repo);
      setStarterError(null);
      try {
        await api.post("library", "/v1/downloads", {
          repo: model.repo,
          revision: "main",
          files: [model.file],
        });
        setShowDownloads(true);
        // Waited for, so the button stays busy until the list carries the
        // transfer and the card can say it is downloading: clearing busy
        // first left "Download 9.1 GB" pressable, and a second press met
        // the library's "another download is already writing" 409.
        await reloadDownloads();
      } catch (err) {
        setStarterError(describeError(err));
      } finally {
        setStarterBusy(null);
      }
    },
    [reloadDownloads],
  );

  useEffect(() => {
    void search();
  }, [search]);

  return (
    <AppShell
      controls={
        <>
          <NodePicker nodes={nodes} selected={selected} onSelect={select} />
          <HardwareSummary budget={budget} hardware={hardware} />
        </>
      }
    >
      <main className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--border)] bg-[color:var(--panel-soft)] px-4 py-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="search models, or paste a link to one"
            className="font-ui min-w-[220px] flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--border-hover)]"
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
            interpreted={interpreted}
            selected={selectedRepo}
            onSelect={setSelectedRepo}
          />

          <div className="min-h-0 overflow-y-auto px-5 py-4">
            <ContextControl value={contextLength} onChange={setContextLength} />
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
              <EmptyDetail
                budget={budget}
                hardware={hardware}
                contextLength={contextLength}
                busy={starterBusy}
                inFlight={inFlightFiles}
                error={starterError}
                onDownload={downloadStarter}
                onOpenRepo={setSelectedRepo}
              />
            )}
          </div>
        </div>

        <section className="border-t border-[color:var(--border)] bg-[color:var(--panel)]">
          <button
            type="button"
            onClick={() => setShowDownloads((v) => !v)}
            className="font-ui flex w-full items-center justify-between px-4 py-2 text-sm"
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
                node={selected}
                emptyHint={
                  <>
                    Nothing downloading. Files land in the first of your configured model
                    directories, under their own upstream names — nothing is renamed or hidden in a
                    cache.
                  </>
                }
              />
            </div>
          )}
        </section>
      </main>
    </AppShell>
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
        className="font-ui text-sm text-[color:var(--muted)]"
        title={`Scored against ${where}, the machine a launch from this browser runs on. Verdicts use free memory, not total.${measured}`}
      >
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
      className="font-ui text-sm text-[color:var(--muted)]"
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

/**
 * The context every verdict on this screen is scored at, beside the
 * verdicts rather than in the window's title bar.
 *
 * §0's measurement: the badge read a bare `fits` and the number that
 * decided it was in a tooltip on a control at the other end of the page,
 * so the verdict looked like a fact about the model. Watching the
 * recommendation walk down the list as this changes *is* the guidance.
 */
function ContextControl({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <label className="font-ui mb-3 flex items-center gap-1.5 text-sm text-[color:var(--muted)]">
      <span>Scored for</span>
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className={selectClass}
        aria-label="Context length to score against"
      >
        {CONTEXT_CHOICES.map((choice) => (
          <option key={choice} value={choice}>
            {contextLabel(choice)}
          </option>
        ))}
      </select>
      <span title="How much conversation the model can hold at once. It costs memory: the cache grows in step with it, so this is the number that decides which version fits.">
        of conversation
      </span>
    </label>
  );
}

function ResultsList({
  results,
  searching,
  error,
  interpreted,
  selected,
  onSelect,
}: {
  results: CatalogueSearchResult[] | null;
  searching: boolean;
  error: string | null;
  interpreted: "search" | "repo";
  selected: string | null;
  onSelect: (repo: string) => void;
}) {
  return (
    <div className="min-h-0 overflow-y-auto border-r border-[color:var(--border)]">
      {interpreted === "repo" && (
        <p
          data-testid="resolved-link"
          className="border-b border-[color:var(--border)] px-4 py-2 text-[0.6875rem] text-[color:var(--muted)]"
        >
          That link points at one model, and this is it.
        </p>
      )}
      {error && (
        <p
          className="status-error m-3 rounded-[var(--radius)] border px-3 py-2 text-sm"
          role="alert"
        >
          {error}
        </p>
      )}
      {results === null && !error && (
        <p className="px-4 py-3 text-sm text-[color:var(--muted)]">searching…</p>
      )}
      {results?.length === 0 && !error && (
        <p className="px-4 py-3 text-sm text-[color:var(--muted)]">
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
              aria-current={selected === result.repo ? "true" : undefined}
              className={`w-full border-b border-[color:var(--border)] px-4 py-2.5 text-left transition-colors hover:bg-[color:var(--panel-hover)] ${
                selected === result.repo ? "bg-[color:var(--panel-soft)]" : ""
              }`}
            >
              <p className="font-ui truncate text-sm font-semibold" title={result.repo}>
                {result.name ?? result.repo}
              </p>
              <p className="truncate text-[0.6875rem] text-[color:var(--muted)]">
                {result.owner}
                {result.gated && result.gated !== "open" && (
                  <span className="text-status-warn"> · gated</span>
                )}
              </p>
              <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.6875rem] text-[color:var(--muted)] tabular-nums">
                {result.downloads != null && (
                  <span>{compactCount(result.downloads)} downloads</span>
                )}
                {result.likes != null && <span>{compactCount(result.likes)} likes</span>}
                {/* "recently updated" was an order with no dates on it. */}
                {relativeAge(result.lastModified) && (
                  <span data-testid="result-age">updated {relativeAge(result.lastModified)}</span>
                )}
                {(result.formats ?? []).map((f) => (
                  <span key={f} className="font-mono-ui uppercase">
                    {f === "safetensors" ? "ST" : f}
                  </span>
                ))}
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
  contextLength,
  busy,
  inFlight,
  error,
  onDownload,
  onOpenRepo,
}: {
  budget: NodeBudget | null;
  hardware: HostHardware | null;
  contextLength: number;
  busy: string | null;
  inFlight: Set<string>;
  error: string | null;
  onDownload: (model: StarterModel) => void;
  onOpenRepo: (repo: string) => void;
}) {
  const where = budget?.node ?? "this host";
  return (
    <div className="max-w-4xl space-y-4 text-sm text-[color:var(--muted)]">
      <StarterSetPanel
        budget={budget}
        contextLength={contextLength}
        busy={busy}
        inFlight={inFlight}
        error={error}
        onDownload={onDownload}
        onOpenRepo={onOpenRepo}
      />
      <p>Or pick a model on the left to see what it ships and which version fits here.</p>
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
        precisions. This screen groups the files into models you can launch and checks which ones
        fit. Vision projectors, calibration files, and draft models are listed separately.
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
  // Whether the vision part rides along. On by default: a person who
  // downloads a multimodal model without it gets a model that cannot
  // see, and discovers that days later in a chat. The box below the
  // button is where turning it off lives, visibly.
  const [withVision, setWithVision] = useState(true);
  const [preflights, setPreflights] = useState<Record<string, CataloguePreflight>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    // A preflighted verdict was computed at the context and budget that
    // were current when it was taken, and the response carries no shape
    // to re-score from — so once either changes it is a verdict about a
    // question nobody is asking any more, sitting in the row that wins
    // over the fresh one. Dropped rather than silently re-taken:
    // preflight spends someone else's bandwidth per call and is
    // explicit by design, so the row falls back to the (context-scaled)
    // estimate and the button is there to take it again.
    setPreflights({});
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
        setError(describeError(err));
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
      setActionError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  async function download(candidate: CatalogueCandidate) {
    setBusy(candidate.label);
    setActionError(null);
    try {
      const files = candidate.files.map((file) => file.path);
      // The vision part rides in the same download, into the same
      // directory — which is what pairs it: the scan finds a projector
      // beside its model and the launch line picks it up unaided.
      if (withVision && projector) files.push(projector);
      await api.post("library", "/v1/downloads", {
        repo,
        revision: detail?.resolvedCommit ?? detail?.revision ?? "main",
        files,
      });
      onDownloadStarted();
    } catch (err) {
      setActionError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <p className="status-error rounded-[var(--radius)] border px-3 py-2 text-sm" role="alert">
        {error}
      </p>
    );
  }
  if (!detail) {
    return <p className="text-sm text-[color:var(--muted)]">loading {repo}…</p>;
  }

  const activeDestinations = new Set(
    downloads
      .filter((d) => !["done", "failed", "cancelled"].includes(d.state))
      .flatMap((d) => d.files.map((f) => f.path)),
  );

  const recommendedCandidate =
    detail.candidates.find((c) => c.label === detail.recommended?.label) ?? null;
  const recommendedPreflight = recommendedCandidate
    ? preflights[recommendedCandidate.label]
    : undefined;
  const recommendedDownloading =
    recommendedCandidate?.files.some((f) => activeDestinations.has(f.path)) ?? false;

  const projectors = detail.projectors ?? [];
  const projectorFile = projectors.find((p) => p.path === projector) ?? null;

  // The library's multimodal warning is API prose — it says "listed
  // under `projectors`", a field name — and the vision box below now
  // says the same thing in people words with the control attached. The
  // other warnings (gated, licence) still render as sentences.
  const warnings = (detail.warnings ?? []).filter((w) => !w.includes("listed under `projectors`"));

  /** What the Download button fetches, said on the button. */
  const downloadLabel = (candidate: CatalogueCandidate) =>
    withVision && projectorFile
      ? `Download ${formatBytes(candidate.sizeBytes)} + ${formatBytes(projectorFile.sizeBytes)} vision`
      : `Download ${formatBytes(candidate.sizeBytes)}`;

  return (
    <div className={`max-w-4xl space-y-4 ${loading ? "opacity-60 transition-opacity" : ""}`}>
      <div>
        <h2 className="font-ui text-base font-semibold">{detail.name ?? detail.repo}</h2>
        <p className="text-sm text-[color:var(--muted)]">
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
          {projectors.length > 0 && (
            <>
              {" "}
              ·{" "}
              <span
                data-testid="takes-images"
                className="text-status-success"
                title="A vision part ships in this repository. Downloaded beside the model, it is found and used automatically when the model launches."
              >
                takes images
              </span>
            </>
          )}
          {detail.resolvedCommit && (
            <>
              {" "}
              ·{" "}
              <span title="Downloads fetch exactly this revision. A file the publisher replaces upstream mid-download is detected and refetched, never spliced into your copy.">
                pinned at {detail.resolvedCommit.slice(0, 7)}
              </span>
            </>
          )}
        </p>
      </div>

      {warnings.map((warning) => (
        <p key={warning} className="status-warn rounded-[var(--radius)] border px-3 py-2 text-sm">
          {warning}
        </p>
      ))}

      {detail.chatTemplate === false && (
        <div
          data-testid="no-chat-template"
          className="status-warn rounded-[var(--radius)] border px-3 py-2 text-sm"
        >
          <p className="font-semibold">No chat template</p>
          <p className="mt-0.5">
            This looks like a base model: it continues text rather than holding a conversation. Chat
            apps will get odd answers from it. Fine if raw completion is what you want.
          </p>
        </div>
      )}

      {/* The recommendation is a card with its own button, above the
          table, rather than a highlighted row inside it. §0.5: the wall
          a new person hits here is eleven near-identical rows, and a
          table cannot have a primary action. The table keeps every one
          of them under "All versions" for the expert. */}
      {recommendedCandidate && detail.recommended && (
        <section
          data-testid="repo-recommended"
          className="status-success rounded-[var(--radius)] border px-4 py-3 text-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-ui text-sm font-semibold">
              Suggested version: {detail.recommended.label}
            </p>
            {/* A preflighted verdict wins here exactly as it does in the
                table: the card is the golden path, so it must not keep
                quoting the estimate after the real arithmetic arrived. */}
            {(recommendedPreflight?.fit ?? recommendedCandidate.fit) && (
              <FitBadge
                fit={(recommendedPreflight?.fit ?? recommendedCandidate.fit)!}
                compact
                withContext
              />
            )}
          </div>
          <p className="mt-1">{detail.recommended.reason}</p>
          {detail.recommended.lowQualityWarning && (
            <p className="mt-1 font-semibold">{detail.recommended.lowQualityWarning}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => download(recommendedCandidate)}
              disabled={
                busy !== null || !!recommendedCandidate.alreadyOwned || recommendedDownloading
              }
              className="font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1.5 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="repo-recommended-download"
            >
              {recommendedCandidate.alreadyOwned
                ? "Already on disk"
                : recommendedDownloading
                  ? "downloading"
                  : busy === recommendedCandidate.label
                    ? "starting…"
                    : downloadLabel(recommendedCandidate)}
            </button>
            <button
              type="button"
              onClick={() => void preflight(recommendedCandidate)}
              disabled={busy !== null || !!recommendedPreflight}
              className={smallButton}
              data-testid="repo-recommended-check"
              title="Reads this file's own metadata over the network — about 11 MB of a multi-gigabyte file — so the verdict above is computed from the model's real shape instead of estimated from its size."
            >
              {recommendedPreflight
                ? "exact fit checked"
                : busy === recommendedCandidate.label
                  ? "checking…"
                  : "check exact fit"}
            </button>
          </div>
        </section>
      )}

      {projectors.length > 0 && (
        <VisionPairing
          projectors={projectors}
          chosen={projector}
          onChoose={setProjector}
          enabled={withVision}
          onEnabled={setWithVision}
        />
      )}

      {actionError && (
        <p className="status-error rounded-[var(--radius)] border px-3 py-2 text-sm" role="alert">
          {actionError}
        </p>
      )}

      <h3 className="font-ui text-sm font-semibold" data-testid="all-versions">
        All versions
      </h3>

      {detail.candidates.length === 0 ? (
        <p
          data-testid="no-candidates"
          className="rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2 text-sm text-[color:var(--muted)]"
        >
          Nothing in this repository can be launched as a model. It may hold only documentation or
          files in a format this install does not serve — the other files are listed below.
        </p>
      ) : (
        <CandidateTable
          candidates={detail.candidates}
          contextLength={contextLength}
          recommended={detail.recommended?.label ?? null}
          preflights={preflights}
          busy={busy}
          downloadTitle={
            withVision && projectorFile
              ? `The chosen vision part (${formatBytes(projectorFile.sizeBytes)}) is fetched with it`
              : undefined
          }
          activeDestinations={activeDestinations}
          onPreflight={preflight}
          onDownload={download}
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
  contextLength,
  recommended,
  preflights,
  busy,
  downloadTitle,
  activeDestinations,
  onPreflight,
  onDownload,
}: {
  candidates: CatalogueCandidate[];
  contextLength: number;
  recommended: string | null;
  preflights: Record<string, CataloguePreflight>;
  busy: string | null;
  /** Set when the vision part rides along, so every download button in
   * the table says so on hover. */
  downloadTitle?: string;
  activeDestinations: Set<string>;
  onPreflight: (candidate: CatalogueCandidate) => void;
  onDownload: (candidate: CatalogueCandidate) => void;
}) {
  // Largest first: the operator is usually looking for the best thing
  // that fits, and the recommendation is near the top of that order.
  const ordered = useMemo(
    () => [...candidates].sort((a, b) => b.sizeBytes - a.sizeBytes),
    [candidates],
  );

  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-[color:var(--border)]">
      <table className="w-full text-sm">
        <thead className="font-ui bg-[color:var(--panel-soft)] text-[0.6875rem] text-[color:var(--muted)]">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium">version</th>
            <th className="px-3 py-1.5 text-right font-medium">size</th>
            <th
              className="px-3 py-1.5 text-right font-medium"
              title="Measured: file size × 8 ÷ parameter count. The one number that makes different naming schemes comparable."
            >
              bits/weight
            </th>
            <th className="px-3 py-1.5 text-left font-medium">
              fits at {contextLabel(contextLength)}?
            </th>
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
                    <span className="text-status-success ml-2 text-[0.625rem] uppercase">
                      recommended
                    </span>
                  )}
                  {candidate.files.length > 1 && (
                    <span
                      className="ml-2 text-[0.625rem] text-[color:var(--muted)]"
                      title="A split model. Every shard is fetched; the size shown is the whole set."
                    >
                      {candidate.files.length} files
                    </span>
                  )}
                  {candidate.alreadyOwned && (
                    <p
                      className="text-status-success mt-0.5 text-[0.6875rem]"
                      title={candidate.alreadyOwned.path}
                    >
                      already on disk
                      {candidate.alreadyOwned.matchedOn === "name_and_size" && (
                        <span className="text-[color:var(--muted)]"> (by name and size)</span>
                      )}
                    </p>
                  )}
                  {preflighted?.agreesWithFilename === false && (
                    <p className="text-status-warn mt-0.5 text-[0.6875rem]">
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
                    onClick={() => onDownload(candidate)}
                    disabled={busy !== null || downloading}
                    className={`${smallButton} ml-1`}
                    title={downloadTitle}
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

/**
 * The vision half of a multimodal download, as a control.
 *
 * The library used to say this as a warning — API prose naming a field
 * — while every download silently included a projector. Now the fact
 * and the choice sit together: a checkbox, on by default, and the size
 * it adds is on the Download button itself. Downloading it beside the
 * model IS the pairing: the scan finds a projector next to its model
 * and the launch line uses it with nothing else configured.
 */
function VisionPairing({
  projectors,
  chosen,
  onChoose,
  enabled,
  onEnabled,
}: {
  projectors: CatalogueFile[];
  chosen: string | null;
  onChoose: (path: string) => void;
  enabled: boolean;
  onEnabled: (value: boolean) => void;
}) {
  return (
    <div
      data-testid="vision-pairing"
      className="rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2 text-sm"
    >
      <label className="font-ui flex items-center gap-2 font-semibold">
        <input
          type="checkbox"
          data-testid="vision-checkbox"
          checked={enabled}
          onChange={(event) => onEnabled(event.target.checked)}
        />
        Also get the part that lets it see images
      </label>
      <p className="mt-0.5 text-[color:var(--muted)]">
        This model takes images, and the vision part ships as its own file. It downloads beside
        whichever version you pick and is used automatically when the model launches. Without it the
        model runs, and is text-only.
      </p>
      {projectors.length > 1 && enabled && (
        <div className="mt-2 space-y-1">
          <p className="text-[color:var(--muted)]">
            More than one precision is published. Bigger is sharper image understanding; either
            works.
          </p>
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
      )}
      {projectors.length === 1 && enabled && (
        <p className="font-mono-ui mt-1 text-[color:var(--muted)]">
          {projectors[0]?.path} · {formatBytes(projectors[0]?.sizeBytes)}
        </p>
      )}
    </div>
  );
}

function OtherFiles({ files }: { files: CatalogueFile[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[var(--radius)] border border-[color:var(--border)] text-sm">
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

const smallButton =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-0.5 text-[0.6875rem] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";

const selectClass =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-2 py-1 text-sm outline-none focus:border-[color:var(--border-hover)]";

function compactCount(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}k`;
  return String(value);
}
