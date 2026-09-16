/**
 * One-click run: a model goes from a file on disk to `ready` with one
 * button and at most one question (hobbyist UX §7 S3, decisions #5 and #6).
 *
 * ## What it replaces
 *
 * §0.5 of the design measured three concepts standing between a
 * downloaded file and a running model: an *engine* ("no binary is
 * installed. Install one from the Inference page" -- four clicks away
 * and back), a *profile* ("Launching from here needs one" -- three clicks
 * for a noun the person does not have yet), and *where to look* ("Watch
 * it load on the Inference page"). Every step was something the system
 * already did; this module is the orchestration and the one place it is
 * reported.
 *
 * ## The steps, in order
 *
 *   1. **checking** -- ask the target node which engines it has. An
 *      engine that can load the file and is installed ends the question.
 *   2. **awaiting-install** -- none is installed but one can be fetched:
 *      *"I could not find llama.cpp on this machine. Install it now?"*
 *      Install is the default; Skip is for advanced users and leaves the
 *      runtime declared but not started (Troy's amendment to #6). The
 *      only question the flow ever asks, and it is asked only when it
 *      must be.
 *   3. **installing** -- the agent's own install (`POST
 *      /v1/engines/{engine}/install`), polled here, with the bytes.
 *   4. **settings** -- a profile named `default` at the context that
 *      fits, made only when the model has none for this engine.
 *   5. **launching** -- the declaration, or a `start` when the runtime
 *      already exists (which is exactly the state Skip leaves behind, so
 *      pressing Run again after installing by hand does the right thing).
 *   6. **loading** -- the runtime's own status, polled until `ready`.
 *
 * **Nothing new on the agent or the library.** Every call here existed
 * before this slice; the profile the library stores is the same profile
 * the editor would have made, and the runtime is the same runtime.
 *
 * ## Why a module-level store
 *
 * A run outlives the screen that started it -- an engine install is a
 * few hundred megabytes and a large quant loads for minutes -- and the
 * design's P7 says background work is visible everywhere. So the run is
 * not component state: it lives here, the header tray renders it on
 * every screen, and the card that pressed Run renders the same object.
 * A full page reload loses this framing and nothing else: the install
 * and the runtime are then visible through the endpoints the tray polls
 * anyway. That is the honest cost of "nothing new on the agent", and it
 * is recorded in the design's §11.4.
 *
 * ## Words
 *
 * The person's, not the architecture's (P5): "install", "settings",
 * "starting", "reading the model into memory", "ready". A component's
 * own failure sentence is relayed verbatim -- it names the fix -- and a
 * step that failed is named, so "the install failed" and "the model
 * crashed" are never one message.
 */

import { useSyncExternalStore } from "react";

import { ApiError, api, describeError } from "./api";
import {
  DEFAULT_PROFILE_NAME,
  composeSpec,
  contextPrefill,
  defaultProfileSpec,
  runtimeName,
} from "./launchSpec";
import type { TargetNode } from "./nodeBudget";
import { engineLabel, formatBytesShort, type Task } from "./tasks";
import type {
  Admission,
  Download,
  EngineDescriptor,
  EngineInstall,
  EngineList,
  LibraryModel,
  ModelProfile,
  ModelProfileList,
  Runtime,
  RuntimeList,
  RuntimePlacement,
  RuntimeStatus,
} from "./types";

export type RunStep =
  /** Fetching the file first. Only a run that began as "Download and
   * run" passes through this; a run of a model already on disk starts
   * at `checking`. */
  | "downloading"
  | "checking"
  | "awaiting-install"
  | "installing"
  | "settings"
  | "launching"
  | "loading"
  | "ready"
  | "skipped"
  | "failed";

/** Which step a failure belongs to; "names which one failed if one does". */
export type FailedStep = "download" | "check" | "install" | "settings" | "launch" | "load";

/** What a run needs to know about the transfer it is waiting on. */
export interface RunDownload {
  id: string;
  repo: string;
  /** The basename a person recognises. */
  file: string;
  bytesTotal: number | null;
  bytesDownloaded: number | null;
  state: string;
}

export interface RunModel {
  /**
   * The local model's id — **empty while a chained run is still
   * downloading**, because the model does not exist until the file
   * lands and the library's post-download scan names it. Everything
   * that keys off a model id has to tolerate that, which is why
   * `findRun` scans rather than looking up by key.
   */
  id: string;
  name: string;
  path: string;
  format: string;
  contextLength: number | null;
}

