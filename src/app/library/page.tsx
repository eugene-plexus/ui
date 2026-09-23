"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ConfirmButton } from "@/components/ConfirmButton";
import { CopyButton } from "@/components/CopyButton";
import { DownloadsPanel, useDownloads } from "@/components/DownloadsPanel";
import { FitBreakdown, formatMemory } from "@/components/FitBadge";
import { ProfileEditor } from "@/components/ProfileEditor";
import { AppShell } from "@/components/AppShell";
import { NodePicker } from "@/components/NodePicker";
import { RunButton } from "@/components/RunButton";
import { ApiError, api, describeError } from "@/lib/api";
import { capableEngines } from "@/lib/engineCompat";
import { type NodeBudget, type TargetNode, fitQuery, useTargetNode } from "@/lib/nodeBudget";
import { describeRunning, runningModel, type RunningModel } from "@/lib/runningModel";
import { formatBytesShort } from "@/lib/tasks";
import { usePolling } from "@/lib/usePolling";
import type {
  EngineDescriptor,
  EngineList,
  LibraryModel,
  LibraryModelList,
  ModelFit,
  Runtime,
  RuntimeList,
  Scan,
  SkippedPath,
  SkipReason,
} from "@/lib/types";

/**
 * The model library — what the operator owns, as found on disk.
 *
 * Two components, joined here:
 *   library  GET /v1/models  → what each model *is*
 *   agent GET /v1/engines → what each engine can *load*
 *
 * That join is the reason a safetensors model shows a disabled Launch
 * button naming the missing engine rather than one that fails: llama.cpp
 * reads GGUF only, so until the vLLM adapter lands there is nothing on
 * this host that can serve one.
 *
 * The page is deliberately honest about absence. A model whose file has
 * gone still appears, because the profiles saved against it are the one
 * thing here that cannot be recovered by looking at the disk again. And
 * what the scan passed over is a first-class panel, not a debug log —
 * "why isn't my model showing up" is the question this page exists to
 * answer, and the answer lives in `skipped[]`.
 */

// Only while a scan is running. Nothing changes between scans, so a
// steady poll would be asking a component that reads disks to do work on
// a timer for no reason.
const SCAN_POLL_MS = 700;

// What the picked node is running. Slower than the Inference screen's
// 3 s because this page is not a dashboard, fast enough that Run flipping
// to "Running" needs no refresh.
const RUNTIME_POLL_MS = 5000;

const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  projector: "vision projector",
  shard_member: "shard of a split model",
  adapter: "LoRA adapter",
  older_revision: "older cache revision",
  not_a_model: "not a model",
  unreadable_header: "could not be read",
  unsupported_format: "unsupported format",
  incomplete_download: "partial download",
};

export default function LibraryPage() {
  // `useSearchParams` suspends during prerender, so the boundary is
  // required rather than decorative. The fallback is the page frame
  // without a selection, which is what an operator arriving without a
  // `?model=` sees anyway.
  return (
    <Suspense fallback={null}>
      <LibraryPageInner />
    </Suspense>
  );
}

