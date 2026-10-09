/** A view of durable Library run operations. The browser submits intent and
 * decisions, then observes. Downloads, profiles, installs and launches are
 * coordinated by Library and the assigned agent, including while this tab is closed. */
import { useSyncExternalStore } from "react";
import type { components as RunProtocol } from "@/generated/run-operations";
import { ApiError, api, describeError } from "./api";
import type { TargetNode } from "./nodeBudget";
import { engineLabel, formatBytesShort, type Task } from "./tasks";
import type { Download, EngineInstall, LibraryModel, RuntimeStatus } from "./types";

export type RunStep = RunProtocol["schemas"]["Operation"]["step"];
/** Where a preparation is, as the engine's node reports it (LS5). */
export type PreparationStatus = RunProtocol["schemas"]["PreparationStatus"];

/** Which step a failure belongs to; "names which one failed if one does". */
export type FailedStep =
  | "download"
  | "check"
  | "install"
  | "prepare"
  | "settings"
  | "launch"
  | "load";

/** What a preparation run asked for (LS5): the engine, and the context it
 * prepares for (null: the engine's own recommendation for the node). */
export interface RunPreparation {
  engine: string;
  contextSize: number | null;
}

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
  /** What a preparation run asked for; null for a plain Run (LS5). */
  preparing: RunPreparation | null;
  /** Where the preparation is, while the node reports it. */
  preparation: PreparationStatus | null;
  /** The model it was prepared from, once `model` is the prepared one. */
  preparedFrom: RunModel | null;
  /** The transfer this run is waiting on, while it is waiting. */
  download: RunDownload | null;
  /** The runtime's name once declared or found. */
  runtime: string | null;
  runtimeStatus: RuntimeStatus | null;
  /** The failure, in the component's words when it wrote them. */
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  /** Receipt creation timestamp, retained for task views. */
  generation: number;
}

export type InstallAnswer = "install" | "skip";

export interface RunOperation extends Pick<
  RunProtocol["schemas"]["Operation"],
  "id" | "node" | "step" | "startedAt"
> {
  intent: {
    node: string | null;
    modelId?: string | null;
    download?: {
      repo: string;
      files: string[];
      revision?: string | null;
      source?: string | null;
    } | null;
    downloadId?: string | null;
    preparation?: { engine: string; contextSize?: number | null } | null;
  };
  model: RunModel | null;
  engine: string | null;
  runtime: string | null;
  runtimeStatus: RuntimeStatus | null;
  download: Download | null;
  install: EngineInstall | null;
  preparation?: PreparationStatus | null;
  preparedFrom?: RunModel | null;
  error: string | null;
  failedStep: FailedStep | null;
  finishedAt: number | null;
}

const tasks = new Map<string, RunTask>();
const listeners = new Set<() => void>();
const pending = new Set<string>();
const unconfirmed = new Set<string>();
const nodeHints = new Map<string | null, RunNode>();
let snapshot: RunTask[] = [];
const EMPTY: RunTask[] = [];
let epoch = 0;
let revision = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let polling = false;
let localName: string | null | undefined;
const enc = encodeURIComponent;
const BASE = "/v1/run-operations";

function emit(): void {
  snapshot = [...tasks.values()].sort((a, b) => b.startedAt - a.startedAt);
  for (const listener of listeners) listener();
}