export interface RunNode {
  /** Proxy target that reaches the node's agent: `agent` or `node:<name>`. */
  target: string;
  /** What to print: the node's name, or "this machine". */
  label: string;
  /** Install name; null for an unenrolled single host. */
  name: string | null;
  local: boolean;
}

export interface RunTask {
  id: string;
  model: RunModel;
  node: RunNode;
  step: RunStep;
  failedStep: FailedStep | null;
  /** The engine chosen or being installed, once known. */
  engine: string | null;
  /** The agent's install record while installing, for the bytes. */
  install: EngineInstall | null;
  /** The transfer this run is waiting on, while it is waiting. */
  download: RunDownload | null;
  /** The runtime's name once declared or found. */
  runtime: string | null;
  runtimeStatus: RuntimeStatus | null;
  /** The failure, in the component's words when it wrote them. */
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  /**
   * Which start this is. Ids are per model per node, so a run started
   * after an earlier one was forgotten reuses the id; the orchestrator
   * of the earlier one, if it is still between two polls, must not
   * mistake the new task for its own. It checks this, not the id.
   */
  generation: number;
}

export type InstallAnswer = "install" | "skip";

export interface RunOptions {
  /** How often the install and the runtime are asked. */
  pollMs?: number;
  /** How long a load may take before the task gives up watching. */
  loadBudgetMs?: number;
  /** How long a finished (ready / skipped) task stays in the tray. */
  settleMs?: number;
}

const DEFAULTS: Required<RunOptions> = {
  pollMs: 1500,
  // A 24 GB file over gigabit takes four minutes (library-folders-run.md);
  // a much larger one off a NAS could take a quarter of an hour. Past an
  // hour something is wedged and Inference is where to look.
  loadBudgetMs: 60 * 60 * 1000,
  settleMs: 45_000,
};

/** Consecutive poll failures tolerated before a run gives up on a node. */
const MAX_POLL_FAILURES = 10;

// --- the store ----------------------------------------------------------

const tasks = new Map<string, RunTask>();
const listeners = new Set<() => void>();
const answers = new Map<string, (answer: InstallAnswer | "cancel") => void>();
const settleTimers = new Map<string, ReturnType<typeof setTimeout>>();
let generations = 0;
let snapshot: RunTask[] = [];
const EMPTY: RunTask[] = [];

function emit(): void {
  snapshot = [...tasks.values()].sort((a, b) => b.startedAt - a.startedAt);
  for (const listener of listeners) listener();
}

