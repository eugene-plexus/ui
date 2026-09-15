/**
 * Background work, as one list, from the endpoints that already report it.
 *
 * Principle P7 of the hobbyist UX design: *background work is visible
 * everywhere*. Before S1 a download was visible on Discover and Library
 * and nowhere else, an engine install only on the Inference row that
 * started it, a model loading only on Inference — and each of those
 * screens polled its own endpoint with its own wording. The header tray
 * renders this list on every signed-in screen, so what is happening is
 * one glance away from wherever the person is.
 *
 * **Pure on purpose.** No fetching, no React: it takes the raw bodies
 * and returns `Task[]`, so the shapes can be tested against the bodies
 * the components actually return rather than against what a hook was
 * hoping for. `useTasks.ts` does the polling.
 *
 * **Four sources, and one that cannot be discovered from here.**
 *
 *   - downloads: `library GET /v1/downloads` — every record, active or
 *     not; the active states are the ones that become tasks.
 *   - scan: `library GET /v1/scan` — one at a time, so one task at most.
 *   - loads: a runtime in `starting` or `loading`, from the control
 *     root's union (`control GET /v1/runtimes`, which carries the node)
 *     or this agent's own list when the root did not answer.
 *   - installs: `agent GET /v1/engines/{engine}/install` per engine — a
 *     singleton sub-resource that persists its terminal state, so an
 *     install started on another screen, or from another browser, is
 *     found by asking. Only THIS machine's: another node's installs
 *     would mean a `node:<name>` read per node per poll, and Inference
 *     already shows them per node. Said here so it is a known gap and
 *     not a surprise.
 *
 * The words are the person's, not the architecture's (P5): "download",
 * "install", "loading", "model", "machine". No "runtime", no "companion
 * driver", no "declaration". A test on the tray asserts the banned list.
 */

import type {
  Download,
  DownloadList,
  DownloadState,
  EngineInstall,
  RuntimeList,
  RuntimePlacementList,
  Scan,
} from "./types";

export type TaskKind = "download" | "install" | "load" | "scan" | "run";

export interface Task {
  /** Stable across polls, so a list can keep its order and React its keys. */
  id: string;
  kind: TaskKind;
  /** One line, plain words: "Downloading unsloth/Qwen3-14B-GGUF Q6_K_XL". */
  title: string;
  /** One line under it: "42% · 38 MB/s · 4 min left". Empty when there is nothing to add. */
  detail: string;
  /** 0–1 when the work has a known total; absent when it does not. */
  progress?: number;
  /** Where to go to see more or act on it. */
  href: string;
  /** A failed task reads red; a finished one green; in flight, neither. */
  tone?: "ok" | "error";
  /**
   * Endpoint-reported work this task is the story of (S3's one-click run):
   * the tray drops its own `install:<engine>` row while a run installs
   * that engine, and its `load:<node>/<runtime>` row while a run starts that
   * runtime, so one thing happening is one line.
   */
  claims?: { engine?: string; runtime?: string };
  /**
   * Present on a task the browser itself owns (a run) once it has ended:
   * the tray shows a dismiss for it. Endpoint tasks never carry one — a
   * download is paused or cancelled where it was started, not here.
   */
  dismiss?: () => void;
}

/** The raw bodies, each `null` when its source did not answer. */
export interface TaskSources {
  downloads: DownloadList | null;
  scan: Scan | null;
  /** The control root's install-wide list, node included. */
  runtimes: RuntimePlacementList | null;
  /** This agent's own list, read only when the root did not answer. */
  localRuntimes: RuntimeList | null;
  /** This machine's engine installs, one per engine that has ever had one. */
  installs: EngineInstall[] | null;
}

/** Download states that mean "something is still to happen". `paused`
 * counts: a paused 40 GB fetch is an hour of bandwidth sitting on the
 * disk waiting for a decision, and hiding it is how it gets forgotten. */
export const ACTIVE_DOWNLOAD_STATES: readonly DownloadState[] = [
  "queued",
  "resolving",
  "downloading",
  "verifying",
  "paused",
];

const ACTIVE_INSTALL_STATES: readonly EngineInstall["state"][] = [
  "resolving",
  "downloading",
  "verifying",
  "extracting",
];

/** Engine names as a person says them. `EngineKind` is the adapter's id. */
const ENGINE_LABEL: Record<string, string> = {
  llama_cpp: "llama.cpp",
  vllm: "vLLM",
  mlx: "MLX",
};

export function engineLabel(engine: string): string {
  return ENGINE_LABEL[engine] ?? engine;
}

export function tasksFrom(sources: TaskSources): Task[] {
  return [
    ...downloadTasks(sources.downloads),
    ...installTasks(sources.installs),
    ...loadTasks(sources.runtimes, sources.localRuntimes),
    ...scanTasks(sources.scan),
  ];
}

/**
 * The tray's list: the browser's own runs first — they are the person's
 * most recent action — then what the endpoints report, minus the rows a
 * run already tells the story of (`Task.claims`).
 */
export function mergeTasks(endpoint: Task[], runs: Task[]): Task[] {
  const engines = new Set<string>();
  const runtimes = new Set<string>();
  for (const run of runs) {
    if (run.claims?.engine) engines.add(`install:${run.claims.engine}`);
    if (run.claims?.runtime) runtimes.add(run.claims.runtime);
  }
  const rest = endpoint.filter((task) => {
    if (task.kind === "install" && engines.has(task.id)) return false;
    if (task.kind === "load") {
      const slash = task.id.indexOf("/");
      const runtime = slash >= 0 ? task.id.slice(slash + 1) : task.id;
      if (runtimes.has(runtime)) return false;
    }
    return true;
  });
  return [...runs, ...rest];
}