function observe(record: RunOperation): RunTask {
  const hint = nodeHints.get(record.node);
  const local = record.node === null || record.node === localName;
  const file = record.intent.download?.files[0] ?? record.download?.files?.[0]?.path ?? "model";
  return {
    id: record.id,
    node: hint ?? {
      name: record.node,
      local,
      target: local ? "agent" : `node:${record.node}`,
      label: record.node ?? "this machine",
    },
    model: record.model ?? {
      id: "",
      name: file.split("/").pop() ?? file,
      path: "",
      format: "gguf",
      contextLength: null,
    },
    step: record.step,
    engine: record.engine,
    runtime: record.runtime,
    runtimeStatus: record.runtimeStatus,
    install: record.install,
    preparing: preparingOf(record.intent),
    preparation: record.preparation ?? null,
    preparedFrom: record.preparedFrom ?? null,
    download: record.download
      ? {
          id: record.download.id,
          repo: record.download.repo,
          file: downloadLabel(record.download),
          bytesTotal: record.download.bytesTotal ?? null,
          bytesDownloaded: record.download.bytesDownloaded ?? null,
          state: record.download.state,
        }
      : null,
    error: record.error,
    failedStep: record.failedStep,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    generation: record.startedAt,
  };
}

function preparingOf(intent: RunOperation["intent"]): RunPreparation | null {
  const wanted = intent.preparation;
  return wanted ? { engine: wanted.engine, contextSize: wanted.contextSize ?? null } : null;
}

/** Public for explicit refreshes and tests; transient read failures keep the last view. */
export async function refreshRuns(): Promise<void> {
  const currentEpoch = epoch;
  const beforeWrite = revision;
  if (localName === undefined) {
    try {
      localName = (await api.get<{ name?: string | null }>("agent", "/v1/node")).name ?? null;
    } catch {
      /* retry identity next time */
    }
  }
  const response = await api.get<{ operations: RunOperation[] }>("library", BASE);
  if (currentEpoch !== epoch) return;
  if (beforeWrite !== revision) return;
  const ids = new Set(response.operations.map((r) => r.id));
  for (const id of tasks.keys())
    if (!pending.has(id) && !unconfirmed.has(id) && !ids.has(id)) tasks.delete(id);
  for (const record of response.operations) {
    unconfirmed.delete(record.id);
    // Successful rows settle out of the tray; their receipts remain on the server.
    if (
      ["ready", "skipped"].includes(record.step) &&
      record.finishedAt !== null &&
      Date.now() - record.finishedAt > 45_000
    ) {
      tasks.delete(record.id);
    } else tasks.set(record.id, observe(record));
  }
  emit();
}

function startPolling(): void {
  if (polling) return;
  polling = true;
  const currentEpoch = epoch;
  const poll = async () => {
    if (currentEpoch !== epoch) return;
    try {
      await refreshRuns();
    } catch {
      /* the server continues working while unreachable */
    }
    if (currentEpoch !== epoch) return;
    if (listeners.size || pending.size || [...tasks.values()].some((r) => !isTerminal(r.step)))
      timer = setTimeout(() => void poll(), 1500);
    else polling = false;
  };
  void poll();
}