export function subscribeRuns(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getRuns(): RunTask[] {
  return snapshot;
}

/** The runs, for React: re-renders when any changes. */
export function useRuns(): RunTask[] {
  return useSyncExternalStore(subscribeRuns, getRuns, () => EMPTY);
}

export function runId(modelId: string, target: string): string {
  return `run:${modelId}@${target}`;
}

/**
 * A run for this model on this node, whatever key it is filed under.
 *
 * A scan rather than a lookup, because a chained run is filed under its
 * DOWNLOAD's id until the file lands and the model gets one — and the
 * moment it does, the Library and Home would otherwise offer Run for a
 * model that is already being run by the task above it.
 */
export function findRunFor(modelId: string, target: string): RunTask | null {
  if (!modelId) return null;
  for (const task of tasks.values()) {
    if (task.model.id === modelId && task.node.target === target) return task;
  }
  return null;
}

export function findRun(modelId: string, target: string): RunTask | null {
  return tasks.get(runId(modelId, target)) ?? null;
}

export function isTerminal(step: RunStep): boolean {
  return step === "ready" || step === "skipped" || step === "failed";
}

function update(id: string, patch: Partial<RunTask>): void {
  const current = tasks.get(id);
  if (!current) return;
  tasks.set(id, { ...current, ...patch });
  emit();
}

/** Forget a task. Terminal ones only from the UI; the orchestrator stops
 * at its next step when its task is gone, whatever the step was. */
export function dismissRun(id: string): void {
  const timer = settleTimers.get(id);
  if (timer) clearTimeout(timer);
  settleTimers.delete(id);
  const pending = answers.get(id);
  if (pending) {
    answers.delete(id);
    pending("cancel");
  }
  if (tasks.delete(id)) emit();
}

/** The person's answer to the one question. Ignored when nothing is asking. */
export function answerInstall(id: string, answer: InstallAnswer): void {
  const resolve = answers.get(id);
  if (!resolve) return;
  answers.delete(id);
  resolve(answer);
}

/** For tests: every run gone, every timer cleared. */
export function resetRunsForTests(): void {
  for (const timer of settleTimers.values()) clearTimeout(timer);
  settleTimers.clear();
  for (const resolve of answers.values()) resolve("cancel");
  answers.clear();
  tasks.clear();
  emit();
}

export function runNodeOf(node: TargetNode): RunNode {
  return {
    target: node.target,
    label: node.local ? (node.name ?? "this machine") : node.label,
    name: node.name,
    local: node.local,
  };
}

export function runModelOf(model: LibraryModel): RunModel {
  return {
    id: model.id,
    name: model.name,
    path: model.path,
    format: model.format,
    contextLength: model.contextLength ?? null,
  };
}

/**
 * Run `model` on `node`. Returns the task id. A run already in progress
 * for the same model on the same node is returned rather than doubled; a
 * finished one is replaced.
 */
export function startRun(model: LibraryModel, node: TargetNode, options: RunOptions = {}): string {
  const id = runId(model.id, node.target);
  const existing = tasks.get(id);
  if (existing && !isTerminal(existing.step)) return id;
  dismissRun(id);
  const task: RunTask = {
    id,
    model: runModelOf(model),
    node: runNodeOf(node),
    step: "checking",
    failedStep: null,
    engine: null,
    install: null,
    download: null,
    runtime: null,
    runtimeStatus: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
    generation: ++generations,
  };
  tasks.set(id, task);
  emit();
  void orchestrate(task, model, { ...DEFAULTS, ...options });
  return id;
}

/** What `startDownloadAndRun` fetches: one repo, one file. */
export interface RunDownloadSpec {
  repo: string;
  file: string;
  /** For the tray line before the download record comes back. */
  label: string;
  sizeBytes?: number | null;
  format?: string;
}

/**
 * **Download and run** — §6.3's one action, as one task.
 *
 * Posts the download with `runWhenReady`, which is what makes the intent
 * outlive this tab: a 16 GB transfer takes long enough that the person
 * will close the laptop, and a console opening later claims the record
 * and carries on from `resumeRun`. Here, with the tab still open, the
 * same task simply continues into the ordinary run.
 *
 * Keyed by the DOWNLOAD's id, because the model has none until the file
 * lands.
 */
export function startDownloadAndRun(
  spec: RunDownloadSpec,
  node: TargetNode,
  options: RunOptions = {},
): string {
  const id = `dl:${spec.repo}/${spec.file}@${node.target}`;
  const existing = tasks.get(id);
  if (existing && !isTerminal(existing.step)) return id;
  dismissRun(id);
  const task: RunTask = {
    id,
    model: {
      id: "",
      name: spec.label,
      path: "",
      format: spec.format ?? "gguf",
      contextLength: null,
    },
    node: runNodeOf(node),
    step: "downloading",
    failedStep: null,
    engine: null,
    install: null,
    download: {
      id: "",
      repo: spec.repo,
      file: spec.file,
      bytesTotal: spec.sizeBytes ?? null,
      bytesDownloaded: 0,
      state: "queued",
    },
    runtime: null,
    runtimeStatus: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
    generation: ++generations,
  };
  tasks.set(id, task);
  emit();
  void orchestrateDownload(task, spec, { ...DEFAULTS, ...options });
  return id;
}

/**
 * Continue what a previous console started: a finished download whose
 * intent this browser has already claimed.
 *
 * The claim is the caller's to make and to have won — this function
 * does not check, because checking again would be a second claim and
 * the answer would be `false`.
 */
export function resumeRun(
  download: Download,
  node: TargetNode,
  options: RunOptions = {},
): string | null {
  const modelId = download.modelId;
  if (!modelId) return null;
  const id = runId(modelId, node.target);
  const existing = tasks.get(id);
  if (existing && !isTerminal(existing.step)) return id;
  dismissRun(id);
  const task: RunTask = {
    id,
    model: {
      id: modelId,
      name: downloadLabel(download),
      path: "",
      format: "gguf",
      contextLength: null,
    },
    node: runNodeOf(node),
    step: "checking",
    failedStep: null,
    engine: null,
    install: null,
    download: null,
    runtime: null,
    runtimeStatus: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
    generation: ++generations,
  };
  tasks.set(id, task);
  emit();
  void continueFromModel(task, modelId, { ...DEFAULTS, ...options });
  return id;
}

/** The basename a person recognises, out of a download record. */
export function downloadLabel(download: Download): string {
  const first = (download.files ?? [])[0];
  const path = first?.destinationPath || first?.path || download.repo;
  return path.split(/[\\/]/).pop() || download.repo;
}

async function orchestrateDownload(
  started: RunTask,
  spec: RunDownloadSpec,
  options: Required<RunOptions>,
): Promise<void> {
  const { id, generation } = started;
  const live: Live = () => tasks.get(id)?.generation === generation;
  const patch: Patch = (p) => {
    if (live()) update(id, p);
  };
  const failNow = (step: FailedStep, error: string): void => {
    patch({ step: "failed", failedStep: step, error, finishedAt: Date.now() });
  };

  let record: Download;
  try {
    record = await api.post<Download>("library", "/v1/downloads", {
      repo: spec.repo,
      files: [spec.file],
      runWhenReady: true,
    });
  } catch (err) {
    return failNow("download", `Could not start the download: ${describeError(err)}`);
  }
  if (!live()) return;
  patch({ download: runDownloadOf(record) });

  // Watch it. The record is the truth, not this loop: if the tab closes,
  // `runWhenReady` is still on the record and another console picks it up.
  let current = record;
  while (live() && !DOWNLOAD_TERMINAL.includes(current.state)) {
    await sleep(options.pollMs);
    if (!live()) return;
    try {
      current = await api.get<Download>("library", `/v1/downloads/${enc(record.id)}`);
    } catch {
      // A missed poll is not a failed download. The next one may answer,
      // and if it never does the tray row simply stops moving.
      continue;
    }
    patch({ download: runDownloadOf(current) });
  }
  if (!live()) return;
  if (current.state !== "done") {
    return failNow(
      "download",
      `The download ${current.state === "cancelled" ? "was cancelled" : "failed"}${
        current.message ? `: ${current.message}` : ""
      }`,
    );
  }

  // The library scans after a completed transfer and names the entry.
  // Without the id there is no model to run, so wait a bounded while.
  let modelId = current.modelId ?? "";
  for (let i = 0; !modelId && i < 40 && live(); i += 1) {
    await sleep(options.pollMs);
    try {
      current = await api.get<Download>("library", `/v1/downloads/${enc(record.id)}`);
      modelId = current.modelId ?? "";
    } catch {
      /* keep waiting */
    }
  }
  if (!live()) return;
  if (!modelId) {
    return failNow(
      "download",
      "The file downloaded, but the library has not catalogued it yet. It is on disk — " +
        "run it from the Library once the scan finishes.",
    );
  }

  // Ours already: nobody else can have claimed it, because this tab has
  // been holding the record since it was created. Claim it anyway, so
  // the flag comes down and a console opening tomorrow does not start a
  // second run of a model this one is already running.
  try {
    await api.post("library", `/v1/downloads/${enc(record.id)}/claim`, {});
  } catch {
    // A claim that could not be made is not a reason to stop: this tab
    // is the one running it, and the worst case is a duplicate the
    // orchestrator below already refuses.
  }
  if (!live()) return;
  patch({ download: null, step: "checking", model: { ...started.model, id: modelId } });
  await continueFromModel(tasks.get(id)!, modelId, options);
}

/** Fetch the library's record for a model, then run it. */
async function continueFromModel(
  task: RunTask,
  modelId: string,
  options: Required<RunOptions>,
): Promise<void> {
  const { id, generation } = task;
  const live: Live = () => tasks.get(id)?.generation === generation;
  let model: LibraryModel;
  try {
    model = await api.get<LibraryModel>("library", `/v1/models/${enc(modelId)}`);
  } catch (err) {
    if (!live()) return;
    return update(id, {
      step: "failed",
      failedStep: "check",
      error: `Could not read the model back from the library: ${describeError(err)}`,
      finishedAt: Date.now(),
    });
  }
  if (!live()) return;
  update(id, { model: runModelOf(model) });
  await orchestrate(tasks.get(id)!, model, options);
}

function runDownloadOf(record: Download): RunDownload {
  return {
    id: record.id,
    repo: record.repo,
    file: downloadLabel(record),
    bytesTotal: record.bytesTotal ?? null,
    bytesDownloaded: record.bytesDownloaded ?? null,
    state: record.state,
  };
}

const DOWNLOAD_TERMINAL = ["done", "failed", "cancelled"];

/**
 * Downloads that were started in order to run something, finished, and
 * that nobody is running — the work a console picks up when the tab
 * that asked for it is long gone.
 *
 * Pure, so the cases that matter can be asserted without a browser: the
 * one that has already been claimed, the one whose run is still in
 * flight in this tab, and the one the person cancelled.
 */
export function pendingChainedRuns(
  downloads: readonly Download[],
  runs: readonly RunTask[],
  target: string,
): Download[] {
  const busy = new Set(
    runs.filter((r) => r.node.target === target && !isTerminal(r.step)).map((r) => r.model.id),
  );
  return downloads.filter(
    (d) => d.state === "done" && d.runWhenReady === true && !!d.modelId && !busy.has(d.modelId),
  );
}

/**
 * Claim each and run what we won. Returns the ids started.
 *
 * **The claim is what makes this safe to call from every console**, and
 * it is a write: two browsers polling the same install both see the same
 * finished download, and exactly one of them gets `claimed: true`. A
 * claim that fails for any other reason is skipped rather than retried
 * into a loop — the next poll will try again.
 */
export async function resumeClaimedRuns(
  downloads: readonly Download[],
  runs: readonly RunTask[],
  node: TargetNode,
  options: RunOptions = {},
): Promise<string[]> {
  const started: string[] = [];
  for (const download of pendingChainedRuns(downloads, runs, node.target)) {
    let claimed = false;
    try {
      const outcome = await api.post<{ claimed?: boolean }>(
        "library",
        `/v1/downloads/${enc(download.id)}/claim`,
        {},
      );
      claimed = outcome?.claimed === true;
    } catch {
      continue;
    }
    if (!claimed) continue;
    const id = resumeRun(download, node, options);
    if (id) started.push(id);
  }
  return started;
}

// --- the orchestration --------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Is this orchestrator's task still the one in the store? */
type Live = () => boolean;
type Patch = (patch: Partial<RunTask>) => void;

const enc = encodeURIComponent;

async function orchestrate(
  started: RunTask,
  model: LibraryModel,
  options: Required<RunOptions>,
): Promise<void> {
  const { id, node, generation } = started;
  const live: Live = () => tasks.get(id)?.generation === generation;
  const patch: Patch = (p) => {
    if (live()) update(id, p);
  };
  const failNow = (step: FailedStep, error: string): void => {
    patch({ step: "failed", failedStep: step, error, finishedAt: Date.now() });
  };
  const finishNow = (step: "ready" | "skipped"): void => {
    if (!live()) return;
    update(id, { step, finishedAt: Date.now() });
    // A finished task leaves the tray on its own; a failed one stays until
    // the person has read it and dismissed it.
    const timer = setTimeout(() => {
      settleTimers.delete(id);
      const current = tasks.get(id);
      if (current?.generation === generation && current.step === step) {
        tasks.delete(id);
        emit();
      }
    }, options.settleMs);
    settleTimers.set(id, timer);
  };

  // 1. Which engines does the node have, and can any of them load this?
  let engines: EngineDescriptor[];
  try {
    engines = (await api.get<EngineList>(node.target, "/v1/engines")).engines ?? [];
  } catch (err) {
    return failNow(
      "check",
      `Could not ask ${node.label} which engines it has: ${describeError(err)}`,
    );
  }
  if (!live()) return;
  const capable = engines.filter((e) => (e.modelFormats ?? []).includes(model.format));
  if (capable.length === 0) {
    return failNow("check", noEngineForFormat(model, node, engines));
  }

  let engine: EngineDescriptor | null = capable.find((e) => e.available) ?? null;
  let skipped = false;
  if (engine === null) {
    // 2. Nothing installed. Can this machine fetch one? Ask first.
    const candidate = capable.find((e) => e.acquisition?.installable) ?? null;
    if (candidate === null) {
      return failNow("check", cannotInstall(capable, node));
    }
    patch({ step: "awaiting-install", engine: candidate.engine });
    const answer = await waitForAnswer(id);
    if (answer === "cancel" || !live()) {
      // Cancelled: `dismissRun` has already forgotten the task.
      return;
    }
    if (answer === "install") {
      // 3. The agent's install, watched from here.
      patch({ step: "installing" });
      const outcome = await installEngine(live, patch, node, candidate.engine, options);
      if (!live()) return;
      if ("failed" in outcome) return failNow("install", outcome.failed);
      engine = outcome;
    } else {
      skipped = true;
      engine = candidate;
    }
  }
  const kind = engine.engine;

  // 4. Settings: the profile this launch uses, made if the model has none.
  patch({ step: "settings", engine: kind });
  let profile: ModelProfile;
  try {
    profile = await ensureProfile(model, node, kind);
  } catch (err) {
    return failNow("settings", `Could not save settings for ${model.name}: ${describeError(err)}`);
  }
  if (!live()) return;

  // 5. Launch: start the runtime this file already has, or declare one.
  patch({ step: "launching" });
  let name = runtimeName(model, profile);
  try {
    const existing = await findRuntime(node, model, kind);
    if (!live()) return;
    if (existing) {
      name = existing.name;
      patch({ runtime: name, runtimeStatus: existing.status });
      if (existing.status === "ready") return finishNow("ready");
      if (skipped) return finishNow("skipped");
      if (existing.status !== "starting" && existing.status !== "loading") {
        await api.post(node.target, `/v1/runtimes/${enc(name)}/start`, {});
      }
    } else {
      const spec = composeSpec(model, profile, { autoStart: !skipped });
      name = spec.name;
      if (node.local || node.name === null) {
        await api.post<Runtime>("agent", "/v1/runtimes", spec);
      } else {
        // Another node: through the control root, which forwards the
        // declaration to that node's agent and records it in the
        // install's topology (the profile editor's rule).
        await api.post<RuntimePlacement>("control", "/v1/runtimes", { node: node.name, spec });
      }
      patch({ runtime: name });
      if (skipped) return finishNow("skipped");
    }
  } catch (err) {
    return failNow("launch", describeError(err));
  }

  // 6. Wait for the engine to say it is serving.
  patch({ step: "loading" });
  const deadline = Date.now() + options.loadBudgetMs;
  let failures = 0;
  while (live()) {
    await sleep(options.pollMs);
    if (!live()) return;
    let runtime: Runtime;
    try {
      runtime = await api.get<Runtime>(node.target, `/v1/runtimes/${enc(name)}`);
      failures = 0;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return failNow(
          "load",
          `${node.label} no longer lists ${model.name}; it was removed while starting.`,
        );
      }
      if (++failures >= MAX_POLL_FAILURES) {
        return failNow(
          "load",
          `Lost contact with ${node.label} while ${model.name} was starting: ${describeError(err)}`,
        );
      }
      continue;
    }
    if (!live()) return;
    patch({ runtimeStatus: runtime.status });
    if (runtime.status === "ready") return finishNow("ready");
    if (runtime.status === "crashed") {
      return failNow(
        "load",
        runtime.lastError ?? `${model.name} stopped unexpectedly while starting.`,
      );
    }
    if (Date.now() > deadline) {
      return failNow(
        "load",
        `${model.name} is still ${runtime.status} after ${Math.round(options.loadBudgetMs / 60_000)} minutes. Inference shows what the engine is doing.`,
      );
    }
  }
}