function LibraryPageInner() {
  const [models, setModels] = useState<LibraryModel[] | null>(null);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [engines, setEngines] = useState<EngineDescriptor[] | null>(null);
  // A failed engine read is not "this node has no engines": treating it
  // as one put "no engine" on every row and hid Run whenever the picked
  // node was slow or down.
  const [enginesError, setEnginesError] = useState<string | null>(null);
  // What the picked node has LOADED, which neither the library nor the
  // engine list knows -- and without it this page told Troy a model that
  // was serving on Amish_Station would not fit there, and offered to
  // start it. See `lib/runningModel.ts`.
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  // Which node Launch goes to, and whose engines and memory the detail
  // pane is about. One choice for both -- see `nodeBudget.ts`.
  const picker = useTargetNode();
  const target = picker.selected?.target ?? null;
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { downloads, reload: reloadDownloads, active: activeDownloads } = useDownloads();

  // A finished download links here as `/library?model=<id>`. Applied
  // once, so selecting something else afterwards is not fought by the
  // URL that got you here.
  const searchParams = useSearchParams();
  const requestedModel = searchParams.get("model");
  const requestedNode = searchParams.get("node");
  const [appliedNode, setAppliedNode] = useState(false);
  useEffect(() => {
    if (appliedNode || !requestedNode || !picker.loaded) return;
    if (picker.nodes.some((n) => n.name === requestedNode)) picker.select(requestedNode);
    setAppliedNode(true);
  }, [appliedNode, requestedNode, picker]);
  const [appliedRequest, setAppliedRequest] = useState(false);
  useEffect(() => {
    if (appliedRequest || !requestedModel) return;
    setSelected(requestedModel);
    setAppliedRequest(true);
  }, [appliedRequest, requestedModel]);

  const loadModels = useCallback(async () => {
    try {
      const list = await api.get<LibraryModelList>("library", "/v1/models");
      setModels(list.models ?? []);
      setLastScanAt(list.lastScanAt ?? null);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      // The library's own sentence, not `err.message`'s status line.
      setError(describeError(err));
    }
  }, []);

  const loadScan = useCallback(async () => {
    try {
      setScan(await api.get<Scan>("library", "/v1/scan"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      // A scan-state read failing is not worth blanking the page; the
      // model list above it is still true.
    }
  }, []);

  useEffect(() => {
    void loadModels();
    void loadScan();
  }, [loadModels, loadScan]);

  // Engines change only when an operator installs one, so this is a
  // one-shot read per node rather than part of any poll -- and it is
  // the PICKED node's engines, because "can this format be launched"
  // is a question about the machine it would be launched on.
  useEffect(() => {
    if (target === null) return;
    let cancelled = false;
    // Unknown again while the new node is asked, so the previous node's
    // engines are never shown as this one's.
    setEngines(null);
    setEnginesError(null);
    void (async () => {
      try {
        const list = await api.get<EngineList>(target, "/v1/engines");
        if (!cancelled) setEngines(list.engines ?? []);
      } catch (err) {
        if (cancelled || (err instanceof ApiError && err.status === 401)) return;
        setEnginesError(describeError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target]);

  // Soft, and per the picked node: `node:<name>` reaches another
  // machine's own agent, which is the only party that knows what it has
  // loaded. A node that does not answer means "nothing known", which
  // reads on the page as the state before this feature existed.
  const loadRuntimes = useCallback(async () => {
    if (target === null) return;
    try {
      const list = await api.get<RuntimeList>(target, "/v1/runtimes");
      setRuntimes(list.runtimes ?? []);
    } catch {
      setRuntimes([]);
    }
  }, [target]);
  usePolling(loadRuntimes, RUNTIME_POLL_MS, target !== null);

  // Poll only while a walk is in flight, and reload the models once it
  // settles rather than on every tick — the list does not change
  // mid-scan, only at the end when the store is replaced.
  const scanning = scan?.state === "scanning";
  useEffect(() => {
    if (!scanning) return;
    const id = setInterval(() => void loadScan(), SCAN_POLL_MS);
    return () => clearInterval(id);
  }, [scanning, loadScan]);

  // The library scans the destination directory itself when a
  // download finishes, so the thing that goes stale here is the model
  // list. Reload it when the number of active transfers drops.
  const [previousActive, setPreviousActive] = useState(0);
  useEffect(() => {
    if (activeDownloads < previousActive) void loadModels();
    setPreviousActive(activeDownloads);
  }, [activeDownloads, previousActive, loadModels]);

  const [wasScanning, setWasScanning] = useState(false);
  useEffect(() => {
    if (scanning) setWasScanning(true);
    else if (wasScanning) {
      setWasScanning(false);
      void loadModels();
    }
  }, [scanning, wasScanning, loadModels]);

  async function startScan(full: boolean) {
    setBusy(true);
    try {
      setScan(await api.post<Scan>("library", "/v1/scan", { full }));
      setError(null);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancelScan() {
    setBusy(true);
    try {
      setScan(await api.delete<Scan>("library", "/v1/scan"));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  // Which formats this host can actually load, across every engine with
  // an adapter. Not filtered by `available`: an engine that is merely
  // not installed yet is a different problem from one that could never
  // load this format, and they deserve different messages.
  // Null while the answer is not in: a row says "no engine" only once the
  // node has actually said so.
  const loadableFormats = useMemo(() => {
    if (engines === null) return null;
    const out = new Set<string>();
    for (const e of engines) for (const f of e.modelFormats ?? []) out.add(f);
    return out;
  }, [engines]);

  const current = models?.find((m) => m.id === selected) ?? null;

  return (
    <AppShell
      controls={
        <>
          <NodePicker nodes={picker.nodes} selected={picker.selected} onSelect={picker.select} />
          {lastScanAt && (
            <span className="text-sm text-[color:var(--muted)]">
              scanned {relativeAge(lastScanAt)}
            </span>
          )}
          {scanning ? (
            <button type="button" onClick={() => void cancelScan()} className={buttonClass}>
              cancel scan
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void startScan(false)}
                disabled={busy}
                className={buttonClass}
                title="Files whose size and timestamp are unchanged keep their metadata and are not reopened."
              >
                scan
              </button>
              <button
                type="button"
                onClick={() => void startScan(true)}
                disabled={busy}
                className={buttonClass}
                title="Re-read every model's metadata, ignoring the cache. Slower; for when the reader has changed rather than the files."
              >
                full rescan
              </button>
            </>
          )}
        </>
      }
    >
      <main className="flex min-h-0 flex-1 flex-col">
        {error && (
          <p
            className="status-error mx-4 mt-3 rounded-[var(--radius)] border px-3 py-2 text-sm"
            role="alert"
          >
            {error}
          </p>
        )}

        <ScanBanner scan={scan} />

        {downloads.length > 0 && (
          <div className="max-h-[30vh] overflow-y-auto border-b border-[color:var(--border)] bg-[color:var(--panel-soft)] px-4 py-2">
            <p className="font-ui mb-1.5 text-[0.6875rem] font-semibold text-[color:var(--muted)]">
              {activeDownloads > 0
                ? `${activeDownloads} download${activeDownloads === 1 ? "" : "s"} in flight`
                : "recent downloads"}
            </p>
            <DownloadsPanel
              downloads={downloads}
              onChanged={reloadDownloads}
              node={picker.selected}
            />
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto sm:grid sm:grid-cols-[minmax(220px,320px)_minmax(0,1fr)] sm:overflow-hidden">
          <ModelList
            models={models}
            selected={selected}
            onSelect={setSelected}
            loadableFormats={loadableFormats}
            runtimes={runtimes}
          />
          <div className="min-w-0 shrink-0 px-4 py-4 sm:min-h-0 sm:overflow-y-auto sm:px-5">
            {current ? (
              <ModelDetail
                key={current.id}
                model={current}
                engines={engines}
                enginesError={enginesError}
                node={picker.selected}
                runtimes={runtimes}
                onChanged={() => void loadModels()}
                onRuntimesChanged={() => void loadRuntimes()}
              />
            ) : (
              <EmptyDetail models={models} scan={scan} />
            )}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

const buttonClass =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-sm text-[color:var(--foreground)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";

const primaryAction =
  "font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter] hover:brightness-110";

function ScanBanner({ scan }: { scan: Scan | null }) {
  if (!scan || scan.state === "idle") return null;

  if (scan.state === "scanning") {
    return (
      <div className="border-b border-[color:var(--border)] bg-[color:var(--panel-soft)] px-4 py-2 text-sm">
        <div className="flex items-center justify-between gap-4">
          <span>
            scanning — {scan.modelsFound ?? 0} models from {scan.filesScanned ?? 0} files
          </span>
          {/* The path being read right now. The difference between a
              scan that is working and one wedged on a network share. */}
          {scan.currentPath && (
            <span className="truncate font-mono text-[color:var(--muted)]" title={scan.currentPath}>
              {scan.currentPath}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (scan.state === "failed") {
    return (
      <p
        className="status-error mx-4 mt-3 rounded-[var(--radius)] border px-3 py-2 text-sm"
        role="alert"
      >
        {scan.error ?? "the scan failed"}
      </p>
    );
  }

  const badRoots = (scan.roots ?? []).filter(
    (r) => r.status === "missing" || r.status === "unreadable",
  );
  if (badRoots.length === 0) return null;

  // A configured directory that cannot be read is the operator asking
  // for something that is not working — an unplugged drive, a dead
  // share, a typo. `missing` and `unreadable` stay distinct because they
  // need different advice.
  return (
    <div className="status-warn mx-4 mt-3 rounded-[var(--radius)] border px-3 py-2 text-sm">
      {badRoots.map((r) => (
        <p key={r.path} className="truncate">
          <span className="font-mono">{r.path}</span> — {r.status}
          {r.error ? `: ${r.error}` : ""}
        </p>
      ))}
    </div>
  );
}

/**
 * How many models a list holds before it offers a filter. A handful can be
 * read at a glance, and a box above three rows is furniture; past that the
 * list is scanned for a name, which is what the box is for.
 */
const FILTER_THRESHOLD = 5;

/** Whether a model matches a lowercased filter: on the words the row
 * shows (name, format, quantization) and on its path, because the folder
 * is often how someone remembers where a model came from. */
function matchesFilter(model: LibraryModel, needle: string): boolean {
  return [model.name, model.displayName, model.path, model.format, model.gguf?.quantization].some(
    (field) => typeof field === "string" && field.toLowerCase().includes(needle),
  );
}

function ModelList({
  models,
  selected,
  onSelect,
  loadableFormats,
  runtimes,
}: {
  models: LibraryModel[] | null;
  selected: string | null;
  onSelect: (id: string) => void;
  /** Null while the picked node's engines are not known yet. */
  loadableFormats: Set<string> | null;
  /** The picked node's runtimes, so a running model is visible without
   * clicking it -- the list is where someone scanning for "which of
   * these is up" looks first. */
  runtimes: Runtime[];
}) {
  const [query, setQuery] = useState("");
  const filterRef = useRef<HTMLInputElement | null>(null);
  const all = models ?? [];
  const needle = query.trim().toLowerCase();
  const shown = needle ? all.filter((m) => matchesFilter(m, needle)) : all;
  // Kept while a filter is typed even if the list shrinks under the
  // threshold (a model forgotten mid-filter), so the box never vanishes
  // with text still in it and the list still narrowed.
  const offerFilter = all.length > FILTER_THRESHOLD || query !== "";

  // Clearing returns focus to the box, so the next thing typed filters
  // again rather than landing on whatever the button left behind.
  function clearFilter() {
    setQuery("");
    filterRef.current?.focus();
  }

  return (
    <aside
      data-testid="model-list"
      className="max-h-[35dvh] shrink-0 overflow-y-auto border-b border-[color:var(--border)] sm:max-h-none sm:min-h-0 sm:border-r"
    >
      {offerFilter && (
        <div className="sticky top-0 z-10 border-b border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2">
          <input
            ref={filterRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query !== "") {
                e.preventDefault();
                setQuery("");
              }
            }}
            placeholder="Filter by name or folder"
            aria-label="Filter models"
            spellCheck={false}
            className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--border-hover)]"
          />
          {needle && (
            <p
              data-testid="model-filter-count"
              aria-live="polite"
              className="font-ui mt-1 text-[0.6875rem] text-[color:var(--muted)]"
            >
              {shown.length} of {all.length} models
            </p>
          )}
        </div>
      )}
      {models == null && <p className="px-4 py-3 text-sm text-[color:var(--muted)]">loading…</p>}
      {models?.length === 0 && (
        <p className="px-4 py-3 text-sm leading-relaxed text-[color:var(--muted)]">
          Nothing found yet. Add the folder your models are in on the{" "}
          {/* The page that holds the folders. It said "the Config page",
              and the bare `/config` that pointed to selects nothing. */}
          <Link href="/library/folders?sel=library" className="underline">
            Library folders
          </Link>{" "}
          page, then scan.
        </p>
      )}
      {needle && all.length > 0 && shown.length === 0 && (
        <div className="px-4 py-3 text-sm text-[color:var(--muted)]">
          <p className="[overflow-wrap:anywhere]">No models match &ldquo;{query.trim()}&rdquo;.</p>
          <button
            type="button"
            onClick={clearFilter}
            className="font-ui mt-1 text-sm underline hover:text-[color:var(--foreground)]"
          >
            Clear filter
          </button>
        </div>
      )}
      {shown.map((m) => {
        const unloadable = loadableFormats !== null && !loadableFormats.has(m.format);
        const live = runningModel(m, runtimes);
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect(m.id)}
            // The tint alone says which is open only to someone who can
            // see it; `aria-current` says it to a screen reader too.
            aria-current={selected === m.id ? "true" : undefined}
            className={`block w-full border-b border-[color:var(--border)] px-4 py-2 text-left transition-colors hover:bg-[color:var(--panel-hover)] ${
              selected === m.id ? "bg-[color:var(--panel-soft)]" : ""
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm" title={m.name}>
                {m.name}
              </span>
              {live && !live.stopped && (
                <span
                  data-testid="model-list-running"
                  title={`Running on the machine in the picker as ${live.runtime}.`}
                  className="status-success badge shrink-0 rounded px-1 text-[0.5625rem] tracking-wider uppercase"
                >
                  {live.live ? "running" : "starting"}
                </span>
              )}
              {m.status !== "present" && (
                <span className="status-warn badge shrink-0 rounded px-1 text-[0.5625rem] tracking-wider uppercase">
                  {m.status}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.625rem] text-[color:var(--muted)]">
              <span className="font-mono">{m.format}</span>
              {m.gguf?.quantization && <span className="font-mono">{m.gguf.quantization}</span>}
              {m.sizeLabel && <span>{m.sizeLabel}</span>}
              {m.sizeBytes != null && (
                <span title={`${m.sizeBytes.toLocaleString()} bytes`}>
                  {formatBytesShort(m.sizeBytes)}
                </span>
              )}
              {m.capabilities?.embedding && <span>embedding</span>}
              {m.capabilities?.vision && <span>vision</span>}
              {(m.profileCount ?? 0) > 0 && (
                <span title="saved launch profiles">
                  {m.profileCount} profile{m.profileCount === 1 ? "" : "s"}
                </span>
              )}
              {unloadable && <span className="status-warn px-1">no engine</span>}
            </div>
          </button>
        );
      })}
    </aside>
  );
}

function EmptyDetail({ models, scan }: { models: LibraryModel[] | null; scan: Scan | null }) {
  const skipped = scan?.skipped ?? [];
  return (
    <div className="text-sm text-[color:var(--muted)]">
      {models && models.length > 0 && <p>Select a model.</p>}
      {skipped.length > 0 && <SkippedPanel scan={scan!} />}
    </div>
  );
}

/**
 * What the scan saw and deliberately did not treat as a model.
 *
 * A first-class panel rather than a debug log. Every entry here is a
 * file somebody can see in Explorer and cannot see in this list, and a
 * scanner that silently drops what it did not understand is
 * indistinguishable from a broken one.
 */
function SkippedPanel({ scan }: { scan: Scan }) {
  const [open, setOpen] = useState(false);
  const skipped = scan.skipped;
  const grouped = useMemo(() => {
    const out = new Map<SkipReason, SkippedPath[]>();
    for (const item of skipped ?? []) {
      const list = out.get(item.reason) ?? [];
      list.push(item);
      out.set(item.reason, list);
    }
    return [...out.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [skipped]);

  return (
    <section className="mt-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="font-ui text-sm text-[color:var(--muted)] underline hover:text-[color:var(--foreground)]"
      >
        {open ? "hide" : "show"} {skipped?.length ?? 0} skipped{" "}
        {(skipped?.length ?? 0) === 1 ? "path" : "paths"}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-3">
          <p className="leading-relaxed">
            Files the scan looked at and decided were not models. If something you expected is
            missing from the list, it is probably here with a reason.
          </p>
          {grouped.map(([reason, items]) => (
            <div key={reason}>
              <p className="text-[color:var(--foreground)]">
                {SKIP_REASON_LABEL[reason]} ({items.length})
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {items.slice(0, 12).map((s) => (
                  <li
                    key={s.path}
                    className="truncate font-mono text-[0.625rem]"
                    title={s.detail ?? ""}
                  >
                    {s.path}
                  </li>
                ))}
                {items.length > 12 && (
                  <li className="text-[0.625rem]">… and {items.length - 12} more</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ModelDetail({
  model,
  engines,
  enginesError,
  node,
  runtimes,
  onChanged,
  onRuntimesChanged,
}: {
  model: LibraryModel;
  /** Null while the picked node has not said which engines it has. */
  engines: EngineDescriptor[] | null;
  /** Why the engine read failed, when it did. */
  enginesError: string | null;
  node: TargetNode | null;
  /** What the picked node is running, so this page does not offer to
   * start something that is already up. */
  runtimes: Runtime[];
  onChanged: () => void;
  onRuntimesChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  // Which engines could load this model at all, and which of those are
  // installed here. Two different answers with two different fixes. The
  // join lives in lib/engineCompat: format first, and an MLX-quantized
  // directory narrows to the MLX engine (integer-packed weights nothing
  // else loads).
  const enginesKnown = engines !== null;
  const capable = capableEngines(model, engines ?? []);
  const usable = capable.filter((e) => e.available);

  const running = runningModel(model, runtimes);
  // The machine's own name when it has one, even when it is this one:
  // this page has a node picker in its header, so a sentence about "this
  // machine" is a sentence that does not say which. An unenrolled box has
  // no name and gets the generic phrase, which is all there is to say.
  const where = node?.name ?? "this machine";

  async function forget() {
    setError(null);
    try {
      await api.delete<void>("library", `/v1/models/${encodeURIComponent(model.id)}`);
      onChanged();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-medium [overflow-wrap:anywhere]">{model.name}</h2>
        {model.displayName && (
          <p className="text-sm text-[color:var(--muted)]">{model.displayName}</p>
        )}
        <div className="mt-1 flex items-start gap-1">
          <p className="min-w-0 font-mono text-[0.625rem] break-all text-[color:var(--muted)]">
            {model.path}
          </p>
          {/* A path is copied far more often than it is read: into a
              terminal, a file manager, another tool's settings. */}
          <CopyButton
            text={model.path}
            label="Copy path"
            title="Copy path"
            iconOnly
            className="-mt-1 shrink-0"
          />
        </div>
      </div>

      {model.status === "missing" && (
        <div className="status-warn rounded-[var(--radius)] border px-3 py-2 text-sm leading-relaxed">
          <p>
            This file is no longer where it was
            {model.lastSeenAt ? `, last seen ${relativeAge(model.lastSeenAt)}` : ""}. The entry is
            kept because {model.profileCount ?? 0} launch{" "}
            {model.profileCount === 1 ? "profile is" : "profiles are"} saved against it.
          </p>
          <p className="mt-1">
            If you moved it, scan again to find it at its new path. Copy the settings across, then
            forget this entry. Nothing guesses that two paths are the same model, because guessing
            wrong applies one model&rsquo;s tuning to another.
          </p>
          {/* Asked, because the profiles are the one thing here a rescan
              cannot bring back, and the prompt says how many go. */}
          <div className="mt-2">
            <ConfirmButton
              label="forget this entry and its profiles"
              prompt={`Its ${model.profileCount ?? 0} saved profile${
                model.profileCount === 1 ? "" : "s"
              } will be lost.`}
              onConfirm={forget}
              className={buttonClass}
            />
          </div>
          <p className="mt-1 text-[0.625rem]">
            No file is deleted. This only drops what we stored.
          </p>
        </div>
      )}

      {model.status === "unreadable" && (
        <p className="status-error rounded-[var(--radius)] border px-3 py-2 text-sm">
          {model.error ?? "this model could not be read"}
        </p>
      )}

      {error && (
        <p className="status-error rounded-[var(--radius)] border px-3 py-2 text-sm" role="alert">
          {error}
        </p>
      )}

      <Facts model={model} />

      {model.status === "present" && (
        <FitPanel
          model={model}
          running={running}
          where={where}
          budget={node?.budget ?? null}
          ready={node !== null}
        />
      )}

      {/* Nothing below is said about engines until the node has answered:
          "no engine can load this" was printed, and Run hidden, for as
          long as the question was in flight -- and for good when it
          failed. */}
      {!enginesKnown && (
        <p
          data-testid="engines-unknown"
          role={enginesError ? "alert" : "status"}
          className={`rounded-[var(--radius)] border px-3 py-2 text-sm ${
            enginesError ? "status-error" : "border-[color:var(--border)] text-[color:var(--muted)]"
          }`}
        >
          {enginesError
            ? `Could not ask ${where} which engines it has: ${enginesError}`
            : `Checking which engines ${where} has…`}
        </p>
      )}

      {/* The format/engine join. Two distinct answers: no adapter exists
          for this format at all, or one does but no binary is installed.
          Since S3 the second is not a detour: Run asks to install it. */}
      {!enginesKnown ? null : capable.length === 0 ? (
        <p className="status-warn rounded-[var(--radius)] border px-3 py-2 text-sm leading-relaxed">
          No engine here can load a <span className="font-mono">{model.format}</span> model.
          llama.cpp reads GGUF only; safetensors needs vLLM, which is installed by hand. You can
          still keep profiles against this model — they just have nothing to launch into.
        </p>
      ) : usable.length === 0 && !capable.some((e) => e.acquisition?.installable) ? (
        <p className="status-warn rounded-[var(--radius)] border px-3 py-2 text-sm leading-relaxed">
          <span className="font-mono">{capable.map((e) => e.engine).join(", ")}</span> can load
          this, but it is not installed on {node?.label ?? "this machine"} and Eugene cannot install
          it there
          {capable[0]?.acquisition?.reason ? `: ${capable[0].acquisition.reason}` : "."}{" "}
          {capable[0]?.acquisition?.manualInstall?.command && (
            <>
              To install it yourself:{" "}
              <code className="break-all">{capable[0].acquisition.manualInstall.command}</code>
            </>
          )}
        </p>
      ) : null}

      {/* One click from a file to `ready` (S3). The profile editor below is
          the expert path; this is the one a first run takes.

          **Unless it is already up.** A page offering to start something
          that is running is what Troy hit on the live install, and
          "start a second copy on the same card" is an expert's
          deliberate act -- so it moves out of the primary slot rather
          than disappearing (`easy-default-expert-override`). */}
      {model.status === "present" && enginesKnown && capable.length > 0 && (
        <div data-testid="model-run">
          {running && !running.stopped ? (
            <RunningPanel
              model={model}
              node={node}
              running={running}
              where={where}
              onChanged={onRuntimesChanged}
            />
          ) : (
            <>
              <RunButton
                model={model}
                node={node}
                label={running ? "Start again" : "Run"}
                disabledReason={
                  usable.length === 0 && !capable.some((e) => e.acquisition?.installable)
                    ? `${capable.map((e) => e.engine).join(", ")} is not installed on ${node?.label ?? "this machine"}, and cannot be installed from here.`
                    : null
                }
              />
              <p className="mt-1 text-[0.6875rem] text-[color:var(--muted)]">
                {/* A runtime that exists and is stopped is a different
                    sentence from nothing at all: the settings are already
                    chosen, and why it stopped is the thing worth saying. */}
                {running
                  ? `${describeRunning(running, where)} Start it again and it is back on Home.`
                  : usable.length > 0
                    ? `Starts ${model.name} on ${where} with settings that fit. Once it says ready, it is on Home.`
                    : `${capable.map((e) => engineName(e.engine)).join(", ")} is not installed on ${where} yet; Run asks before installing it.`}
              </p>
            </>
          )}
        </div>
      )}

      <ProfileEditor
        model={model}
        engines={usable.length > 0 ? usable : capable}
        node={node}
        onChanged={onChanged}
      />
    </div>
  );
}

/**
 * It is already running — so say that, and offer what a person actually
 * wants next.
 *
 * Reported 2026-09-17: a model serving on `Amish_Station` showed a
 * full-size **Run** button and no sign it was up. The primary actions
 * here are *use it* and *stop it*; starting a second copy on the same
 * card is still reachable and is deliberately not the button the page
 * leads with, because Troy's own read is that two models on one GPU is
 * the exception rather than the norm.
 *
 * **Stop is a confirm-free button on purpose.** It stops an engine
 * process and touches no file — the model is on disk either way, and the
 * runtime's settings survive it — so it is an undo away from itself, and
 * the sentence under it says exactly that.
 */
function RunningPanel({
  model,
  node,
  running,
  where,
  onChanged,
}: {
  model: LibraryModel;
  node: TargetNode | null;
  running: RunningModel;
  where: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function stop() {
    if (!node) return;
    setBusy(true);
    setError(null);
    try {
      await api.post<void>(
        node.target,
        `/v1/runtimes/${encodeURIComponent(running.runtime)}/stop`,
        {},
      );
      onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="model-running"
      data-status={running.status}
      className={`${running.live ? "status-success" : "status-warn"} rounded-[var(--radius)] border px-3 py-2 text-sm`}
    >
      <p className="font-ui text-sm font-semibold">{describeRunning(running, where)}</p>
      <p className="mt-0.5 opacity-80">
        as <span className="font-mono">{running.runtime}</span>
        {running.driver && (
          <>
            {" "}
            · fronted by <span className="font-mono">{running.driver}</span>
          </>
        )}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* Use it, before manage it: someone who has just found their
            model running wants to talk to it. */}
        <Link href="/" className={primaryAction}>
          Use it
        </Link>
        <Link href="/inference" className={buttonClass}>
          Inference
        </Link>
        <button type="button" onClick={() => void stop()} disabled={busy} className={buttonClass}>
          {busy ? "stopping…" : "Stop"}
        </button>
      </div>
      <p className="mt-1 text-[0.6875rem] opacity-80">
        Stopping frees the memory and keeps the file and its saved settings; Run brings it back.
      </p>

      {/* The expert path, kept and demoted. */}
      <details className="mt-2">
        <summary className="cursor-pointer text-[0.6875rem] underline">Run another copy</summary>
        <div className="mt-1.5">
          <RunButton model={model} node={node} size="small" label="Run another copy" />
          <p className="mt-1 text-[0.6875rem] opacity-80">
            Another engine loads the same file, using extra memory. This can serve two requests at
            once if your card has room for both copies.
          </p>
        </div>
      </details>

      {error && (
        <p className="status-error mt-2 rounded-[var(--radius)] border px-2 py-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Will this model run here, and at what context?
 *
 * The same arithmetic the discovery screen applies to a download
 * candidate, pointed at something already on the disk — where the scan
 * has already read the real metadata, so this is a calculation rather
 * than an estimate.
 *
 * `maxContextLength` is the more useful half of the answer. It is the
 * number that goes in a profile's context flag, and it is frequently far
 * below what the model declares: a current 27B says it was trained for
 * 262,144 tokens and almost no machine can hold that.
 */
function FitPanel({
  model,
  running,
  where,
  budget,
  ready,
}: {
  model: LibraryModel;
  /** What the picked node is doing with it. Null means nothing. */
  running: RunningModel | null;
  where: string;
  /** The memory of the node picked in the header. */
  budget: NodeBudget | null;
  /** False until the header's picker has resolved a node. */
  ready: boolean;
}) {
  const [fit, setFit] = useState<ModelFit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Whose memory this is about: the node picked in the header, which is
  // also where Launch goes -- see `nodeBudget.ts`. Handed down rather
  // than read from a second `useTargetNode()`: that copy read the
  // remembered node once, so switching the header picker left this panel
  // scoring the previous machine until another model was selected. It
  // waits for the picker too -- a request with no budget is scored
  // against the library's own host, and could land after the right one.
  useEffect(() => {
    setFit(null);
    setError(null);
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams(fitQuery(budget)).toString();
        const answer = await api.get<ModelFit>(
          "library",
          `/v1/models/${encodeURIComponent(model.id)}/fit${params ? `?${params}` : ""}`,
        );
        if (!cancelled) setFit(answer);
      } catch (err) {
        if (cancelled || (err instanceof ApiError && err.status === 401)) return;
        setError(describeError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [model.id, budget, ready]);

  if (error) {
    return <p className="text-sm text-[color:var(--muted)]">could not measure fit: {error}</p>;
  }
  if (!fit) return null;

  const verdict = fit.fit.verdict;
  // **A resident model has already answered this question, and the
  // arithmetic below cannot see that it has.** A fit is scored against
  // FREE VRAM, and a loaded model's own weights are in the part that is
  // not free -- so the one model this machine has proved it can run is
  // the one the panel called "too large". With a copy up, the prediction
  // is about a SECOND copy, and it is labelled as that rather than
  // dressed up as a verdict on the model.
  const resident = running !== null && !running.stopped;
  const tone = resident
    ? "status-success"
    : verdict === "fits"
      ? "status-success"
      : verdict === "no"
        ? "status-error"
        : "status-warn";

  return (
    <div
      className={`${tone} rounded-[var(--radius)] border px-3 py-2 text-sm`}
      data-testid="model-fit"
      data-resident={resident ? "true" : "false"}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-ui font-semibold">
          {resident ? (
            running.live ? (
              `Running on ${where} now — it fits`
            ) : (
              `Starting on ${where}`
            )
          ) : (
            <>
              {verdict === "fits" && "Fits in GPU memory"}
              {verdict === "tight" && "Would fit on an idle GPU"}
              {verdict === "split" && "Needs partial CPU offload"}
              {verdict === "no" && "Too large for this node"}
            </>
          )}
        </p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="font-ui text-[0.6875rem] underline"
          aria-expanded={open}
        >
          {open ? "hide the numbers" : "show the numbers"}
        </button>
      </div>
      {resident && (
        <p className="mt-0.5">
          This machine is holding it, so the memory reading below is what is left{" "}
          <em>with it loaded</em> — the verdict there is about starting a <em>second</em> copy
          beside this one, not about this model.
        </p>
      )}
      <p className="mt-0.5">
        {resident && <>A second copy would need </>}
        {formatMemory(fit.fit.requiredBytes)}
        {resident ? " " : " needed "}at {fit.fit.contextLength.toLocaleString()} tokens of context.
        {fit.maxContextLength != null && (
          <>
            {" "}
            The largest context that still fits entirely in GPU memory is{" "}
            <strong>{fit.maxContextLength.toLocaleString()}</strong> tokens
            {fit.modelContextLength != null && fit.modelContextLength > fit.maxContextLength && (
              <> — this model declares {fit.modelContextLength.toLocaleString()}</>
            )}
            .
          </>
        )}
      </p>
      {budget && (
        <p className="mt-0.5 opacity-80">
          Scored against {budget.node ?? "this host"}
          {budget.gpu ? ` · ${budget.gpu.name}` : " · no GPU"}, where a launch from here runs
          {resident && <> — free memory, which this model is already inside</>}.
        </p>
      )}
      {open && (
        <div className="mt-2">
          <FitBreakdown fit={fit.fit} />
        </div>
      )}
    </div>
  );
}

/**
 * The facts worth showing about one model.
 *
 * Declarative rows rather than a built-up array: conditional `<Row>`
 * elements read as what they are, and JSX pushed into an array is a
 * shape React tooling has to be told is safe.
 */
function Facts({ model }: { model: LibraryModel }) {
  const caps = model.capabilities;
  const capabilityList = caps
    ? [
        caps.chat && "chat",
        caps.embedding && "embedding",
        caps.vision && "vision",
        caps.chatTemplate && "chat template",
      ].filter(Boolean)
    : [];
  const sampling = model.gguf?.recommendedSampling;
  const samplingParts = sampling
    ? [
        sampling.temperature != null && `temp ${sampling.temperature}`,
        sampling.topK != null && `top_k ${sampling.topK}`,
        sampling.topP != null && `top_p ${round(sampling.topP)}`,
      ].filter(Boolean)
    : [];

  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[130px_minmax(0,1fr)]">
      <Row label="format">
        <span className="font-mono">{model.format}</span>
      </Row>

      {model.architecture && <Row label="architecture">{model.architecture}</Row>}

      {model.gguf?.quantization && (
        <Row label="quantization">
          <span className="font-mono">{model.gguf.quantization}</span>
          {model.gguf.fileType != null && (
            <span className="ml-2 text-[color:var(--muted)]">file_type {model.gguf.fileType}</span>
          )}
          {/* Both labels reported, neither silently preferred: a
              requantized file keeps its old name more often than a
              metadata field is wrong, but not always. */}
          {model.gguf.quantizationDisagrees && (
            <span className="status-warn ml-2 px-1">metadata and filename disagree</span>
          )}
        </Row>
      )}

      {model.safetensors?.dtype && (
        <Row label="dtype">
          <span className="font-mono">{model.safetensors.dtype}</span>
        </Row>
      )}

      {model.contextLength != null && (
        <Row label="context">
          {model.contextLength.toLocaleString()}
          {/* The model's trained context, not what an engine will serve
              — that depends on the launch flags and is reported on the
              runtime. Showing only one of the two tells a comfortable
              lie. */}
          <span
            className="ml-2 text-[color:var(--muted)]"
            title="The runtime's contextSize sets the context used when serving."
          >
            as trained; your launch settings decide
          </span>
        </Row>
      )}

      {model.parameters != null ? (
        <Row label="parameters">{model.parameters.toLocaleString()}</Row>
      ) : (
        model.sizeLabel && (
          <Row label="size label">
            {model.sizeLabel}
            <span className="ml-2 text-[color:var(--muted)]">
              author-supplied; GGUF carries no exact count
            </span>
          </Row>
        )
      )}

      {model.sizeBytes != null && (
        <Row label="on disk">
          <span title={`${model.sizeBytes.toLocaleString()} bytes`}>
            {formatBytesShort(model.sizeBytes)}
          </span>{" "}
          across {model.fileCount ?? 1} file
          {(model.fileCount ?? 1) === 1 ? "" : "s"}
        </Row>
      )}

      {model.gguf?.shardCount != null && model.gguf.shardCount > 1 && (
        <Row label="shards">{model.gguf.shardCount} (launched from the first)</Row>
      )}

      {model.gguf?.projectorPath && (
        <Row label="projector">
          <span className="font-mono text-[0.625rem] break-all">{model.gguf.projectorPath}</span>
        </Row>
      )}

      {model.safetensors?.repoId && (
        <Row label="repo">
          {model.safetensors.repoId}
          {model.safetensors.revision && (
            <span className="ml-2 font-mono text-[color:var(--muted)]">
              {model.safetensors.revision.slice(0, 12)}
            </span>
          )}
        </Row>
      )}

      {capabilityList.length > 0 && <Row label="capabilities">{capabilityList.join(", ")}</Row>}

      {/* Reported, never applied. The gateway owns every parameter that
          affects output; this exists so the operator doesn't have to go
          read the model card to learn the file had an opinion. */}
      {samplingParts.length > 0 && (
        <Row label="author suggests">
          {samplingParts.join(" · ")}
          <span className="ml-2 text-[color:var(--muted)]">not applied automatically</span>
        </Row>
      )}
    </dl>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-[color:var(--muted)]">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Engine names as a person says them. */
function engineName(engine: string): string {
  return engine === "llama_cpp" ? "llama.cpp" : engine === "vllm" ? "vLLM" : engine;
}

function round(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function relativeAge(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}