// --- downloads --------------------------------------------------------

export function isActiveDownload(download: Download): boolean {
  return ACTIVE_DOWNLOAD_STATES.includes(download.state);
}

function downloadTasks(list: DownloadList | null): Task[] {
  return (list?.downloads ?? []).filter(isActiveDownload).map((d) => {
    const total = d.bytesTotal ?? 0;
    const got = d.bytesDownloaded ?? 0;
    const fraction = total > 0 ? Math.min(1, got / total) : undefined;
    return {
      id: `download:${d.id}`,
      kind: "download",
      title: `Downloading ${d.repo} ${downloadFileLabel(d)}`.trimEnd(),
      detail: downloadDetail(d, fraction),
      ...(fraction !== undefined ? { progress: fraction } : {}),
      // Downloads are acted on (pause, resume, cancel) where they are
      // started; the same panel is on Library too.
      href: "/discover",
    };
  });
}

/** The file a person recognises: the basename of a one-file download,
 * or "N files" for a sharded one. */
function downloadFileLabel(d: Download): string {
  if (d.files.length === 1) {
    const only = d.files[0];
    return only ? basename(only.destinationPath || only.path) : "";
  }
  return d.files.length > 1 ? `(${d.files.length} files)` : "";
}

function downloadDetail(d: Download, fraction: number | undefined): string {
  const parts: string[] = [];
  switch (d.state) {
    case "queued":
      return "waiting its turn";
    case "resolving":
      return "asking where the file is";
    case "verifying":
      return "checking the file";
    case "paused":
      parts.push("paused");
      break;
    default:
      break;
  }
  if (fraction !== undefined) parts.push(`${Math.round(fraction * 100)}%`);
  if (d.state === "downloading") {
    if (d.bytesPerSecond) parts.push(`${formatBytesShort(d.bytesPerSecond)}/s`);
    if (d.etaSeconds != null && d.etaSeconds > 0)
      parts.push(`${formatDuration(d.etaSeconds)} left`);
  }
  return parts.join(" · ");
}

// --- engine installs --------------------------------------------------

function installTasks(installs: EngineInstall[] | null): Task[] {
  return (installs ?? [])
    .filter((i) => ACTIVE_INSTALL_STATES.includes(i.state))
    .map((i) => {
      const total = i.bytesTotal ?? 0;
      const got = i.bytesDownloaded ?? 0;
      // Bytes describe only the download phase; a progress bar during
      // `extracting` would sit at 100% while the disk works, which reads
      // as stuck. So the bar shows during the download and goes away.
      const fraction =
        i.state === "downloading" && total > 0 ? Math.min(1, got / total) : undefined;
      return {
        id: `install:${i.engine}`,
        kind: "install",
        title: `Installing ${engineLabel(i.engine)}${i.version ? ` ${i.version}` : ""}`,
        detail: installDetail(i, fraction),
        ...(fraction !== undefined ? { progress: fraction } : {}),
        href: "/inference",
      };
    });
}

function installDetail(i: EngineInstall, fraction: number | undefined): string {
  switch (i.state) {
    case "resolving":
      return "finding the right build for this machine";
    case "downloading":
      return fraction !== undefined
        ? `${Math.round(fraction * 100)}% of ${formatBytesShort(i.bytesTotal ?? 0)}`
        : "downloading";
    case "verifying":
      return "checking the download";
    case "extracting":
      return "unpacking";
    default:
      return i.message ?? "";
  }
}

// --- model loads ------------------------------------------------------

function loadTasks(runtimes: RuntimePlacementList | null, local: RuntimeList | null): Task[] {
  // The root's list names the node; the agent's own is this machine, and
  // the tray says so rather than inventing a name for it.
  const rows: { node: string | null; name: string; model: string | null; status: string | null }[] =
    runtimes
      ? (runtimes.runtimes ?? []).map((r) => ({
          node: r.node,
          name: r.name,
          model: r.modelAlias ?? null,
          status: r.status ?? null,
        }))
      : (local?.runtimes ?? []).map((r) => ({
          node: r.node ?? null,
          name: r.name,
          model: r.modelAlias ?? null,
          status: r.status,
        }));
  return rows
    .filter((r) => r.status === "starting" || r.status === "loading")
    .map((r) => ({
      id: `load:${r.node ?? ""}/${r.name}`,
      kind: "load",
      title: `Loading ${r.model ?? r.name} on ${r.node ?? "this machine"}`,
      detail: r.status === "starting" ? "starting the engine" : "reading the model into memory",
      href: "/inference",
    }));
}

// --- library scan -----------------------------------------------------

function scanTasks(scan: Scan | null): Task[] {
  if (!scan || scan.state !== "scanning") return [];
  const parts: string[] = [];
  if (scan.filesScanned != null) parts.push(`${scan.filesScanned.toLocaleString()} files so far`);
  if (scan.currentPath) parts.push(basename(scan.currentPath));
  return [
    {
      id: "scan",
      kind: "scan",
      title: "Scanning your model folders",
      detail: parts.join(" · "),
      href: "/library",
    },
  ];
}

// --- formatting -------------------------------------------------------

/** The last path segment, whichever way the host spells its separators. */
export function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut < 0 ? trimmed : trimmed.slice(cut + 1);
}

/** `38 MB`, `1.2 GB`: decimal units, one figure past ten. Kept here
 * rather than borrowed from `FitBadge` so this module stays free of
 * React, which is what lets it be tested as data. */
export function formatBytesShort(count: number): string {
  if (!count || count < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log10(count) / 3), units.length - 1);
  if (index === 0) return `${Math.round(count)} B`;
  const value = count / 1000 ** index;
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

/** `45 s`, `4 min`, `1 h 20 min`: what a person wants from an estimate. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}