/**
 * The agent's install, started (or joined, on a 409) and polled to a
 * terminal state, then confirmed by asking for the engines again.
 * Returns the descriptor now reporting the engine available, or the
 * reason it did not -- the component's own sentence, unprefixed; the
 * step name is added when it is shown.
 */
async function installEngine(
  live: Live,
  patch: Patch,
  node: RunNode,
  engine: string,
  options: Required<RunOptions>,
): Promise<EngineDescriptor | { failed: string }> {
  const label = engineLabel(engine);
  try {
    const started = await api.post<EngineInstall>(
      node.target,
      `/v1/engines/${enc(engine)}/install`,
      {},
    );
    patch({ install: started });
  } catch (err) {
    // 409: one is already running (started from Inference, or another
    // browser). Watching it is the right thing; starting another is not.
    if (!(err instanceof ApiError && err.status === 409)) {
      return { failed: describeError(err) };
    }
  }
  let failures = 0;
  while (live()) {
    await sleep(options.pollMs);
    if (!live()) return { failed: "cancelled" };
    let state: EngineInstall;
    try {
      state = await api.get<EngineInstall>(node.target, `/v1/engines/${enc(engine)}/install`);
      failures = 0;
    } catch (err) {
      if (++failures >= MAX_POLL_FAILURES) {
        return { failed: `lost contact with ${node.label}: ${describeError(err)}` };
      }
      continue;
    }
    patch({ install: state });
    if (state.state === "done") break;
    if (state.state === "failed") {
      return { failed: state.error ?? state.message ?? "the agent gave no reason" };
    }
    if (state.state === "cancelled") return { failed: "the install was cancelled" };
  }
  if (!live()) return { failed: "cancelled" };
  // Installed is not the same as found: confirm the agent now sees it.
  try {
    const list = await api.get<EngineList>(node.target, "/v1/engines");
    const found = (list.engines ?? []).find((e) => e.engine === engine) ?? null;
    if (found?.available) return found;
    return {
      failed: `${label} was installed, but ${node.label} still cannot find it${
        found?.error ? `: ${found.error}` : "."
      }`,
    };
  } catch (err) {
    return {
      failed: `${label} was installed, but ${node.label} could not be asked about it afterwards: ${describeError(err)}`,
    };
  }
}

