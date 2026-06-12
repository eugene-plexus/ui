"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError, api } from "@/lib/api";

/**
 * Training tab — the operator surface for the local-LLM-training platform.
 *
 * Left: the list of TrainingProjects (the reusable "model you are building").
 * Right: the selected project — its config summary, a Start-pipeline button,
 * the live pipeline run (stages: data prep → tokenizer → training → eval →
 * serve, each delegated to a peer component by the coordinator), and run
 * history.
 *
 * The coordinator owns projects + pipeline runs; the create form populates its
 * dataset / tokenizer / eval-suite pickers from the `data` and `eval`
 * components. Live progress is polled from the coordinator's poll-friendly
 * `GET /pipeline-runs/{id}` (every transition is persisted server-side); the
 * SSE `/events` endpoint exists too but polling is simpler and sufficient here.
 *
 * Spec shapes are hand-typed (the platform yamls aren't in the UI's codegen
 * list yet — same pattern as IdentityPanel/ConnectorPanel). Swap for generated
 * types if coordinator/data/eval get added to scripts/codegen.
 */

/* ───────────────────────────── spec shapes ─────────────────────────────── */

type TrainingGoal =
  | "pretrain_from_scratch"
  | "continue_pretraining"
  | "finetune"
  | "train_adapter"
  | "evaluate"
  | "serve";

type RecipeKind = "pretraining" | "continued_pretraining" | "sft" | "lora" | "qlora" | "dpo";

type PipelineStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

type StageKind = "data_prep" | "tokenizer" | "training" | "eval" | "serve";

interface ArchitectureConfig {
  modelType: "decoder_only";
  nLayer: number;
  nHead: number;
  nEmbd: number;
  blockSize: number;
  vocabSize: number;
}

interface ModelTemplate {
  name: string;
  displayName?: string;
  architecture: ArchitectureConfig;
}

interface DatasetRef {
  datasetId: string;
  name?: string | null;
}

interface TokenizerRef {
  tokenizerId: string;
  name?: string | null;
  vocabSize?: number | null;
}

interface EvalSuiteRef {
  evalSuiteId: string;
  name?: string | null;
}

interface CheckpointRef {
  checkpointId: string;
}

interface TrainingRecipe {
  kind: RecipeKind;
  baseCheckpoint?: CheckpointRef | null;
}

interface Hyperparameters {
  batchSize?: number | null;
  maxSteps?: number | null;
}

interface HardwareTopology {
  mode: "cpu" | "single_gpu" | "multi_gpu" | "multi_node";
}

interface ExportSettings {
  autoServeOnComplete?: boolean;
}

interface TrainingProject {
  projectId: string;
  name: string;
  goal: TrainingGoal;
  description?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  modelTemplate?: ModelTemplate | null;
  tokenizer?: TokenizerRef | null;
  datasets?: DatasetRef[] | null;
  recipe?: TrainingRecipe | null;
  hyperparameters?: Hyperparameters | null;
  hardware?: HardwareTopology | null;
  evalSuites?: EvalSuiteRef[] | null;
  exportSettings?: ExportSettings | null;
  latestRunId?: string | null;
  latestRunStatus?: string | null;
}

interface PipelineStage {
  kind: StageKind;
  status: PipelineStatus;
  component?: string | null;
  resourceId?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  detail?: string | null;
}

interface PipelineRun {
  pipelineRunId: string;
  projectId: string;
  status: PipelineStatus;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  currentStage?: string | null;
  stages: PipelineStage[];
  lastError?: string | null;
}

interface ProjectsResponse {
  projects: TrainingProject[];
}

interface PipelineRunsResponse {
  pipelineRuns: PipelineRun[];
}

// data / eval list shapes (subset used to populate the create form).
interface DatasetManifest {
  datasetId: string;
  name: string;
  status?: string | null;
  vocabFingerprint?: string | null;
}

interface TokenizerSpec {
  tokenizerId: string;
  name: string;
  vocabSize?: number | null;
  status?: string | null;
}

interface EvalSuite {
  evalSuiteId: string;
  name: string;
}

/* ───────────────────────────── constants ─────────────────────────────── */

const GOAL_LABELS: Record<TrainingGoal, string> = {
  pretrain_from_scratch: "Pretrain from scratch",
  continue_pretraining: "Continue pretraining",
  finetune: "Fine-tune",
  train_adapter: "Train adapter (LoRA)",
  evaluate: "Evaluate only",
  serve: "Serve only",
};