export function subscribeRuns(listener: () => void): () => void {
  listeners.add(listener);
  startPolling();
  return () => {
    listeners.delete(listener);
  };
}
export function getRuns(): RunTask[] {
  return snapshot;
}
export function useRuns(): RunTask[] {
  return useSyncExternalStore(subscribeRuns, getRuns, () => EMPTY);
}
export function runId(modelId: string, target: string): string {
  return `run:${modelId}@${target}`;
}
export function findRunFor(modelId: string, target: string): RunTask | null {
  if (!modelId) return null;
  // A preparation is not a Run of the model it prepares (LS5): it is that
  // model's run only once its model is the prepared one.
  const matches = snapshot.filter(
    (r) =>
      r.model.id === modelId &&
      r.node.target === target &&
      (r.preparing === null || r.preparedFrom !== null),
  );
  return matches.find((r) => !isTerminal(r.step)) ?? matches[0] ?? null;
}
export const findRun = findRunFor;
export function isTerminal(step: RunStep): boolean {
  return ["ready", "skipped", "failed", "cancelled"].includes(step);
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

async function submit(
  id: string,
  intent: RunOperation["intent"],
  node: TargetNode,
  model: RunModel,
): Promise<void> {
  const currentEpoch = epoch;
  revision += 1;
  nodeHints.set(node.name, runNodeOf(node));
  if (node.local) localName = node.name;
  pending.add(id);
  tasks.set(id, {
    id,
    model,
    node: runNodeOf(node),
    step: intent.modelId ? "checking" : "downloading",
    engine: null,
    runtime: null,
    runtimeStatus: null,
    install: null,
    preparing: preparingOf(intent),
    preparation: null,
    preparedFrom: null,
    download: null,
    error: null,
    failedStep: null,
    startedAt: Date.now(),
    finishedAt: null,
    generation: epoch,
  });
  emit();
  try {
    if (node.local && intent.node === null) {
      // A failed picker read is not evidence of an unenrolled node. Resolve
      // identity before persisting work that only the assigned agent can claim.
      const identity = await api.get<{ name?: string | null }>("agent", "/v1/node");
      if (currentEpoch !== epoch) return;
      intent = { ...intent, node: identity.name ?? null };
      localName = intent.node;
      nodeHints.set(intent.node, runNodeOf({ ...node, name: intent.node }));
    }
    const record = await api.put<RunOperation>("library", `${BASE}/${enc(id)}`, intent);
    if (currentEpoch !== epoch) return;
    revision += 1;
    tasks.delete(id);
    tasks.set(record.id, observe(record));
  } catch (err) {
    if (currentEpoch !== epoch) return;
    unconfirmed.add(id);
    const task = tasks.get(id);
    if (task)
      tasks.set(id, {
        ...task,
        step: "failed",
        failedStep: "check",
        error: `Could not submit the run: ${describeError(err)}`,
        finishedAt: Date.now(),
      });
  } finally {
    if (currentEpoch === epoch) {
      pending.delete(id);
      emit();
      startPolling();
    }
  }
}

export function startRun(model: LibraryModel, node: TargetNode): string {
  const existing = findRun(model.id, node.target);
  if (existing && !isTerminal(existing.step)) return existing.id;
  const id = crypto.randomUUID();
  void submit(id, { node: node.name, modelId: model.id }, node, runModelOf(model));
  return id;
}
export interface RunDownloadSpec {
  repo: string;
  file: string;
  label: string;
  sizeBytes?: number | null;
  format?: string;
}
export function startDownloadAndRun(spec: RunDownloadSpec, node: TargetNode): string {
  const id = `dl_${crypto.randomUUID()}`;
  void submit(id, { node: node.name, download: { repo: spec.repo, files: [spec.file] } }, node, {
    id: "",
    name: spec.label,
    path: "",
    format: spec.format ?? "gguf",
    contextLength: null,
  });
  return id;
}
/** A preparation in flight for this model on this node, if one is: Run and
 * Prepare are separate actions on the same model (LS5, B54). */
export function findPreparation(modelId: string, target: string): RunTask | null {
  if (!modelId) return null;
  const matches = snapshot.filter(
    (r) =>
      r.preparing !== null &&
      (r.preparedFrom?.id ?? r.model.id) === modelId &&
      r.node.target === target,
  );
  return matches.find((r) => !isTerminal(r.step)) ?? matches[0] ?? null;
}
/** The run with this id, once the store has it. */
export function runById(id: string | null): RunTask | null {
  if (!id) return null;
  return snapshot.find((r) => r.id === id) ?? null;
}
/** Prepare a model on the Library for an engine, then run it (LS5). Asked
 * for, never implied: Run picks an engine that runs a model as it is. */
export function startPreparation(
  model: RunModel,
  node: TargetNode,
  preparation: RunPreparation,
): string {
  const existing = findPreparation(model.id, node.target);
  if (existing && !isTerminal(existing.step)) return existing.id;
  const id = `prep_${crypto.randomUUID()}`;
  void submit(
    id,
    {
      node: node.name,
      modelId: model.id,
      preparation: {
        engine: preparation.engine,
        ...(preparation.contextSize ? { contextSize: preparation.contextSize } : {}),
      },
    },
    node,
    model,
  );
  return id;
}
export interface PrepareDownloadSpec {
  repo: string;
  /** Every file of it: each shard of a split GGUF. */
  files: string[];
  /** The revision the engine pins. */
  revision: string | null;
  /** The hub; null is the Library's default (LS4). */
  source: string | null;
  label: string;
}
/** Download an engine's listed model, prepare it, then run it: the one
 * action of LS5 (library-sources-and-engines.md §5). */
export function startDownloadAndPrepare(
  spec: PrepareDownloadSpec,
  node: TargetNode,
  preparation: RunPreparation,
): string {
  const id = `dl_${crypto.randomUUID()}`;
  void submit(
    id,
    {
      node: node.name,
      download: {
        repo: spec.repo,
        files: spec.files,
        ...(spec.revision ? { revision: spec.revision } : {}),
        ...(spec.source ? { source: spec.source } : {}),
      },
      preparation: {
        engine: preparation.engine,
        ...(preparation.contextSize ? { contextSize: preparation.contextSize } : {}),
      },
    },
    node,
    { id: "", name: spec.label, path: "", format: "gguf", contextLength: null },
  );
  return id;
}
export function isDownloadAndRun(task: { kind: string; id: string }): boolean {
  return task.kind === "run" && (task.id.startsWith("dl_") || task.id.startsWith("dl:"));
}
export function downloadLabel(download: Download): string {
  const first = download.files?.[0];
  return (
    (first?.destinationPath || first?.path || download.repo).split(/[\\/]/).pop() || download.repo
  );
}
export function pendingChainedRuns(
  downloads: readonly Download[],
  runs: readonly RunTask[],
  target: string,
): Download[] {
  return downloads.filter(
    (d) =>
      d.state === "done" &&
      d.runWhenReady &&
      d.modelId &&
      !runs.some(
        (r) => r.node.target === target && r.model.id === d.modelId && !isTerminal(r.step),
      ),
  );
}
export function resumeRun(download: Download, node: TargetNode): string | null {
  if (!download.modelId) return null;
  const id = `legacy_${download.id}_${node.name ?? "local"}`
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 100);
  void submit(id, { node: node.name, downloadId: download.id }, node, {
    id: download.modelId,
    name: downloadLabel(download),
    path: "",
    format: "gguf",
    contextLength: null,
  });
  return id;
}
/** Migration only: legacy download intent is cleared by Library AFTER persisting a run. */
export async function resumeClaimedRuns(
  downloads: readonly Download[],
  runs: readonly RunTask[],
  node: TargetNode,
): Promise<string[]> {
  return pendingChainedRuns(downloads, runs, node.target)
    .map((d) => resumeRun(d, node))
    .filter((id): id is string => id !== null);
}