/**
 * The profile this launch uses: the model's default for this engine, else
 * its first for this engine, else a new `default` at the context that
 * fits -- asked of the target node's admission dry run with the flags
 * the profile would otherwise start empty (the profile form's rule).
 */
async function ensureProfile(
  model: LibraryModel,
  node: RunNode,
  engine: string,
): Promise<ModelProfile> {
  const base = `/v1/models/${enc(model.id)}/profiles`;
  const list = await api.get<ModelProfileList>("library", base);
  const profiles = list.profiles ?? [];
  const forEngine = profiles.filter((p) => p.engine === engine);
  const pick = forEngine.find((p) => p.default) ?? forEngine[0] ?? null;
  if (pick) return pick;

  let suggestion: number | null = null;
  try {
    const answer = await api.post<Admission>(node.target, "/v1/runtimes/admission", {
      name: "context-probe",
      engine,
      modelPath: model.path,
      autoStart: false,
    });
    suggestion = contextPrefill(answer.maxContextLength, model.contextLength);
  } catch {
    // No number to start from: the engine's own default applies, and
    // the launch's admission says so if that does not fit.
    suggestion = null;
  }
  const spec = defaultProfileSpec(engine as ModelProfile["engine"], suggestion);
  // A profile for another engine may already hold the name; a second
  // engine's default is named for its engine, and does not steal the flag.
  if (profiles.some((p) => p.name === DEFAULT_PROFILE_NAME)) {
    spec.name = `${DEFAULT_PROFILE_NAME}-${engine}`;
  }
  spec.default = profiles.length === 0;
  return api.post<ModelProfile>("library", base, spec);
}

