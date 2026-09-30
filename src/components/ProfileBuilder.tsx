"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { AskBeforeStopping } from "@/components/AskBeforeStopping";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ApiError, api, describeError } from "@/lib/api";
import { composeSpec, runtimeName, type RuntimeCreate } from "@/lib/launchSpec";
import type { TargetNode } from "@/lib/nodeBudget";
import {
  ACCURACY_LEVELS,
  DEFAULT_ACCURACY,
  builtName,
  builtSpec,
  defaultStop,
  frontier,
  latestBuildFor,
  phaseLine,
  qualityLine,
  restartLine,
  stopDetail,
  stopLabel,
} from "@/lib/profileBuild";
import type {
  EngineDescriptor,
  LibraryModel,
  MeasurementPreflight,
  ModelProfile,
  ProfileBuild,
  ProfileBuildAccuracy,
  ProfileBuildList,
} from "@/lib/types";
import { expertHint } from "@/lib/vocabulary";

/**
 * **Build settings for this machine** (PB2, `docs/design/profile-builder.md`).
 *
 * On the model's profile page, beside its profiles (Troy, call 6). The
 * person picks an accuracy level, the node measures a handful of settings
 * for a few minutes, and they pick where they want to be between faster
 * replies and a longer memory, then save it as an ordinary profile an
 * expert can still edit.
 *
 * **The job lives on the agent, not in this tab.** The panel reads the
 * node's build list, so a build started here, left, or started from
 * another browser is found again; the header tray shows it meanwhile.
 * It never runs on its own, and stops nothing without asking.
 */