async function action(id: string, verb: "answer" | "cancel", body: unknown): Promise<void> {
  const currentEpoch = epoch;
  try {
    const record = await api.post<RunOperation>("library", `${BASE}/${enc(id)}/${verb}`, body);
    if (currentEpoch !== epoch) return;
    revision += 1;
    tasks.set(record.id, observe(record));
  } catch (err) {
    if (currentEpoch !== epoch) return;
    const task = tasks.get(id);
    if (task) tasks.set(id, { ...task, error: describeError(err) });
  }
  emit();
}
export function answerInstall(id: string, answer: InstallAnswer): void {
  void action(id, "answer", { answer });
}
export function cancelRun(id: string): void {
  void action(id, "cancel", {});
}
export function dismissRun(id: string): void {
  const currentEpoch = epoch;
  void api
    .delete("library", `${BASE}/${enc(id)}`)
    .then(() => {
      if (currentEpoch === epoch) {
        revision += 1;
        unconfirmed.delete(id);
        tasks.delete(id);
        emit();
      }
    })
    .catch((err) => {
      if (currentEpoch !== epoch) return;
      if (err instanceof ApiError && err.status === 404) {
        unconfirmed.delete(id);
        tasks.delete(id);
        emit();
        return;
      }
      const task = tasks.get(id);
      if (task) {
        tasks.set(id, { ...task, error: describeError(err) });
        emit();
      }
    });
}
export function resetRunsForTests(): void {
  epoch += 1;
  revision += 1;
  if (timer) clearTimeout(timer);
  timer = undefined;
  polling = false;
  localName = undefined;
  pending.clear();
  unconfirmed.clear();
  nodeHints.clear();
  tasks.clear();
  emit();
}