/** The runtime already declared for this file with this engine on this
 * node, if any -- which is what Skip leaves, and what a second Run finds. */
async function findRuntime(
  node: RunNode,
  model: LibraryModel,
  engine: string,
): Promise<Runtime | null> {
  try {
    const list = await api.get<RuntimeList>(node.target, "/v1/runtimes");
    return (
      (list.runtimes ?? []).find((r) => r.modelPath === model.path && r.engine === engine) ?? null
    );
  } catch {
    // Unknown is not "none": the declaration below will 409 on a name
    // collision and that sentence is relayed.
    return null;
  }
}

function waitForAnswer(id: string): Promise<InstallAnswer | "cancel"> {
  return new Promise((resolve) => {
    answers.set(id, resolve);
  });
}

// --- sentences ------------------------------------------------------------

function noEngineForFormat(
  model: LibraryModel,
  node: RunNode,
  engines: EngineDescriptor[],
): string {
  const known = engines.map((e) => engineLabel(e.engine)).join(", ");
  const hint =
    model.format === "safetensors"
      ? " A safetensors model needs vLLM, which is installed by hand; GGUF files run on llama.cpp."
      : "";
  return `Nothing on ${node.label} can load a ${model.format} model${
    known ? ` (it has ${known})` : ""
  }.${hint}`;
}