export function ProfileBuilder({
  model,
  profiles,
  engines,
  node,
  onSaved,
}: {
  model: LibraryModel;
  profiles: ModelProfile[];
  engines: EngineDescriptor[];
  node: TargetNode | null;
  onSaved: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const usable =
    model.format === "gguf" &&
    model.status === "present" &&
    engines.some((e) => e.engine === "llama_cpp");
  return (
    <div className="mt-3" data-testid="profile-builder">
      <button
        type="button"
        className="action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        aria-expanded={open}
        disabled={!usable || !node}
        onClick={() => setOpen(!open)}
        data-testid="profile-builder-open"
        title={expertHint(
          "Measures context size and cache precision on this machine with llama.cpp's own placement, then saves the result as a profile.",
        )}
      >
        Build settings for this machine
      </button>
      {!usable && (
        <p className="mt-1 text-sm text-[color:var(--muted)]">
          The settings builder works with GGUF models on llama.cpp.
        </p>
      )}
      {open && node && (
        <BuilderPanel
          key={node.target}
          model={model}
          profiles={profiles}
          node={node}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

function BuilderPanel({
  model,
  profiles,
  node,
  onSaved,
}: {
  model: LibraryModel;
  profiles: ModelProfile[];
  node: TargetNode;
  onSaved: () => void | Promise<void>;
}) {
  const [builds, setBuilds] = useState<ProfileBuild[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const target = node.target;

  const load = useCallback(async () => {
    try {
      const list = await api.get<ProfileBuildList>(target, "/v1/profile-builds");
      setBuilds(list.builds ?? []);
      setReadError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      setReadError(describeError(e));
    }
  }, [target]);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (alive && !document.hidden) void load();
    };
    tick();
    const timer = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [load]);

  const latest = builds ? latestBuildFor(builds, model.id) : null;
  const running = builds?.some((b) => b.state === "running") ?? false;

  if (readError && !builds) {
    return (
      <p role="alert" className="mt-2 text-sm">
        Could not read the builds on {node.label}: {readError}
      </p>
    );
  }
  if (!builds)
    return <p className="mt-2 text-sm text-[color:var(--muted)]">Reading {node.label}…</p>;

  return (
    <section
      aria-label="Build settings for this machine"
      className="mt-2 space-y-3 rounded-[var(--radius)] border border-[color:var(--border)] p-3 text-sm"
    >
      <p>
        Tries a handful of settings for this model on <strong>{node.label}</strong> for a few
        minutes, then you choose between faster replies and a longer memory. Nothing changes until
        you save.
      </p>
      {latest && latest.state === "running" && <BuildProgress build={latest} target={target} />}
      {latest && latest.state !== "running" && !fresh && (
        <BuildResult
          key={latest.id}
          build={latest}
          model={model}
          profiles={profiles}
          node={node}
          onSaved={onSaved}
          onBuildAgain={() => setFresh(true)}
        />
      )}
      {(!latest || fresh) && !(latest?.state === "running") && (
        <BuildChoice
          model={model}
          profiles={profiles}
          node={node}
          otherJobRunning={running}
          onStarted={async () => {
            setFresh(false);
            await load();
          }}
        />
      )}
    </section>
  );
}

/** The accuracy level, the profile to start from, and the expert options. */
function BuildChoice({
  model,
  profiles,
  node,
  otherJobRunning,
  onStarted,
}: {
  model: LibraryModel;
  profiles: ModelProfile[];
  node: TargetNode;
  otherJobRunning: boolean;
  onStarted: () => void | Promise<void>;
}) {
  const id = useId();
  const llama = useMemo(() => profiles.filter((p) => p.engine === "llama_cpp"), [profiles]);
  const [accuracy, setAccuracy] = useState<ProfileBuildAccuracy>(DEFAULT_ACCURACY);
  const [baseId, setBaseId] = useState<string>(
    () => (llama.find((p) => p.default) ?? llama[0])?.id ?? "",
  );
  const [margin, setMargin] = useState<string>("");
  const [text, setText] = useState<string>("");
  const [preflight, setPreflight] = useState<MeasurementPreflight | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(0);

  const base = llama.find((p) => p.id === baseId) ?? null;
  const marginMiB = margin.trim() === "" ? null : Number(margin);
  const marginValid =
    marginMiB === null || (Number.isInteger(marginMiB) && marginMiB >= 0 && marginMiB <= 65536);
  // Keyed on the model's identity, not the object: the page re-reads the
  // library, and a new object for the same model must not ask again.
  const { id: modelId, name: modelName, path: modelPath } = model;
  const request = useMemo(() => {
    const identity = { name: modelName, path: modelPath } as LibraryModel;
    const runtime: RuntimeCreate = base
      ? composeSpec(identity, base, { autoStart: false })
      : {
          name: runtimeName(identity, { name: "default", default: true }),
          engine: "llama_cpp",
          modelPath,
          autoStart: false,
        };
    return {
      modelId,
      profileId: base?.id ?? null,
      runtime,
      accuracy,
      memoryMarginMiB: marginValid ? marginMiB : null,
      evaluationText: text.trim() ? text : null,
    };
  }, [modelId, modelName, modelPath, base, accuracy, marginMiB, marginValid, text]);

  // The dry run, asked again whenever the answer could change. It changes
  // nothing on the node, so asking eagerly costs a round trip and buys a
  // Start button that never lies about what it will do.
  useEffect(() => {
    if (!marginValid) return;
    let cancelled = false;
    setAsking(true);
    void (async () => {
      try {
        const answer = await api.post<MeasurementPreflight>(
          node.target,
          "/v1/profile-builds/preflight",
          { ...request, stopRuntimes: [] },
        );
        if (!cancelled) {
          setPreflight(answer);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(describeError(e));
      } finally {
        if (!cancelled) setAsking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [node.target, request, marginValid, asked]);

  async function start(stopRuntimes: string[]) {
    setBusy(true);
    setError(null);
    try {
      await api.post<ProfileBuild>(node.target, "/v1/profile-builds", {
        ...request,
        stopRuntimes,
        restartAfter: true,
      });
      await onStarted();
    } catch (e) {
      // Something started between the question and the click: ask again
      // with the new names rather than stop what nobody agreed to.
      if (e instanceof ApiError && e.status === 409) {
        setPreflight(null);
        setAsked((n) => n + 1);
      }
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function readFile(file: File) {
    if (file.size > 2 * 1024 * 1024) {
      setError(`${file.name} is larger than 2 MB. Choose a shorter text.`);
      return;
    }
    setText(await file.text());
  }

  const chosen = ACCURACY_LEVELS.find((l) => l.id === accuracy)!;
  return (
    <div className="space-y-3" data-testid="build-choice">
      <fieldset>
        <legend className="font-ui font-semibold">Accuracy</legend>
        <div role="radiogroup" className="mt-1 flex flex-wrap gap-1">
          {ACCURACY_LEVELS.map((level) => (
            <label
              key={level.id}
              className={`cursor-pointer rounded-[var(--radius)] border px-3 py-1 ${
                accuracy === level.id
                  ? "border-[color:var(--accent-left)] bg-[color:var(--panel-hover)]"
                  : "border-[color:var(--border)]"
              }`}
            >
              <input
                type="radio"
                name={`${id}-accuracy`}
                value={level.id}
                checked={accuracy === level.id}
                onChange={() => setAccuracy(level.id)}
                className="sr-only"
              />
              {level.label}
            </label>
          ))}
        </div>
        <p className="mt-1" data-testid="accuracy-promise">
          {chosen.promise}
        </p>
      </fieldset>

      {llama.length > 0 && (
        <label className="block">
          Start from{" "}
          <select
            value={baseId}
            onChange={(e) => setBaseId(e.target.value)}
            className="ml-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] p-1"
          >
            {llama.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="">no profile (llama.cpp&rsquo;s defaults)</option>
          </select>
        </label>
      )}

      <details>
        <summary className="cursor-pointer">More options</summary>
        <div className="mt-2 space-y-2">
          <label className="block" htmlFor={`${id}-margin`}>
            Leave this much graphics memory free (MiB)
            <input
              id={`${id}-margin`}
              type="number"
              min={0}
              max={65536}
              step={1}
              value={margin}
              placeholder="1024"
              onChange={(e) => setMargin(e.target.value)}
              className="ml-2 w-24 rounded-[var(--radius)] border p-1"
            />
          </label>
          <p className="text-[color:var(--muted)]">
            Blank leaves 1024 MiB on each card, llama.cpp&rsquo;s own default. Raise it if you game
            or render on this card.
          </p>
          {!marginValid && <p role="alert">Use a whole number from 0 to 65536.</p>}
          {accuracy !== "max" && (
            <>
              <label className="block" htmlFor={`${id}-text`}>
                Your own text to measure answers on
              </label>
              <textarea
                id={`${id}-text`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                className="w-full rounded-[var(--radius)] border p-1 font-mono text-[0.75rem]"
                placeholder="Blank uses the text that comes with Eugene."
              />
              <input
                type="file"
                accept=".txt,.md,text/plain"
                aria-label="Choose a text file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void readFile(file);
                }}
              />
              <p className="text-[color:var(--muted)]">
                It needs at least 8,192 tokens, about 20 pages, and at most 2 MB. It is sent with
                the request and not kept.
              </p>
            </>
          )}
        </div>
      </details>

      {otherJobRunning && (
        <p>Another test is running on {node.label}. This one can start when it ends.</p>
      )}
      {error && (
        <p role="alert" className="status-error rounded-[var(--radius)] border px-3 py-2">
          {error}
        </p>
      )}
      <AskBeforeStopping
        preflight={preflight}
        asking={asking}
        busy={busy || otherJobRunning || !marginValid}
        startLabel="start the build"
        onStart={(names) => void start(names)}
      />
    </div>
  );
}

/** A build in flight: what it is doing, how far along, and Cancel. */
function BuildProgress({ build, target }: { build: ProfileBuild; target: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api.post<ProfileBuild>(
        target,
        `/v1/profile-builds/${encodeURIComponent(build.id)}/cancel`,
        {},
      );
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2" data-testid="build-progress">
      <p role="status">
        <strong>{phaseLine(build)}</strong>
        {build.detail && <> · {build.detail}</>}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <progress aria-label="Build progress" value={build.progress} max={1} />
        <span>{Math.round(build.progress * 100)}%</span>
        <button
          type="button"
          className="rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 disabled:opacity-40"
          disabled={busy}
          onClick={() => void cancel()}
        >
          Cancel the build
        </button>
      </div>
      {build.restarts.length > 0 && (
        <ul className="text-[color:var(--muted)]">
          {build.restarts.map((r) => (
            <li key={r.name}>{restartLine(r)}</li>
          ))}
        </ul>
      )}
      <p className="text-[color:var(--muted)]">
        It carries on if you leave this page. The tray at the top shows it meanwhile.
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

/** A finished build: the slider over what was measured, and Save. */
function BuildResult({
  build,
  model,
  profiles,
  node,
  onSaved,
  onBuildAgain,
}: {
  build: ProfileBuild;
  model: LibraryModel;
  profiles: ModelProfile[];
  node: TargetNode;
  onSaved: () => void | Promise<void>;
  onBuildAgain: () => void;
}) {
  const id = useId();
  const stops = useMemo(() => frontier(build), [build]);
  const suggested = defaultStop(build, stops);
  const [at, setAt] = useState(suggested);
  const base = profiles.find((p) => p.id === build.profileId) ?? null;
  const [name, setName] = useState(() => builtName(build.node || node.label));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = stops[at] ?? null;

  async function save(replacing: boolean) {
    if (!stop) return;
    setSaving(true);
    setError(null);
    try {
      const spec = builtSpec({
        base,
        build,
        candidate: stop.candidate,
        name: replacing && base ? base.name : name.trim(),
        replacing,
      });
      const path = `/v1/models/${encodeURIComponent(model.id)}/profiles`;
      const written =
        replacing && base
          ? await api.put<ModelProfile>("library", `${path}/${encodeURIComponent(base.id)}`, spec)
          : await api.post<ModelProfile>("library", path, spec);
      setSaved(written.name);
      await onSaved();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  }

  const failed = build.state !== "completed";
  return (
    <div className="space-y-3" data-testid="build-result" data-state={build.state}>
      <p>
        <strong>{phaseLine(build)}</strong> · {new Date(build.startedAt).toLocaleString()} ·{" "}
        {ACCURACY_LEVELS.find((l) => l.id === build.accuracy)?.label}
      </p>
      {failed && build.detail && <p role="alert">{build.detail}</p>}
      {build.restarts.length > 0 && (
        <ul data-testid="build-restarts">
          {build.restarts.map((r) => (
            <li key={r.name}>{restartLine(r)}</li>
          ))}
        </ul>
      )}

      {stops.length === 0 ? (
        <p>Nothing was measured, so there is nothing to save.</p>
      ) : (
        <>
          {failed && <p>These were measured before it stopped.</p>}
          <label htmlFor={`${id}-slider`} className="font-ui block font-semibold">
            Faster replies ↔ Longer memory
          </label>
          <input
            id={`${id}-slider`}
            type="range"
            min={0}
            max={Math.max(0, stops.length - 1)}
            step={1}
            value={at}
            disabled={stops.length < 2}
            onChange={(e) => setAt(Number(e.target.value))}
            aria-valuetext={stop ? stopLabel(stop.candidate) : undefined}
            className="w-full max-w-md"
            data-testid="build-slider"
          />
          {stop && (
            <div data-testid="build-stop">
              <p title={stopDetail(stop.candidate)}>
                {stopLabel(stop.candidate)}
                {at === suggested && <span className="text-status-success"> · suggested</span>}
              </p>
              {qualityLine(build, stop.candidate.cacheType) && (
                <p>{qualityLine(build, stop.candidate.cacheType)}</p>
              )}
              {stops.length === 1 && (
                <p className="text-[color:var(--muted)]">
                  Only one setting was worth keeping on this machine.
                </p>
              )}
            </div>
          )}

          {saved ? (
            <p className="status-success rounded-[var(--radius)] border px-3 py-2" role="status">
              Saved as {saved}. It is an ordinary profile you can still edit.
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <label htmlFor={`${id}-name`}>
                Name
                <input
                  id={`${id}-name`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="ml-2 rounded-[var(--radius)] border p-1"
                />
              </label>
              <button
                type="button"
                className="action-button action-button--primary font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1.5 text-sm font-medium text-[color:var(--on-accent-left)] transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={saving || !stop || !name.trim()}
                onClick={() => void save(false)}
                data-testid="build-save"
              >
                Save as a new profile
              </button>
              {base && (
                <ConfirmButton
                  label={`Replace ${base.name}`}
                  prompt={`${base.name}'s context and memory settings are replaced with these.`}
                  onConfirm={() => void save(true)}
                  className="action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5 text-sm"
                />
              )}
            </div>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        className="rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1"
        onClick={onBuildAgain}
      >
        Build again
      </button>
    </div>
  );
}