/** The step a failure is named after, in the person's words. */
function stepWord(task: RunTask): string {
  const label = engineLabel(task.engine ?? task.preparing?.engine ?? "llama_cpp");
  switch (task.failedStep) {
    case "check":
      return "Checking";
    case "install":
      return `Installing ${label}`;
    case "prepare":
      return `Preparing it for ${label}`;
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
  if (task.error && task.step !== "failed") return { detail: task.error };
  const label = engineLabel(task.engine ?? task.preparing?.engine ?? "llama_cpp");
  switch (task.step) {
    case "downloading": {
      const d = task.download;
      if (d?.state === "paused") return { detail: "download paused — resume on Discover" };
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
    case "preparing":
      return describePreparation(task);
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
    case "cancelled":
      return { detail: "cancelled" };
    case "failed":
      return { detail: `${stepWord(task)} failed: ${task.error ?? "no reason was given"}` };
    default:
      return { detail: "" };
  }
}

/** A preparation's line (LS5): the engine's own step, what it has written of
 * what it expects, and its last line; a bar when the total is known. */
function describePreparation(task: RunTask): { detail: string; progress?: number } {
  const label = engineLabel(task.preparing?.engine ?? task.engine ?? "strata");
  const p = task.preparation;
  if (!p) return { detail: `preparing it for ${label}` };
  if (p.state === "waiting")
    return { detail: p.message ?? "waiting for another preparation on this machine" };
  const total = p.bytesNeeded ?? 0;
  const got = p.bytesWritten ?? 0;
  const fraction = total > 0 ? Math.min(1, got / total) : undefined;
  const parts = [p.step ?? `preparing it for ${label}`];
  if (total > 0) parts.push(`${formatBytesShort(got)} of about ${formatBytesShort(total)} written`);
  if (p.message) parts.push(p.message);
  return {
    detail: parts.join(" · "),
    ...(fraction !== undefined ? { progress: fraction } : {}),
  };
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
    case "preparing":
      return task.model.id ? `/library?model=${enc(task.model.id)}` : "/";
    case "failed":
      return task.failedStep === "settings" || task.failedStep === "check"
        ? `/library?model=${enc(task.model.id)}`
        : "/inference";
    default:
      return "/inference";
  }
}

function runTitle(task: RunTask): string {
  if (task.preparing) {
    const label = engineLabel(task.preparing.engine);
    const name = task.preparedFrom?.name ?? task.model.name;
    return task.step === "downloading"
      ? `Getting ${name} to prepare for ${label} on ${task.node.label}`
      : `Prepare ${name} for ${label} on ${task.node.label}`;
  }
  return task.step === "downloading"
    ? `Getting ${task.model.name} to run on ${task.node.label}`
    : `Run ${task.model.name} on ${task.node.label}`;
}

/** A run as the tray shows it: one line, plain words, a bar while the
 * install downloads, a dismiss for the person once it has failed. */
export function runTask(task: RunTask): Task {
  const { detail, progress } = describeRunDetail(task);
  return {
    id: task.id,
    kind: "run",
    title: runTitle(task),
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
    ...(isTerminal(task.step)
      ? { dismiss: () => dismissRun(task.id) }
      : { cancel: () => cancelRun(task.id) }),
  };
}