function cannotInstall(capable: EngineDescriptor[], node: RunNode): string {
  const first = capable[0]!;
  const label = engineLabel(first.engine);
  const reason = first.acquisition?.reason;
  const manual = first.acquisition?.manualInstall;
  const parts = [`${label} is not installed on ${node.label}, and Eugene cannot install it there`];
  if (reason) parts.push(`: ${reason}`);
  else parts.push(".");
  if (manual?.command) parts.push(` To install it yourself: ${manual.command}`);
  if (manual?.docsUrl) parts.push(` (${manual.docsUrl})`);
  return parts.join("");
}

/** The step a failure is named after, in the person's words. */
function stepWord(task: RunTask): string {
  const label = engineLabel(task.engine ?? "llama_cpp");
  switch (task.failedStep) {
    case "check":
      return "Checking";
    case "install":
      return `Installing ${label}`;
    case "settings":
      return "Saving settings";
    case "launch":
      return "Starting";
    case "load":
      return "Loading";
    default:
      return "Running";
  }
}

/** One line under the title, per step. */
export function describeRunDetail(task: RunTask): { detail: string; progress?: number } {
  const label = engineLabel(task.engine ?? "llama_cpp");
  switch (task.step) {
    case "downloading": {
      const d = task.download;
      const total = d?.bytesTotal ?? 0;
      const got = d?.bytesDownloaded ?? 0;
      const fraction = total > 0 ? Math.min(1, got / total) : undefined;
      return {
        detail:
          fraction !== undefined
            ? `downloading · ${Math.round(fraction * 100)}% of ${formatBytesShort(total)}`
            : "downloading",
        ...(fraction !== undefined ? { progress: fraction } : {}),
      };
    }
    case "checking":
      return { detail: `asking ${task.node.label} what it has` };
    case "awaiting-install":
      return { detail: `waiting for your answer: install ${label}?` };
    case "installing": {
      const i = task.install;
      if (!i) return { detail: `installing ${label}` };
      const total = i.bytesTotal ?? 0;
      const got = i.bytesDownloaded ?? 0;
      const fraction =
        i.state === "downloading" && total > 0 ? Math.min(1, got / total) : undefined;
      const phase =
        i.state === "resolving"
          ? "finding the right build for this machine"
          : i.state === "downloading"
            ? fraction !== undefined
              ? `${Math.round(fraction * 100)}% of ${formatBytesShort(total)}`
              : "downloading"
            : i.state === "verifying"
              ? "checking the download"
              : i.state === "extracting"
                ? "unpacking"
                : (i.message ?? i.state);
      return {
        detail: `installing ${label}${i.version ? ` ${i.version}` : ""} · ${phase}`,
        ...(fraction !== undefined ? { progress: fraction } : {}),
      };
    }
    case "settings":
      return { detail: "choosing settings that fit" };
    case "launching":
      return { detail: "starting" };
    case "loading":
      return {
        detail:
          task.runtimeStatus === "loading"
            ? "reading the model into memory"
            : task.runtimeStatus === "starting"
              ? "starting the engine"
              : "waiting for the engine to start",
      };
    case "ready":
      return { detail: "ready — try it on Home" };
    case "skipped":
      return {
        detail: `not started: ${label} is not installed on ${task.node.label}. It is listed on Inference as stopped; install the engine there and press start.`,
      };
    case "failed":
      return { detail: `${stepWord(task)} failed: ${task.error ?? "no reason was given"}` };
    default:
      return { detail: "" };
  }
}