const TRAINING_GOALS: TrainingGoal[] = [
  "pretrain_from_scratch",
  "continue_pretraining",
  "finetune",
  "train_adapter",
];

const RECIPE_KIND_FOR: Record<TrainingGoal, RecipeKind> = {
  pretrain_from_scratch: "pretraining",
  continue_pretraining: "continued_pretraining",
  finetune: "sft",
  train_adapter: "lora",
  evaluate: "sft",
  serve: "sft",
};

interface TemplatePreset {
  key: string;
  label: string;
  displayName: string;
  architecture: ArchitectureConfig;
}

// Built-in architecture presets (mirrors the wizard's hardcoded provider
// catalog pattern). vocabSize is overridden by the chosen tokenizer at submit.
const TINY_PRESET: TemplatePreset = {
  key: "tiny",
  label: "Tiny — debug (4 layers, 128d)",
  displayName: "Tiny",
  architecture: {
    modelType: "decoder_only",
    nLayer: 4,
    nHead: 4,
    nEmbd: 128,
    blockSize: 256,
    vocabSize: 8192,
  },
};

const TEMPLATE_PRESETS: TemplatePreset[] = [
  TINY_PRESET,
  {
    key: "small",
    label: "Small (12 layers, 768d)",
    displayName: "Small",
    architecture: {
      modelType: "decoder_only",
      nLayer: 12,
      nHead: 12,
      nEmbd: 768,
      blockSize: 1024,
      vocabSize: 32000,
    },
  },
  {
    key: "medium",
    label: "Medium (24 layers, 1024d)",
    displayName: "Medium",
    architecture: {
      modelType: "decoder_only",
      nLayer: 24,
      nHead: 16,
      nEmbd: 1024,
      blockSize: 2048,
      vocabSize: 32000,
    },
  },
];

const TERMINAL_STATUSES = new Set<PipelineStatus>(["completed", "failed", "cancelled"]);

const STAGE_ORDER: StageKind[] = ["data_prep", "tokenizer", "training", "eval", "serve"];

const STAGE_LABELS: Record<StageKind, string> = {
  data_prep: "Data prep",
  tokenizer: "Tokenizer",
  training: "Training",
  eval: "Eval",
  serve: "Serve",
};

function isTrainingGoal(goal: TrainingGoal): boolean {
  return TRAINING_GOALS.includes(goal);
}

function isTerminal(status: PipelineStatus | string | undefined | null): boolean {
  return TERMINAL_STATUSES.has(status as PipelineStatus);
}

/* ───────────────────────────── panel root ─────────────────────────────── */

