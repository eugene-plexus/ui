"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { DownloadsPanel, useDownloads } from "@/components/DownloadsPanel";
import { EligibilityDot } from "@/components/EligibilityDot";
import { EngineFitBadge, FitBadge, formatBytes, formatMemory } from "@/components/FitBadge";
import { ModelCard } from "@/components/ModelCard";
import { QuantReference } from "@/components/QuantReference";
import { ApiError, api, describeError } from "@/lib/api";
import { NodePicker } from "@/components/NodePicker";
import { StarterSetPanel } from "@/components/StarterSetPanel";
import { contextLabel } from "@/lib/starter";
import { relativeAge } from "@/lib/relativeTime";
import {
  type NodeBudget,
  type TargetNode,
  fitQuery,
  fitQuestion,
  useTargetNode,
} from "@/lib/nodeBudget";
import { startDownloadAndPrepare, startPreparation } from "@/lib/oneClickRun";
import { PrepareControl } from "@/components/PrepareModel";
import {
  bestAnswer,
  eligibilityEngines,
  engineLists,
  hubFormatFor,
  LEVEL_RANK,
  levelEngine,
  runsHubModelsAsTheyAre,
  type EligibilityCandidate,
  type EligibilityLevel,
  type ModelEligibility,
} from "@/lib/eligibility";
import { engineName } from "@/lib/issues";
import { useCandidateEligibility, useNodeEngines } from "@/lib/useEligibility";
import type {
  CatalogueCandidate,
  CatalogueFile,
  CatalogueModel,
  CatalogueSearchPage,
  CatalogueSearchResult,
  CatalogueSort,
  CatalogueSourceStatus,
  CataloguePreflight,
  Download,
  EngineDescriptor,
  EngineModelList,
  HostHardware,
  StarterModel,
  SupportedModel,
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

/** The engine filter, sort and the scoring context survive a reload, per
 * browser. The person who always scores at 32k was being reset to 8k every
 * visit, and the number silently decides every verdict on the screen. */
const PREFS_KEY = "eugene-discover-prefs";

/**
 * Which models the list shows, by Troy's dot (L5, LS2). It replaced a
 * format filter that defaulted to GGUF for its own sake: what a person
 * wants to know is whether a model runs here, not what its files are
 * called. `""` is everything, ordered green, amber, red.
 */
type LevelFilter = "" | "works_here" | "other_engine";

const FILTER_LABEL: Record<LevelFilter, string> = {
  works_here: "Works here now",
  other_engine: "Works with another engine",
  "": "Everything",
};

/** What "approximate" means on a search row. */
const ROW_GUESS =
  "Judged from the hub's listing, not from this repo's files. Open it for each version's answer.";
/** And on a version, when a fact could not be read before download. */
const CANDIDATE_GUESS =
  "Something about this version could not be read before download; each reason says what was assumed.";

interface DiscoverPrefs {
  contextLength?: number;
  /** The filter the person chose. Not `level`: that one was written on every
   * visit, so it mostly holds the old default rather than a choice (LS4). */
  chosenLevel?: LevelFilter;
  sort?: CatalogueSort;
}

/**
 * What is open on the right (LS4): a repo, the hub it is on (`null` is the
 * Library's default hub), and for a row from an engine's list, which entry.
 */
interface Selection {
  repo: string;
  source: string | null;
  listed: { engine: string; id: string } | null;
}

function selectionOf(result: CatalogueSearchResult): Selection {
  return {
    repo: result.repo,
    source: result.hubSource ?? null,
    listed:
      result.engine && result.supported ? { engine: result.engine, id: result.supported.id } : null,
  };
}

function sameSelection(a: Selection | null, b: Selection | null): boolean {
  return (
    a !== null &&
    b !== null &&
    a.repo === b.repo &&
    a.source === b.source &&
    a.listed?.engine === b.listed?.engine &&
    a.listed?.id === b.listed?.id
  );
}

function selectionKey(s: Selection): string {
  return [s.source ?? "", s.listed ? `${s.listed.engine}:${s.listed.id}` : "", s.repo].join("|");
}

function rowKey(result: CatalogueSearchResult): string {
  return selectionKey({ ...selectionOf(result), source: result.source ?? null });
}

/** `?repo=` with `&source=` and `&listed=engine:id` when they say more. */
function selectionFromParams(params: URLSearchParams): Selection | null {
  const repo = params.get("repo");
  if (!repo) return null;
  const listed = params.get("listed");
  const [engine, id] = listed ? listed.split(":", 2) : [];
  return {
    repo,
    source: params.get("source") || null,
    listed: engine && id ? { engine, id } : null,
  };
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
  // The filter the person chose; until they choose, the default below.
  const [chosenLevel, setChosenLevel] = useState<LevelFilter | null>(null);
  const [sort, setSort] = useState<CatalogueSort>("downloads");
  const [results, setResults] = useState<CatalogueSearchResult[] | null>(null);
  // What each source answered (LS4); null from a Library older than that.
  const [statuses, setStatuses] = useState<CatalogueSourceStatus[] | null>(null);
  // A Library older than the sources list answers POST 405: search its hub.
  // A ref decides (flipping it must not search again); the state says so.
  const [searchOlder, setSearchOlder] = useState(false);
  const olderLibrary = useRef(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // `?repo=` seeds the selection, so a reload keeps the repo open and a
  // link from anywhere else lands on the detail — the `?sel=` rule the
  // tree already follows, applied to this screen's own subject.
  const [selection, setSelection] = useState<Selection | null>(() =>
    selectionFromParams(new URLSearchParams(searchParams.toString())),
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
  const { nodes, selected, select, budget, loaded: nodesLoaded } = useTargetNode();
  // Which engines the verdicts are about: the picked node's, as its own
  // agent reports them (LS2). The Library judges; this page only asks.
  const { engines, error: enginesError } = useNodeEngines(selected?.target ?? null);
  const where = selected?.label ?? "this machine";
  // Troy, 2026-10-09: open on *Works here now* when an engine here runs a
  // hub's models as they are; on *Everything* otherwise, so a node with no
  // engine, or Strata alone, does not open on an empty list.
  const enginesKnown =
    nodesLoaded && (selected === null || engines !== null || enginesError !== null);
  const level: LevelFilter = chosenLevel ?? (runsHubModelsAsTheyAre(engines) ? "works_here" : "");
  // The node's engines' own lists (LS4), sent with the search as `accepts`
  // is sent to the judge.
  const lists = useMemo(() => (engines ? engineLists(engines) : null), [engines]);
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
        // The old `format` preference is not carried over: GGUF was a
        // default, not a choice, for nearly everyone who has it stored. Nor
        // is the old `level`, written on every visit whether chosen or not.
        const chosen = prefs.chosenLevel;
        if (chosen === "" || chosen === "works_here" || chosen === "other_engine") {
          setChosenLevel(chosen);
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
        JSON.stringify({
          contextLength,
          ...(chosenLevel !== null ? { chosenLevel } : {}),
          sort,
        } satisfies DiscoverPrefs),
      );
    } catch {
      // The screen just does not remember.
    }
  }, [prefsLoaded, contextLength, chosenLevel, sort]);

  // The URL mirrors the selection; state drives. `replace` rather than
  // `push` so paging through repos does not bury Back under every
  // click. The other params are preserved — `?sel=` is the tree's and
  // clobbering it would deselect the tree on every repo click — and
  // read off `window.location` rather than `useSearchParams`, whose
  // object in the dependency list would re-fire this effect on its own
  // replace.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const current = selectionFromParams(params);
    if (current === null ? selection === null : sameSelection(current, selection)) return;
    for (const name of ["repo", "source", "listed"]) params.delete(name);
    if (selection) {
      params.set("repo", selection.repo);
      if (selection.source) params.set("source", selection.source);
      if (selection.listed)
        params.set("listed", `${selection.listed.engine}:${selection.listed.id}`);
    }
    const qs = params.toString();
    router.replace(qs ? `/discover?${qs}` : "/discover", { scroll: false });
  }, [router, selection]);

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
  // A filter whose engines all load one format asks the hub for that
  // format only, so a page of thirty is not mostly rows it then hides.
  const hubFormat = hubFormatFor(level === "" ? null : level, engines);
  const search = useCallback(async () => {
    const mine = ++searchSeq.current;
    const current = () => mine === searchSeq.current;
    setSearching(true);
    setSearchError(null);
    // The Library's one hub, as before the sources list (LS4).
    const oneHub = () => {
      const params = new URLSearchParams({ sort, limit: "30" });
      if (debouncedQuery) params.set("q", debouncedQuery);
      if (hubFormat) params.set("format", hubFormat);
      return api.get<CatalogueSearchPage>("library", `/v1/catalogue/search?${params.toString()}`);
    };
    try {
      let page: CatalogueSearchPage;
      if (olderLibrary.current) {
        page = await oneHub();
      } else {
        try {
          // Every source together; the node's engines' lists go with it.
          page = await api.post<CatalogueSearchPage>("library", "/v1/catalogue/search", {
            sort,
            limit: 30,
            ...(debouncedQuery ? { q: debouncedQuery } : {}),
            ...(hubFormat ? { format: hubFormat } : {}),
            ...(lists ? { engines: lists } : {}),
          });
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 405)) throw err;
          olderLibrary.current = true;
          setSearchOlder(true);
          page = await oneHub();
        }
      }
      if (!current()) return;
      setResults(page.results ?? []);
      setStatuses(page.sources ?? null);
      setInterpreted(page.interpretedAs === "repo" ? "repo" : "search");
      // A pasted link named one repo. Selecting it is the whole point:
      // making someone click the only row is the click this removes.
      if (page.interpretedAs === "repo" && page.interpretedFrom) {
        const row = (page.results ?? [])[0];
        setSelection({
          repo: page.interpretedFrom,
          source: row?.hubSource ?? null,
          listed: null,
        });
      }
    } catch (err) {
      if (!current()) return;
      if (err instanceof ApiError && err.status === 401) return;
      setResults([]);
      setStatuses(null);
      setInterpreted("search");
      setSearchError(describeError(err));
    } finally {
      if (current()) setSearching(false);
    }
  }, [debouncedQuery, hubFormat, sort, lists]);

  // Every row's facts, judged in one call; a row is as good as its best format.
  const rowFacts = useMemo(() => (results ?? []).flatMap((r) => r.facts ?? []), [results]);
  const { byId: rowVerdicts, older: libraryOlder } = useCandidateEligibility(engines, rowFacts);

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

  // Not before the node's engines are known: the filter's default and the
  // lists sent both rest on them, and a first search without them is spent
  // twice.
  useEffect(() => {
    if (enginesKnown) void search();
  }, [search, enginesKnown]);

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
            value={level}
            onChange={(event) => setChosenLevel(event.target.value as LevelFilter)}
            className={selectClass}
            aria-label={`Which models, for ${where}`}
            title={`By which engines can run them on ${where}`}
          >
            {(["works_here", "other_engine", ""] as LevelFilter[]).map((value) => (
              <option key={value} value={value}>
                {FILTER_LABEL[value]}
              </option>
            ))}
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
            statuses={statuses}
            searching={searching}
            error={searchError}
            interpreted={interpreted}
            selected={selection}
            onSelect={(result) => setSelection(selectionOf(result))}
            level={level}
            onEverything={() => setChosenLevel("")}
            verdicts={rowVerdicts}
            where={where}
            note={
              enginesError
                ? `Could not ask ${where} which engines it has (${enginesError}), so nothing is filtered.`
                : libraryOlder
                  ? "This Library is older than the engine check, so every model is listed."
                  : searchOlder
                    ? "This Library is older than the list of sources, so only its one hub is searched."
                    : null
            }
          />

          <div className="min-h-0 overflow-y-auto px-5 py-4">
            <ContextControl value={contextLength} onChange={setContextLength} />
            {selection ? (
              <RepoDetail
                key={selectionKey(selection)}
                repo={selection.repo}
                source={selection.source}
                listed={selection.listed}
                lists={lists ?? []}
                contextLength={contextLength}
                budget={budget}
                engines={engines}
                node={selected}
                where={where}
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
                engines={engines}
                where={where}
                contextLength={contextLength}
                busy={starterBusy}
                inFlight={inFlightFiles}
                error={starterError}
                onDownload={downloadStarter}
                onOpenRepo={(repo) => setSelection({ repo, source: null, listed: null })}
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
  // The node's own reading wins, and the picker beside this already says
  // it, in `describeBudget`'s words: a second line here once read the
  // same card as "30 GiB free" and "29.6 GiB free of 31.8 GiB". Only
  // when the node reported no devices is there something left to say.
  if (budget) return null;

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
  statuses,
  searching,
  error,
  interpreted,
  selected,
  onSelect,
  level,
  onEverything,
  verdicts,
  where,
  note,
}: {
  results: CatalogueSearchResult[] | null;
  /** What each source answered (LS4); null from an older Library. */
  statuses: CatalogueSourceStatus[] | null;
  searching: boolean;
  error: string | null;
  interpreted: "search" | "repo";
  selected: Selection | null;
  onSelect: (result: CatalogueSearchResult) => void;
  /** The engine filter in effect; "" is everything. */
  level: LevelFilter;
  onEverything: () => void;
  /** The Library's verdicts on the rows' facts, by fact id; null until known. */
  verdicts: Map<string, ModelEligibility> | null;
  where: string;
  /** Why rows carry no dot, when they do not. */
  note: string | null;
}) {
  const rows = useMemo(() => {
    const judged = (results ?? []).map((result, index) => ({
      result,
      index,
      answer: verdicts
        ? bestAnswer((result.facts ?? []).map((f) => verdicts.get(f.id)))
        : undefined,
    }));
    if (verdicts === null) return judged;
    // Green, amber, red; the hub's own order within each. A row the
    // Library said nothing about goes last rather than being guessed at.
    const rank = (a: ModelEligibility | undefined) => (a ? LEVEL_RANK[a.level] : 3);
    return judged
      .filter((r) => level === "" || r.answer?.level === (level as EligibilityLevel))
      .sort((a, b) => rank(a.answer) - rank(b.answer) || a.index - b.index);
  }, [results, verdicts, level]);
  const hidden = (results?.length ?? 0) - rows.length;
  // Every result says which source it came from (§4.4), in the words the
  // person gave it; a source that failed says why, while the rest stand.
  const labels = new Map((statuses ?? []).map((s) => [s.id, s.label ?? s.id]));
  const problems = (statuses ?? []).filter((s) => s.searched && s.problem);
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
      {note && (
        <p
          data-testid="filter-note"
          className="border-b border-[color:var(--border)] px-4 py-2 text-[0.6875rem] text-[color:var(--muted)]"
        >
          {note}
        </p>
      )}
      {problems.map((s) => (
        <p
          key={s.id}
          data-testid="source-problem"
          className="text-status-warn border-b border-[color:var(--border)] px-4 py-2 text-[0.6875rem]"
        >
          {s.label ?? s.id}: {s.problem}
        </p>
      ))}
      {results !== null && rows.length === 0 && !error && (
        <div className="px-4 py-3 text-sm text-[color:var(--muted)]" data-testid="no-results">
          {/* A filter is often the reason: say which, and undo it in one click. */}
          {level ? (
            <p>
              {results.length === 0 ? "Nothing matched" : `None of ${results.length} matches`}{" "}
              {level === "works_here"
                ? `works on ${where} now.`
                : `works on ${where} with another engine.`}{" "}
              <button type="button" onClick={onEverything} className="underline">
                Show everything
              </button>
            </p>
          ) : (
            <p>Nothing matched.</p>
          )}
          <p className="mt-1">A publisher name often works better than a description.</p>
        </div>
      )}
      <ul className={searching ? "opacity-60 transition-opacity" : undefined}>
        {rows.map(({ result, answer }) => (
          <li key={rowKey(result)} className="relative" data-testid="result-row">
            {answer && (
              <span className="absolute top-2 right-3 z-10">
                <EligibilityDot answer={answer} where={where} short guessNote={ROW_GUESS} />
              </span>
            )}
            <button
              type="button"
              onClick={() => onSelect(result)}
              aria-current={sameSelection(selectionOf(result), selected) ? "true" : undefined}
              className={`w-full border-b border-[color:var(--border)] px-4 py-2.5 text-left transition-colors hover:bg-[color:var(--panel-hover)] ${
                sameSelection(selectionOf(result), selected) ? "bg-[color:var(--panel-soft)]" : ""
              }`}
            >
              <p
                className={`font-ui truncate text-sm font-semibold ${answer ? "pr-24" : ""}`}
                title={result.repo}
              >
                {result.name ?? result.repo}
              </p>
              <p className="truncate text-[0.6875rem] text-[color:var(--muted)]">
                {result.supported ? (
                  <span data-testid="result-source">
                    {engineName(result.engine)}&rsquo;s list · {result.owner}
                  </span>
                ) : (
                  <>
                    {result.owner}
                    {result.source && labels.has(result.source) && (
                      <span data-testid="result-source"> · {labels.get(result.source)}</span>
                    )}
                  </>
                )}
                {result.gated && result.gated !== "open" && (
                  <span className="text-status-warn"> · gated</span>
                )}
              </p>
              {result.supported && (
                <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.6875rem] text-[color:var(--muted)] tabular-nums">
                  {result.supported.sizeBytes != null && (
                    <span>{formatBytes(result.supported.sizeBytes)} to download</span>
                  )}
                  {result.supported.recommended && (
                    <span className="text-status-success">recommended</span>
                  )}
                  {result.supported.experimental && (
                    <span className="text-status-warn">experimental</span>
                  )}
                </p>
              )}
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
      {hidden > 0 && rows.length > 0 && (
        <p
          data-testid="filter-hidden"
          className="px-4 py-2 text-[0.6875rem] text-[color:var(--muted)]"
        >
          {hidden} more {hidden === 1 ? "match" : "matches"} hidden by &ldquo;
          {FILTER_LABEL[level]}&rdquo;.{" "}
          <button type="button" onClick={onEverything} className="underline">
            Show everything
          </button>
        </p>
      )}
    </div>
  );
}

function EmptyDetail({
  budget,
  hardware,
  engines,
  where: machine,
  contextLength,
  busy,
  inFlight,
  error,
  onDownload,
  onOpenRepo,
}: {
  budget: NodeBudget | null;
  hardware: HostHardware | null;
  engines: EngineDescriptor[] | null;
  where: string;
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
        engines={engines}
        where={machine}
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
            to, so no version is split between the two.
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
  source,
  listed,
  lists,
  contextLength,
  budget,
  engines,
  node,
  where,
  downloads,
  onDownloadStarted,
}: {
  repo: string;
  /** The hub it is on; null is the Library's default hub (LS4). */
  source: string | null;
  /** Opened from an engine's list: which entry, at its pinned revision. */
  listed: { engine: string; id: string } | null;
  /** The node's engines' own lists, to say which versions are on them. */
  lists: EngineModelList[];
  contextLength: number;
  budget: NodeBudget | null;
  engines: EngineDescriptor[] | null;
  /** The picked node: where a preparation runs (LS5). */
  node: TargetNode | null;
  where: string;
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
  // Each version judged by its own facts, which the detail call read
  // (a folder's remote config.json included) before anything downloads.
  const facts = useMemo(
    () =>
      (detail?.candidates ?? [])
        .map((c) => c.facts)
        .filter((f): f is EligibilityCandidate => f != null),
    [detail],
  );
  // Each engine's own fit on the picked node, at the context above (LS6):
  // a version too large for every engine that would load it is red.
  const { byId: verdicts } = useCandidateEligibility(
    engines,
    facts,
    fitQuestion(budget, contextLength),
  );
  const answerFor = (candidate: CatalogueCandidate) =>
    candidate.facts ? verdicts?.get(candidate.facts.id) : undefined;
  // The entry this was opened from, if the node still lists it.
  const entry =
    listed === null
      ? undefined
      : lists.find((l) => l.engine === listed.engine)?.models.find((m) => m.id === listed.id);
  /** The engines whose own list names this version (the repo's file). */
  const listedBy = (candidate: CatalogueCandidate): string[] =>
    lists
      .filter((l) =>
        l.models.some(
          (m) => m.source.repoId === repo && m.source.file === candidate.files[0]?.path,
        ),
      )
      .map((l) => l.engine);
  // The hub, and for an engine's entry the revision it pins, on every call.
  const hubParam = { ...(source ? { source } : {}) };
  const pinned = entry?.source.revision ?? null;

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
          ...hubParam,
          ...(pinned ? { revision: pinned } : {}),
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
    // `hubParam` and `pinned` follow `source` and the entry, which the key fixes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, contextLength, budget]);

  async function preflight(candidate: CatalogueCandidate) {
    const weights = candidate.files[0]?.path;
    if (!weights) return;
    setBusy(candidate.label);
    setActionError(null);
    try {
      const params = new URLSearchParams({
        repo,
        ...hubParam,
        ...(pinned ? { revision: pinned } : {}),
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
        // Named only when it is not the default hub, so a Library older
        // than the sources list is never sent a field it refuses.
        ...hubParam,
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

  // The library suggests by memory alone; the judge says whether anything
  // here runs it. A version no engine here loads is never suggested, and a
  // fit is not quoted for it (Troy, 2026-10-09: a ComfyUI VAE was
  // "Suggested", "fits" and "Can not work on this machine" at once).
  const red = (candidate: CatalogueCandidate) => answerFor(candidate)?.level === "not_here";
  const suggested = detail.candidates.find((c) => c.label === detail.recommended?.label) ?? null;
  const recommendedCandidate = suggested && !red(suggested) ? suggested : null;
  const nothingRuns =
    detail.candidates.length > 0 &&
    detail.candidates.every((c) => answerFor(c) !== undefined && red(c));
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

      {entry && listed && (
        <section
          data-testid="listed-entry"
          className="rounded-[var(--radius)] border border-[color:var(--border)] px-4 py-3 text-sm"
        >
          <p className="font-ui font-semibold">
            On {engineName(listed.engine)}&rsquo;s own list: {entry.title}
            {entry.recommended && <span className="text-status-success"> · recommended</span>}
            {entry.experimental && <span className="text-status-warn"> · experimental</span>}
          </p>
          {entry.about && <p className="mt-1">{entry.about}</p>}
          <p className="mt-1 text-[color:var(--muted)]">
            {entry.publisher && <>{entry.publisher} · </>}
            {entry.sizeBytes != null && <>{formatBytes(entry.sizeBytes)} to download · </>}
            the version {engineName(listed.engine)} names, at the revision it pins
            {entry.preparation?.note && (
              <>
                ; {engineName(listed.engine)} makes {entry.preparation.note} from it before it runs
              </>
            )}
          </p>
          {entry.license && <p className="mt-1">Its licence: {entry.license}</p>}
        </section>
      )}

      {entry && listed && entry.preparation && (
        <ListedPreparation
          repo={repo}
          source={source}
          revision={pinned ?? detail.resolvedCommit ?? null}
          engine={listed.engine}
          entry={entry}
          candidate={detail.candidates.find((c) => c.files[0]?.path === entry.source.file) ?? null}
          descriptor={(engines ?? []).find((e) => e.engine === listed.engine) ?? null}
          node={node}
          where={where}
        />
      )}

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
            {answerFor(recommendedCandidate) && (
              <EligibilityDot
                answer={answerFor(recommendedCandidate)!}
                where={where}
                guessNote={CANDIDATE_GUESS}
              />
            )}
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
              className="action-button action-button--primary font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1.5 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
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

      {nothingRuns && (
        <p
          data-testid="repo-nothing-runs"
          className="status-error rounded-[var(--radius)] border px-4 py-3 text-sm"
        >
          <span className="font-ui font-semibold">Can not work on {where}.</span> No engine that can
          run there loads any version of this. Each version&rsquo;s dot below says why.
        </p>
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
          recommended={recommendedCandidate?.label ?? null}
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
          answerFor={answerFor}
          listedBy={listedBy}
          highlight={entry?.source.file ?? null}
          where={where}
        />
      )}

      {(detail.otherFiles ?? []).length > 0 && <OtherFiles files={detail.otherFiles ?? []} />}

      <QuantReference />

      <ModelCard repo={repo} source={source} />
    </div>
  );
}

/**
 * *Download and prepare* for an entry of an engine's own list (LS5): the one
 * action that takes it from the hub to running (download, preparation,
 * settings, launch). A copy already on disk is prepared where it is.
 */
function ListedPreparation({
  repo,
  source,
  revision,
  engine,
  entry,
  candidate,
  descriptor,
  node,
  where,
}: {
  repo: string;
  source: string | null;
  revision: string | null;
  engine: string;
  entry: SupportedModel;
  /** The version the entry names, in this repo at its revision. */
  candidate: CatalogueCandidate | null;
  descriptor: EngineDescriptor | null;
  node: TargetNode | null;
  where: string;
}) {
  const owned = candidate?.alreadyOwned ?? null;
  const cannotRun =
    descriptor !== null &&
    !descriptor.available &&
    !eligibilityEngines([descriptor])[0]!.installable;
  return (
    <PrepareControl
      engine={engine}
      entry={entry}
      node={node}
      where={where}
      download={owned ? null : (candidate?.sizeBytes ?? entry.sizeBytes ?? null)}
      disabledReason={
        cannotRun
          ? `${engineName(engine)} cannot run on ${where}.`
          : candidate === null
            ? `${repo} at this revision has no ${entry.source.file ?? "file of this entry"}.`
            : null
      }
      onStart={(preparation) => {
        if (!node || !candidate) return "";
        if (owned)
          return startPreparation(
            {
              id: owned.modelId,
              name: entry.title,
              path: owned.path,
              format: "gguf",
              contextLength: null,
            },
            node,
            preparation,
          );
        return startDownloadAndPrepare(
          {
            repo,
            files: candidate.files.map((file) => file.path),
            revision,
            source,
            label: entry.title,
          },
          node,
          preparation,
        );
      }}
    />
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
  answerFor,
  listedBy,
  highlight,
  where,
}: {
  /** The Library's verdict on one version, once it has answered. */
  answerFor: (candidate: CatalogueCandidate) => ModelEligibility | undefined;
  /** The engines whose own list names this version (LS4). */
  listedBy: (candidate: CatalogueCandidate) => string[];
  /** The first file of the version an engine's entry opened, if any. */
  highlight: string | null;
  where: string;
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
            const answer = answerFor(candidate);
            // Whose fit the column shows (LS6): the engine the dot is about.
            // The catalogue's own arithmetic is llama.cpp's, so it stands only
            // for a GGUF whose engine scores by it; any other engine's is its
            // own answer, named.
            const engineFor = answer ? levelEngine(answer.engines) : undefined;
            const ownFit = engineFor?.fit;
            const spills = candidate.format === "gguf" && (!ownFit || ownFit.model === "spill");
            return (
              <tr
                key={candidate.label}
                className={`border-t border-[color:var(--border)] align-top ${
                  highlight !== null && candidate.files[0]?.path === highlight
                    ? "bg-[color:var(--panel-soft)]"
                    : ""
                }`}
              >
                <td className="px-3 py-2">
                  <span className="font-ui font-semibold">{candidate.label}</span>
                  {answer && (
                    <span className="ml-2" data-testid="candidate-level">
                      <EligibilityDot
                        answer={answer}
                        where={where}
                        short
                        guessNote={CANDIDATE_GUESS}
                      />
                    </span>
                  )}
                  {recommended === candidate.label && (
                    <span className="text-status-success ml-2 text-[0.625rem] uppercase">
                      recommended
                    </span>
                  )}
                  {listedBy(candidate).map((engine) => (
                    <span
                      key={engine}
                      data-testid="candidate-listed"
                      className="ml-2 text-[0.625rem] text-[color:var(--muted)]"
                      title={`${engineName(engine)} names this version in its own list of the models it supports.`}
                    >
                      on {engineName(engine)}&rsquo;s list
                    </span>
                  ))}
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
                <td className="px-3 py-2">
                  {answer?.level === "not_here" ? (
                    <span
                      data-testid="candidate-fit-none"
                      className="text-[color:var(--muted)]"
                      title={`No engine that can run on ${where} loads this version, so there is no fit to give.`}
                    >
                      —
                    </span>
                  ) : spills && fit ? (
                    <FitBadge fit={fit} />
                  ) : engineFor && ownFit ? (
                    <EngineFitBadge engine={engineName(engineFor.engine)} fit={ownFit} />
                  ) : (
                    "—"
                  )}
                </td>
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
  "action-button action-button--compact font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-0.5 text-[0.6875rem] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";

const selectClass =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-2 py-1 text-sm outline-none focus:border-[color:var(--border-hover)]";

function compactCount(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}k`;
  return String(value);
}