/** Where a click on the task goes: the screen that can act on it. */
export function runHref(task: RunTask): string {
  switch (task.step) {
    case "ready":
      return "/";
    case "downloading":
      return "/discover";
    case "settings":
    case "checking":
    case "awaiting-install":
      return task.model.id ? `/library?model=${enc(task.model.id)}` : "/";
    case "failed":
      return task.failedStep === "settings" || task.failedStep === "check"
        ? `/library?model=${enc(task.model.id)}`
        : "/inference";
    default:
      return "/inference";
  }
}

/** A run as the tray shows it: one line, plain words, a bar while the
 * install downloads, a dismiss for the person once it has failed. */
export function runTask(task: RunTask): Task {
  const { detail, progress } = describeRunDetail(task);
  return {
    id: task.id,
    kind: "run",
    title:
      task.step === "downloading"
        ? `Getting ${task.model.name} to run on ${task.node.label}`
        : `Run ${task.model.name} on ${task.node.label}`,
    detail,
    ...(progress !== undefined ? { progress } : {}),
    href: runHref(task),
    tone: task.step === "failed" ? "error" : task.step === "ready" ? "ok" : undefined,
    claims: {
      // Same for the transfer: §6.3 asks for ONE task-tray entry for
      // "download and run", and this is how it is one — the run's row
      // absorbs the download's for as long as it is waiting on it.
      ...(task.step === "downloading" && task.download?.id ? { download: task.download.id } : {}),
      // While this run installs the engine or starts the runtime, the
      // tray's own rows for the same install and load say the same thing
      // twice; the run's row is the one with the step in it.
      ...(task.step === "installing" && task.engine && task.node.local
        ? { engine: task.engine }
        : {}),
      ...(task.runtime && (task.step === "launching" || task.step === "loading")
        ? { runtime: task.runtime }
        : {}),
    },
    ...(isTerminal(task.step) ? { dismiss: () => dismissRun(task.id) } : {}),
  };
}