export function TrainingPanel() {
  const [projects, setProjects] = useState<TrainingProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const resp = await api.get<ProjectsResponse>("coordinator", "/v1/coordinator/projects");
      setProjects(resp.projects ?? []);
    } catch (e) {
      setLoadError(formatError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selected = projects.find((p) => p.projectId === selectedId) ?? null;

  return (
    <div className="flex h-full">
      {/* project list */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-[color:var(--border)] bg-[color:var(--panel-soft)]">
        <header className="flex items-center justify-between border-b border-[color:var(--border)] px-3 py-3">
          <h2 className="font-ui text-sm font-semibold">Projects</h2>
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setSelectedId(null);
            }}
            className="font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-2.5 py-1 text-xs font-medium text-[color:var(--on-accent-left)] hover:brightness-110"
          >
            + New
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-2">
          {loadError && (
            <p className="status-error mb-2 rounded-[var(--radius)] border px-3 py-2 text-xs">
              {loadError}
            </p>
          )}
          {loading && projects.length === 0 && (
            <p className="px-2 py-1 text-xs text-[color:var(--muted)]">Loading projects…</p>
          )}
          {!loading && projects.length === 0 && !loadError && (
            <p className="px-2 py-1 text-xs text-[color:var(--muted)]">
              No projects yet. Click <span className="font-mono">+ New</span> to build a model.
            </p>
          )}
          {projects.map((p) => (
            <button
              key={p.projectId}
              type="button"
              onClick={() => {
                setSelectedId(p.projectId);
                setCreating(false);
              }}
              className={`mb-1 flex w-full flex-col items-start rounded-[var(--radius)] px-3 py-2 text-left transition-colors ${
                selectedId === p.projectId
                  ? "bg-[color:var(--accent-left)] text-[color:var(--on-accent-left)]"
                  : "hover:bg-[color:var(--panel-hover)]"
              }`}
            >
              <span className="font-ui truncate text-sm font-medium">{p.name}</span>
              <span
                className={`font-mono text-[10px] ${
                  selectedId === p.projectId ? "opacity-80" : "text-[color:var(--muted)]"
                }`}
              >
                {GOAL_LABELS[p.goal] ?? p.goal}
                {p.latestRunStatus ? ` · ${p.latestRunStatus}` : ""}
              </span>
            </button>
          ))}
        </div>
        <footer className="border-t border-[color:var(--border)] p-2">
          <button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Refresh
          </button>
        </footer>
      </aside>

      {/* detail / create */}
      <div className="flex-1 overflow-y-auto">
        {creating ? (
          <CreateProjectForm
            onCancel={() => setCreating(false)}
            onCreated={(project) => {
              setCreating(false);
              // Seed the server-minted project into local state immediately so
              // the detail pane resolves without waiting on (or being hidden by
              // a failure of) the list refetch — mirrors startPipeline's
              // optimistic prepend. reload() then reconciles.
              setProjects((prev) => [
                project,
                ...prev.filter((p) => p.projectId !== project.projectId),
              ]);
              setSelectedId(project.projectId);
              void reload();
            }}
          />
        ) : selected ? (
          <ProjectDetail
            key={selected.projectId}
            project={selected}
            onDeleted={() => {
              setSelectedId(null);
              void reload();
            }}
            onRunChanged={() => void reload()}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <p className="max-w-sm text-sm text-[color:var(--muted)]">
              Select a project to view its pipeline, or create a new one. A project describes a
              model you are building — its template, datasets, tokenizer, and how it&rsquo;s
              evaluated and served.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── project detail ─────────────────────────────── */

function ProjectDetail({
  project,
  onDeleted,
  onRunChanged,
}: {
  project: TrainingProject;
  onDeleted: () => void;
  onRunChanged: () => void;
}) {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [viewRunId, setViewRunId] = useState<string | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // `quiet` refreshes (the background interval) don't toggle the loading
  // state, so the run list doesn't flicker "Loading…" every few seconds.
  const reloadRuns = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoadingRuns(true);
      try {
        const resp = await api.get<PipelineRunsResponse>(
          "coordinator",
          `/v1/coordinator/projects/${project.projectId}/pipeline-runs`,
        );
        const list = resp.pipelineRuns ?? [];
        setRuns(list);
        // Follow the live run: keep watching the run we're on if it's still
        // active; otherwise jump to whichever run is active now (e.g. one
        // started out-of-band); when nothing is active, keep the current
        // (manual history) selection or default to the newest.
        setViewRunId((current) => {
          if (current) {
            const cur = list.find((r) => r.pipelineRunId === current);
            if (cur && !isTerminal(cur.status)) return current;
          }
          const active = list.find((r) => !isTerminal(r.status));
          if (active) return active.pipelineRunId;
          return current ?? list[0]?.pipelineRunId ?? null;
        });
      } catch (e) {
        if (!quiet) setError(formatError(e));
      } finally {
        if (!quiet) setLoadingRuns(false);
      }
    },
    [project.projectId],
  );

  useEffect(() => {
    void reloadRuns();
  }, [reloadRuns]);

  // Background poll of the run LIST (not just the viewed run) so a run started
  // out-of-band — another tab, the connector, the CLI — shows up here, and
  // activeRun (which gates the Start button) stays accurate. The viewed run is
  // polled at a finer cadence by PipelineRunView; this is the coarser sweep.
  useEffect(() => {
    const interval = setInterval(() => void reloadRuns(true), 4000);
    return () => clearInterval(interval);
  }, [reloadRuns]);

  // Keep the history list fresh as the viewed run progresses.
  const handleRunUpdate = useCallback((run: PipelineRun) => {
    setRuns((prev) => {
      const idx = prev.findIndex((r) => r.pipelineRunId === run.pipelineRunId);
      if (idx === -1) return [run, ...prev];
      const next = [...prev];
      next[idx] = run;
      return next;
    });
  }, []);

  async function startPipeline() {
    setStarting(true);
    setError(null);
    try {
      const run = await api.post<PipelineRun>(
        "coordinator",
        `/v1/coordinator/projects/${project.projectId}/pipeline`,
        {},
      );
      setRuns((prev) => [run, ...prev.filter((r) => r.pipelineRunId !== run.pipelineRunId)]);
      setViewRunId(run.pipelineRunId);
      onRunChanged();
    } catch (e) {
      setError(formatError(e));
      // A 409 means a run is already active (possibly started out-of-band) —
      // re-sync the list so activeRun reflects it and the Start button
      // disables instead of inviting repeated 409s.
      void reloadRuns(true);
    } finally {
      setStarting(false);
    }
  }

  async function deleteProject() {
    setDeleting(true);
    setError(null);
    try {
      await api.delete("coordinator", `/v1/coordinator/projects/${project.projectId}`);
      onDeleted();
    } catch (e) {
      setError(formatError(e));
      setDeleting(false);
      setDeleteConfirm(false);
    }
  }

  const activeRun = runs.find((r) => !isTerminal(r.status)) ?? null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-4 border-b border-[color:var(--border)] bg-[color:var(--panel)] px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-ui truncate text-base font-semibold">{project.name}</h2>
          <p className="text-[11px] text-[color:var(--muted)]">
            {GOAL_LABELS[project.goal] ?? project.goal}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void startPipeline()}
            disabled={starting || activeRun != null}
            title={
              activeRun != null
                ? "A pipeline run is already active for this project."
                : "Run the pipeline: data prep → tokenizer → training → eval → serve."
            }
            className="font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1.5 text-xs font-medium text-[color:var(--on-accent-left)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {starting ? "Starting…" : activeRun != null ? "Pipeline running…" : "Start pipeline"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        {error && (
          <p className="status-error mb-4 rounded-[var(--radius)] border px-3 py-2 text-xs">
            {error}
          </p>
        )}

        <ProjectSummary project={project} />

        <section className="mt-6">
          <h3 className="font-ui mb-2 text-xs font-semibold tracking-wide text-[color:var(--muted)] uppercase">
            Pipeline run
          </h3>
          {loadingRuns && runs.length === 0 ? (
            <p className="text-xs text-[color:var(--muted)]">Loading runs…</p>
          ) : runs.length === 0 ? (
            <p className="rounded-[var(--radius)] border border-dashed border-[color:var(--border)] px-3 py-4 text-xs text-[color:var(--muted)]">
              No pipeline runs yet. Click <span className="font-mono">Start pipeline</span> to run
              this project end-to-end.
            </p>
          ) : viewRunId ? (
            <PipelineRunView
              key={viewRunId}
              runId={viewRunId}
              onUpdate={handleRunUpdate}
              onAfterCancel={onRunChanged}
            />
          ) : null}
        </section>

        {runs.length > 1 && (
          <section className="mt-6">
            <h3 className="font-ui mb-2 text-xs font-semibold tracking-wide text-[color:var(--muted)] uppercase">
              History
            </h3>
            <ul className="divide-y divide-[color:var(--border)] rounded-[var(--radius)] border border-[color:var(--border)]">
              {runs.map((r) => (
                <li key={r.pipelineRunId}>
                  <button
                    type="button"
                    onClick={() => setViewRunId(r.pipelineRunId)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-[color:var(--panel-hover)] ${
                      r.pipelineRunId === viewRunId ? "bg-[color:var(--panel-hover)]" : ""
                    }`}
                  >
                    <span className="font-mono text-[11px] text-[color:var(--muted)]">
                      {r.createdAt
                        ? new Date(r.createdAt).toLocaleString()
                        : r.pipelineRunId.slice(0, 8)}
                    </span>
                    <StatusBadge status={r.status} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-8 border-t border-[color:var(--border)] pt-4">
          {deleteConfirm ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[color:var(--muted)]">
                Delete this project? (Runs already produced keep their checkpoints.)
              </span>
              <button
                type="button"
                onClick={() => void deleteProject()}
                disabled={deleting}
                className="font-ui status-error rounded-[var(--radius)] border px-3 py-1 text-xs font-medium transition-[filter] hover:brightness-110 disabled:opacity-40"
              >
                {deleting ? "Deleting…" : "Yes, delete"}
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirm(false)}
                disabled={deleting}
                className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setDeleteConfirm(true)}
              className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs text-[color:var(--muted)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] hover:text-[color:var(--foreground)]"
            >
              Delete project
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

function ProjectSummary({ project }: { project: TrainingProject }) {
  const datasetCount = project.datasets?.length ?? 0;
  const suiteCount = project.evalSuites?.length ?? 0;
  const rows: [string, string][] = [
    ["Template", project.modelTemplate?.displayName ?? project.modelTemplate?.name ?? "—"],
    ["Tokenizer", project.tokenizer?.name ?? (project.tokenizer ? "selected" : "—")],
    ["Datasets", datasetCount > 0 ? `${datasetCount} selected` : "—"],
    ["Eval suites", suiteCount > 0 ? `${suiteCount} selected` : "—"],
    ["Hardware", project.hardware?.mode ?? "—"],
    ["Auto-serve", project.exportSettings?.autoServeOnComplete ? "on" : "off"],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] p-4 text-xs sm:grid-cols-3">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="font-mono text-[10px] tracking-wider text-[color:var(--muted)] uppercase">
            {label}
          </dt>
          <dd className="font-ui mt-0.5 truncate">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ───────────────────────────── run view (polled) ─────────────────────────────── */

function PipelineRunView({
  runId,
  onUpdate,
  onAfterCancel,
}: {
  runId: string;
  onUpdate: (run: PipelineRun) => void;
  onAfterCancel: () => void;
}) {
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Poll until terminal. Recursive setTimeout (not setInterval) so a slow
  // response never overlaps the next poll; backs off on transient error.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const fresh = await api.get<PipelineRun>(
          "coordinator",
          `/v1/coordinator/pipeline-runs/${runId}`,
        );
        if (cancelled) return;
        setRun(fresh);
        setError(null);
        onUpdate(fresh);
        if (!isTerminal(fresh.status)) timer = setTimeout(poll, 1500);
      } catch (e) {
        if (cancelled) return;
        setError(formatError(e));
        timer = setTimeout(poll, 2500);
      }
    }
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, onUpdate]);

  async function cancel() {
    setCancelling(true);
    setError(null);
    try {
      const updated = await api.post<PipelineRun>(
        "coordinator",
        `/v1/coordinator/pipeline-runs/${runId}/cancel`,
        {},
      );
      setRun(updated);
      onUpdate(updated);
      onAfterCancel();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setCancelling(false);
    }
  }

  if (!run) {
    return <p className="text-xs text-[color:var(--muted)]">Loading run…</p>;
  }

  const running = !isTerminal(run.status);
  // The spinner means "actively making progress" — not merely non-terminal.
  // A `paused` run is non-terminal (cancellable) but not progressing, so it
  // shows its status badge without an animated spinner.
  const inProgress = run.status === "running" || run.status === "pending";
  // Render stages in canonical order even if the server omits/reorders.
  const byKind = new Map(run.stages.map((s) => [s.kind, s]));
  const stages = STAGE_ORDER.map((k) => byKind.get(k)).filter((s): s is PipelineStage => s != null);

  return (
    <div className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)]">
      <div className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <StatusBadge status={run.status} />
          {inProgress && <Spinner />}
          {run.currentStage && running && (
            <span className="font-mono text-[11px] text-[color:var(--muted)]">
              at {run.currentStage}
            </span>
          )}
        </div>
        {running && (
          <button
            type="button"
            onClick={() => void cancel()}
            disabled={cancelling}
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs text-[color:var(--muted)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] hover:text-[color:var(--foreground)] disabled:opacity-40"
          >
            {cancelling ? "Cancelling…" : "Cancel"}
          </button>
        )}
      </div>

      <ul className="divide-y divide-[color:var(--border)]">
        {stages.map((stage) => (
          <StageRow key={stage.kind} stage={stage} />
        ))}
      </ul>

      {run.lastError && (
        <p className="status-error m-3 rounded-[var(--radius)] border px-3 py-2 text-xs">
          {run.lastError}
        </p>
      )}
      {error && (
        <p className="status-error m-3 rounded-[var(--radius)] border px-3 py-2 text-xs">{error}</p>
      )}
    </div>
  );
}

function StageRow({ stage }: { stage: PipelineStage }) {
  return (
    <li className="flex items-start justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-ui text-sm font-medium">
            {STAGE_LABELS[stage.kind] ?? stage.kind}
          </span>
          {stage.component && (
            <span className="font-mono text-[10px] text-[color:var(--muted)]">
              {stage.component}
            </span>
          )}
        </div>
        {stage.detail && (
          <p className="mt-0.5 truncate font-mono text-[11px] text-[color:var(--muted)]">
            {stage.detail}
          </p>
        )}
      </div>
      <StatusBadge status={stage.status} />
    </li>
  );
}

function StatusBadge({ status }: { status: PipelineStatus | string }) {
  const cls = statusClass(status);
  return (
    <span
      className={`shrink-0 rounded-[var(--radius)] border px-1.5 py-0.5 font-mono text-[9px] uppercase ${
        cls || "border-[color:var(--border)] text-[color:var(--muted)]"
      }`}
    >
      {status}
    </span>
  );
}

function statusClass(status: PipelineStatus | string): string {
  switch (status) {
    case "completed":
      return "status-success";
    case "failed":
      return "status-error";
    case "running":
    case "pending":
    case "paused":
      return "status-warn";
    default:
      // cancelled / skipped / unknown → muted (handled by the badge fallback).
      return "";
  }
}

function Spinner() {
  return (
    <span
      aria-label="running"
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[color:var(--border)] border-t-[color:var(--accent-left)]"
    />
  );
}

/* ───────────────────────────── create form ─────────────────────────────── */

function CreateProjectForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (project: TrainingProject) => void;
}) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState<TrainingGoal>("pretrain_from_scratch");
  const [templateKey, setTemplateKey] = useState(TINY_PRESET.key);
  const [tokenizerId, setTokenizerId] = useState("");
  const [datasetIds, setDatasetIds] = useState<Set<string>>(new Set());
  const [suiteIds, setSuiteIds] = useState<Set<string>>(new Set());
  const [maxSteps, setMaxSteps] = useState("1000");
  const [batchSize, setBatchSize] = useState("8");
  const [hardwareMode, setHardwareMode] = useState<HardwareTopology["mode"]>("single_gpu");
  const [autoServe, setAutoServe] = useState(true);
  const [baseCheckpointId, setBaseCheckpointId] = useState("");

  const [datasets, setDatasets] = useState<DatasetManifest[]>([]);
  const [tokenizers, setTokenizers] = useState<TokenizerSpec[]>([]);
  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [resourceNote, setResourceNote] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Populate the pickers from the data + eval components. Each source is
  // tolerated independently — a component being down just yields an empty
  // picker + a note, never a broken form.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const notes: string[] = [];
      const [ds, tk, sv] = await Promise.allSettled([
        api.get<{ datasets: DatasetManifest[] }>("data", "/v1/data/datasets"),
        api.get<{ tokenizers: TokenizerSpec[] }>("data", "/v1/data/tokenizers"),
        api.get<{ suites: EvalSuite[] }>("eval", "/v1/eval/suites"),
      ]);
      if (cancelled) return;
      if (ds.status === "fulfilled") setDatasets(ds.value.datasets ?? []);
      else notes.push("datasets");
      if (tk.status === "fulfilled") {
        const list = tk.value.tokenizers ?? [];
        setTokenizers(list);
        const first = list[0];
        if (first) setTokenizerId((cur) => cur || first.tokenizerId);
      } else notes.push("tokenizers");
      if (sv.status === "fulfilled") setSuites(sv.value.suites ?? []);
      else notes.push("eval suites");
      if (notes.length > 0) {
        setResourceNote(
          `Couldn't reach: ${notes.join(", ")}. Those pickers may be empty — start the matching component, or create resources there first.`,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const training = isTrainingGoal(goal);
  const needsBase = goal !== "pretrain_from_scratch";
  const showEval = training || goal === "evaluate";
  const showServe = training || goal === "serve";

  const canSubmit =
    name.trim().length > 0 &&
    (!training || (tokenizerId !== "" && datasetIds.size > 0)) &&
    (!needsBase || baseCheckpointId.trim().length > 0) &&
    (goal !== "evaluate" || suiteIds.size > 0);

  function toggle(set: Set<string>, id: string, apply: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  }

  function buildProject(): TrainingProject {
    const preset = TEMPLATE_PRESETS.find((p) => p.key === templateKey) ?? TINY_PRESET;
    const tok = tokenizers.find((t) => t.tokenizerId === tokenizerId);
    const project: TrainingProject = {
      projectId: crypto.randomUUID(),
      name: name.trim(),
      goal,
      createdAt: new Date().toISOString(),
      recipe: needsBase
        ? { kind: RECIPE_KIND_FOR[goal], baseCheckpoint: { checkpointId: baseCheckpointId.trim() } }
        : { kind: RECIPE_KIND_FOR[goal] },
    };

    if (training) {
      project.modelTemplate = {
        name: preset.key,
        displayName: preset.displayName,
        // The tokenizer determines the real vocab size the trainer validates;
        // override the preset's placeholder with the chosen tokenizer's.
        architecture: {
          ...preset.architecture,
          vocabSize: tok?.vocabSize ?? preset.architecture.vocabSize,
        },
      };
      project.tokenizer = tok
        ? { tokenizerId: tok.tokenizerId, name: tok.name, vocabSize: tok.vocabSize }
        : { tokenizerId };
      project.datasets = [...datasetIds].map((id) => ({
        datasetId: id,
        name: datasets.find((d) => d.datasetId === id)?.name,
      }));
      const steps = Number.parseInt(maxSteps, 10);
      const batch = Number.parseInt(batchSize, 10);
      project.hyperparameters = {
        maxSteps: Number.isFinite(steps) ? steps : undefined,
        batchSize: Number.isFinite(batch) ? batch : undefined,
      };
      project.hardware = { mode: hardwareMode };
    }

    if (showEval && suiteIds.size > 0) {
      project.evalSuites = [...suiteIds].map((id) => ({
        evalSuiteId: id,
        name: suites.find((s) => s.evalSuiteId === id)?.name,
      }));
    }
    if (showServe) {
      project.exportSettings = { autoServeOnComplete: goal === "serve" ? true : autoServe };
    }
    return project;
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const created = await api.post<TrainingProject>(
        "coordinator",
        "/v1/coordinator/projects",
        buildProject(),
      );
      onCreated(created);
    } catch (e) {
      setError(formatError(e));
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[color:var(--border)] bg-[color:var(--panel)] px-5 py-4">
        <h2 className="font-ui text-base font-semibold">New project</h2>
      </header>
      <div className="flex-1 overflow-y-auto p-5">
        <div className="mx-auto flex max-w-xl flex-col gap-4">
          {resourceNote && (
            <p className="status-warn rounded-[var(--radius)] border px-3 py-2 text-xs">
              {resourceNote}
            </p>
          )}

          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              placeholder="my-first-model"
              className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--accent-left)]"
            />
          </Field>

          <Field label="Goal">
            <select
              value={goal}
              onChange={(e) => setGoal(e.target.value as TrainingGoal)}
              disabled={saving}
              className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--accent-left)]"
            >
              {(Object.keys(GOAL_LABELS) as TrainingGoal[]).map((g) => (
                <option key={g} value={g}>
                  {GOAL_LABELS[g]}
                </option>
              ))}
            </select>
          </Field>

          {needsBase && (
            <Field
              label="Base checkpoint id"
              hint="The checkpoint to continue from / evaluate / serve (a trainer checkpointId)."
            >
              <input
                type="text"
                value={baseCheckpointId}
                onChange={(e) => setBaseCheckpointId(e.target.value)}
                disabled={saving}
                placeholder="checkpoint UUID"
                className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5 font-mono text-xs outline-none focus:border-[color:var(--accent-left)]"
              />
            </Field>
          )}

          {training && (
            <>
              <Field label="Model template">
                <select
                  value={templateKey}
                  onChange={(e) => setTemplateKey(e.target.value)}
                  disabled={saving}
                  className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--accent-left)]"
                >
                  {TEMPLATE_PRESETS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="Tokenizer"
                hint="Trained in the Data component. Sets the model's vocab size."
              >
                {tokenizers.length === 0 ? (
                  <p className="rounded-[var(--radius)] border border-dashed border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--muted)]">
                    No tokenizers found. Train one in the Data component first.
                  </p>
                ) : (
                  <select
                    value={tokenizerId}
                    onChange={(e) => setTokenizerId(e.target.value)}
                    disabled={saving}
                    className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--accent-left)]"
                  >
                    {tokenizers.map((t) => (
                      <option key={t.tokenizerId} value={t.tokenizerId}>
                        {t.name}
                        {t.vocabSize ? ` (vocab ${t.vocabSize})` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </Field>

              <Field label="Datasets" hint="One or more prepared datasets to train on.">
                <CheckList
                  items={datasets.map((d) => ({
                    id: d.datasetId,
                    label: d.name,
                    note: d.status ?? undefined,
                  }))}
                  selected={datasetIds}
                  onToggle={(id) => toggle(datasetIds, id, setDatasetIds)}
                  emptyText="No datasets found. Import + pretokenize one in the Data component."
                  disabled={saving}
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Max steps">
                  <input
                    type="number"
                    min={1}
                    value={maxSteps}
                    onChange={(e) => setMaxSteps(e.target.value)}
                    disabled={saving}
                    className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--accent-left)]"
                  />
                </Field>
                <Field label="Batch size">
                  <input
                    type="number"
                    min={1}
                    value={batchSize}
                    onChange={(e) => setBatchSize(e.target.value)}
                    disabled={saving}
                    className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--accent-left)]"
                  />
                </Field>
              </div>

              <Field label="Hardware">
                <select
                  value={hardwareMode}
                  onChange={(e) => setHardwareMode(e.target.value as HardwareTopology["mode"])}
                  disabled={saving}
                  className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-1.5 text-sm outline-none focus:border-[color:var(--accent-left)]"
                >
                  <option value="cpu">CPU</option>
                  <option value="single_gpu">Single GPU</option>
                  <option value="multi_gpu">Multi-GPU</option>
                </select>
              </Field>
            </>
          )}

          {showEval && (
            <Field
              label="Eval suites"
              hint={
                goal === "evaluate"
                  ? "Required for an evaluate-only project."
                  : "Optional — score the trained checkpoint."
              }
            >
              <CheckList
                items={suites.map((s) => ({ id: s.evalSuiteId, label: s.name }))}
                selected={suiteIds}
                onToggle={(id) => toggle(suiteIds, id, setSuiteIds)}
                emptyText="No eval suites found. Create one in the Eval component."
                disabled={saving}
              />
            </Field>
          )}

          {showServe && goal !== "serve" && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoServe}
                onChange={(e) => setAutoServe(e.target.checked)}
                disabled={saving}
              />
              Auto-serve the trained model on completion
            </label>
          )}

          {error && (
            <p className="status-error rounded-[var(--radius)] border px-3 py-2 text-xs">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-4 py-1.5 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit || saving}
              className="font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-4 py-1.5 text-xs font-medium text-[color:var(--on-accent-left)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {saving ? "Creating…" : "Create project"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckList({
  items,
  selected,
  onToggle,
  emptyText,
  disabled,
}: {
  items: { id: string; label: string; note?: string }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  emptyText: string;
  disabled?: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-[var(--radius)] border border-dashed border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--muted)]">
        {emptyText}
      </p>
    );
  }
  return (
    <ul className="max-h-44 divide-y divide-[color:var(--border)] overflow-y-auto rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)]">
      {items.map((item) => (
        <li key={item.id}>
          <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-[color:var(--panel-hover)]">
            <input
              type="checkbox"
              checked={selected.has(item.id)}
              onChange={() => onToggle(item.id)}
              disabled={disabled}
            />
            <span className="font-ui truncate">{item.label}</span>
            {item.note && (
              <span className="ml-auto font-mono text-[10px] text-[color:var(--muted)]">
                {item.note}
              </span>
            )}
          </label>
        </li>
      ))}
    </ul>
  );
}

/* ───────────────────────────── helpers ─────────────────────────────── */

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="font-ui mb-1 block text-xs font-medium">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-[color:var(--muted)]">{hint}</p>}
    </div>
  );
}

function formatError(e: unknown): string {
  if (e instanceof ApiError) {
    if (typeof e.body === "object" && e.body !== null && "detail" in e.body) {
      const detail = (e.body as { detail: unknown }).detail;
      if (typeof detail === "object" && detail !== null) {
        const d = detail as { title?: string; detail?: string };
        return d.detail || d.title || `${e.status} ${e.statusText}`;
      }
      if (typeof detail === "string") return detail;
    }
    return `${e.status} ${e.statusText}`;
  }
  return e instanceof Error ? e.message : String(e);
}
