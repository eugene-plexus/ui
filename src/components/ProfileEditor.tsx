"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ConfigFieldInput } from "@/components/ConfigField";
import { ApiError, api, describeError } from "@/lib/api";
import { describeAdmission } from "@/lib/launchPreview";
import {
  DEFAULT_PROFILE_NAME,
  composeSpec,
  contextPrefill,
  type RuntimeCreate,
} from "@/lib/launchSpec";
import { libraryFoldersHref } from "@/lib/libraryReach";
import type { TargetNode } from "@/lib/nodeBudget";
import type {
  Admission,
  EngineDescriptor,
  LibraryModel,
  ModelProfile,
  ModelProfileList,
  ModelProfileSpec,
  Runtime,
  RuntimePlacement,
} from "@/lib/types";

/**
 * Named launch profiles for one model, and the button that turns one
 * into a running engine.
 *
 * ## Where the form comes from
 *
 * The flag inputs are rendered from the **agent's** engine
 * `flagSchema` — a standard `ConfigSchema`, so the same generic field
 * renderer that draws every component's settings draws these too, with
 * no engine-specific UI code. The library never sees that schema and
 * never validates a flag; it stores what it is given, and the agent
 * rejects an unknown key when a runtime is actually created. Two
 * validators would be two copies of engine knowledge, and the stale one
 * would live in the component that never launches anything.
 *
 * ## Where the launch happens
 *
 * Here, in the caller — not in the library. Read the profile from the
 * library (8082), POST a runtime to the agent (8079) with the
 * model's path and the profile's flags. `ModelProfileSpec`'s field names
 * are `RuntimeSpec`'s field names precisely so this is a copy rather
 * than a translation, which is what lets the library hold no engine
 * knowledge and never call the agent.
 *
 * ## This is the expert path
 *
 * Since S3 of the hobbyist UX plan, **Run** (`RunButton`, above this
 * section on the model detail) does all of this with one click: it makes
 * the `default` profile at the context that fits when the model has
 * none, installs the engine if the person says yes, and starts the
 * runtime. What this editor adds is *several* profiles — a long-context
 * one and a fast one on the same file, two copies pinned to two GPUs —
 * and a hand on every flag. Nothing here is required for a first run.
 */

// `RuntimeCreate` and `composeSpec` live in `lib/launchSpec.ts` since S3,
// shared with one-click Run so the two paths declare the same runtime.

export function ProfileEditor({
  model,
  engines,
  node,
  onChanged,
}: {
  model: LibraryModel;
  /** Engines that can load this model's format ON THE TARGET NODE. Empty
   * when none can — profiles are still editable then, they just have
   * nothing to launch into. */
  engines: EngineDescriptor[];
  /** Where Launch goes. Null until the picker has resolved; the local
   * node when the install has one host. */
  node: TargetNode | null;
  onChanged: () => void;
}) {
  const [profiles, setProfiles] = useState<ModelProfile[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launched, setLaunched] = useState<string | null>(null);
  // What a NEW profile should start its contextSize at, asked of the
  // target node before the form renders: undefined while asking, null
  // when the model's own context fits (or nobody could say), else the
  // largest context that fits entirely in that node's GPU memory.
  const [prefillContext, setPrefillContext] = useState<number | null | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const list = await api.get<ModelProfileList>(
        "library",
        `/v1/models/${encodeURIComponent(model.id)}/profiles`,
      );
      setProfiles(list.profiles ?? []);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setError(errorText(err));
    }
  }, [model.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Discover scored this file at the library's guidance context; a profile
  // that leaves contextSize to the engine is scored at the model's own. Ask
  // the node, with the flags the form would otherwise start empty, so the
  // form can start at a number that fits instead of one that is refused.
  const probeEngine = engines[0]?.engine ?? null;
  useEffect(() => {
    if (!creating || !node || !probeEngine) {
      setPrefillContext(null);
      return;
    }
    let cancelled = false;
    setPrefillContext(undefined);
    void (async () => {
      let suggestion: number | null = null;
      try {
        const probe: RuntimeCreate = {
          name: "context-probe",
          engine: probeEngine,
          modelPath: model.path,
          autoStart: false,
        };
        const answer = await api.post<Admission>(node.target, "/v1/runtimes/admission", probe);
        suggestion = contextPrefill(answer.maxContextLength, model.contextLength);
      } catch {
        suggestion = null;
      }
      if (!cancelled) setPrefillContext(suggestion);
    })();
    return () => {
      cancelled = true;
    };
  }, [creating, node, probeEngine, model.path, model.contextLength]);

  async function setContext(profile: ModelProfile, context: number) {
    setError(null);
    const spec: ModelProfileSpec = {
      name: profile.name,
      engine: profile.engine,
      default: profile.default ?? false,
      flags: { ...(profile.flags ?? {}), contextSize: context },
      extraArgs: profile.extraArgs ?? undefined,
      env: profile.env ?? undefined,
      notes: profile.notes ?? undefined,
    };
    try {
      await api.put<ModelProfile>(
        "library",
        `/v1/models/${encodeURIComponent(model.id)}/profiles/${encodeURIComponent(profile.id)}`,
        spec,
      );
      await load();
      onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function remove(profile: ModelProfile) {
    setError(null);
    try {
      await api.delete<void>(
        "library",
        `/v1/models/${encodeURIComponent(model.id)}/profiles/${encodeURIComponent(profile.id)}`,
      );
      await load();
      onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function launch(profile: ModelProfile) {
    setError(null);
    setLaunched(null);
    const spec = composeSpec(model, profile);
    try {
      if (node && !node.local && node.name) {
        // Another node: through the control root, which forwards the
        // declaration to that node's agent and records it in the
        // install's topology. Forward first, record second, so a runtime
        // the agent refuses never appears declared — the agent is where
        // "does this model path exist here" can be answered, and on an
        // install whose library is on another host the honest failure is
        // exactly that. It is relayed, not predicted.
        const placed = await api.post<RuntimePlacement>("control", "/v1/runtimes", {
          node: node.name,
          spec,
        });
        setLaunched(placed.name);
      } else {
        const runtime = await api.post<Runtime>("agent", "/v1/runtimes", spec);
        setLaunched(runtime.name);
      }
    } catch (err) {
      setError(errorText(err));
    }
  }

  const canLaunch = engines.some((e) => e.available) && model.status === "present";
  // What the panel predicts for: the default profile, else the first.
  const previewProfile = profiles?.find((p) => p.default) ?? profiles?.[0] ?? null;

  return (
    <section className="mt-2">
      <div className="flex items-center justify-between">
        <h3 className="font-ui text-xs font-semibold tracking-wide uppercase">
          Launch profiles
          <span className="ml-2 font-normal tracking-normal text-[color:var(--muted)] normal-case">
            for experts
          </span>
        </h3>
        {!creating && (
          <button type="button" onClick={() => setCreating(true)} className={buttonClass}>
            new profile
          </button>
        )}
      </div>

      <p className="mt-1 text-xs leading-relaxed text-[color:var(--muted)]">
        The settings that worked, saved against the model instead of retyped. Run makes one called{" "}
        <span className="font-mono">{DEFAULT_PROFILE_NAME}</span> for you at the context that fits;
        several are useful once you are tuning: a long-context profile and a fast one are different
        flags on the same file, and two copies pinned to different GPUs is the same profile twice
        with a different <span className="font-mono">CUDA_VISIBLE_DEVICES</span>.
      </p>

      {canLaunch && node && previewProfile && (
        <LaunchPreview
          model={model}
          profile={previewProfile}
          node={node}
          onSetContext={(context) => setContext(previewProfile, context)}
        />
      )}

      {error && (
        <p className="status-error mt-2 rounded-[var(--radius)] border px-3 py-2 text-xs">
          {error}
        </p>
      )}
      {/* From M6 a launch ends routable: the agent declares a companion
          inference-driver beside the runtime, following it by name, so
          the gateway serves the alias the moment the engine is ready.
          M2's acceptance run found the gap this message used to
          describe; M6 closed it. What is still honestly said here is
          that "ready" is the engine's to reach, not the button's. */}
      {launched && (
        <p className="status-ok mt-2 rounded-[var(--radius)] border px-3 py-2 text-xs leading-relaxed">
          Declared runtime <span className="font-mono">{launched}</span>
          {node && !node.local ? ` on ${node.label}` : ""} and its driver{" "}
          <span className="font-mono">{launched}-driver</span>. Watch it load on the{" "}
          <a href="/inference" className="underline">
            Inference
          </a>{" "}
          page — a large quant takes a while. The gateway serves it under its alias as soon as the
          engine reports <span className="font-mono">ready</span>; nothing else to wire.
        </p>
      )}

      {creating && prefillContext === undefined && node && (
        <p className="mt-3 text-xs text-[color:var(--muted)]" data-testid="context-probe">
          Asking {node.label} what context fits&hellip;
        </p>
      )}
      {creating && (prefillContext !== undefined || !node) && (
        <ProfileForm
          suggestedContext={prefillContext ?? null}
          nodeLabel={node?.label ?? null}
          model={model}
          engines={engines}
          onCancel={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await load();
            onChanged();
          }}
        />
      )}

      <div className="mt-3 flex flex-col gap-2">
        {profiles?.length === 0 && !creating && (
          <p className="text-xs text-[color:var(--muted)] italic">
            None yet. Press Run above and one called{" "}
            <span className="font-mono not-italic">{DEFAULT_PROFILE_NAME}</span> is made for you at
            the context that fits this machine; make one here only to choose the flags yourself. A
            profile is the saved engine flags for this file, so the same model is never retuned
            twice. An app you already run (Ollama, a cloud CLI) joins from{" "}
            <Link href="/backends/add" className="underline">
              Add an app you already run
            </Link>{" "}
            instead.
          </p>
        )}
        {profiles?.map((p) =>
          editing === p.id ? (
            <ProfileForm
              key={p.id}
              model={model}
              engines={engines}
              existing={p}
              onCancel={() => setEditing(null)}
              onSaved={async () => {
                setEditing(null);
                await load();
              }}
            />
          ) : (
            <ProfileRow
              key={p.id}
              profile={p}
              canLaunch={canLaunch}
              onEdit={() => setEditing(p.id)}
              onDelete={() => void remove(p)}
              onLaunch={() => void launch(p)}
            />
          ),
        )}
      </div>
    </section>
  );
}

/**
 * What Launch will do on the picked node, before it is pressed (M11).
 *
 * The agent's admission dry run, with exactly the spec Launch would send,
 * so there is no second opinion for it to disagree with. Two answers it
 * gives that the fit panel above cannot: whether the model is ON that
 * node at all -- the library names a model by its path on the library's
 * host, and a node elsewhere reaches it through a mapping or not at all
 * -- and whether THIS profile's context fits beside what is already
 * running there. Before this, both were learned from a crashed runtime.
 */
function LaunchPreview({
  model,
  profile,
  node,
  onSetContext,
}: {
  model: LibraryModel;
  profile: ModelProfile;
  node: TargetNode;
  onSetContext: (context: number) => Promise<void>;
}) {
  const [admission, setAdmission] = useState<Admission | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAdmission(null);
    setFailure(null);
    void (async () => {
      try {
        const result = await api.post<Admission>(
          node.target,
          "/v1/runtimes/admission",
          composeSpec(model, profile),
        );
        if (!cancelled) setAdmission(result);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return;
        if (!cancelled) setFailure(describeError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [model, profile, node]);

  if (failure) {
    return (
      <p className="mt-2 text-xs text-[color:var(--muted)]">
        Could not ask {node.label} what a launch would do: {failure}
      </p>
    );
  }
  if (!admission) return null;

  const preview = describeAdmission(admission, node.label, node.target);
  const tone =
    preview.tone === "ok" ? "status-ok" : preview.tone === "warn" ? "status-warn" : "status-error";
  return (
    <div
      className={`${tone} mt-2 rounded-[var(--radius)] border px-3 py-2 text-xs leading-relaxed`}
      data-testid="launch-preview"
    >
      <p className="font-ui font-semibold">
        {preview.headline}
        <span className="ml-2 font-normal opacity-70">
          profile <span className="font-mono">{profile.name}</span>
        </span>
      </p>
      {preview.detail && <p className="mt-0.5 break-all">{preview.detail}</p>}
      {preview.suggestedContext != null && (
        <p className="mt-1.5">
          <button
            type="button"
            className={buttonClass}
            data-testid="set-context"
            onClick={() => void onSetContext(preview.suggestedContext as number)}
          >
            Set contextSize to {preview.suggestedContext.toLocaleString()} on this profile
          </button>
          <span className="ml-2 opacity-70">
            the largest context at which this file fits entirely in {node.label}&rsquo;s GPU memory
          </span>
        </p>
      )}
      {preview.fixTarget && (
        <p className="mt-1">
          <Link href={libraryFoldersHref(node.name)} className="underline">
            Say where {node.label} mounts the Library&rsquo;s folder
          </Link>
          {" — Library → "}
          {node.label}
          {" → Folders. Set it on the folder itself to cover every node of that kind."}
        </p>
      )}
    </div>
  );
}

function ProfileRow({
  profile,
  canLaunch,
  onEdit,
  onDelete,
  onLaunch,
}: {
  profile: ModelProfile;
  canLaunch: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onLaunch: () => void;
}) {
  const flags = Object.entries(profile.flags ?? {});
  const env = Object.entries(profile.env ?? {});
  return (
    <div className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">{profile.name}</span>
          {profile.default && (
            <span className="rounded bg-[color:var(--border)] px-1 text-[9px] tracking-wider uppercase">
              default
            </span>
          )}
          <span className="font-mono text-[color:var(--muted)]">{profile.engine}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onLaunch}
            disabled={!canLaunch}
            className={buttonClass}
            title={
              canLaunch
                ? "Declare a runtime on the agent using this model and these flags."
                : "No installed engine can load this model."
            }
          >
            launch
          </button>
          <button type="button" onClick={onEdit} className={buttonClass}>
            edit
          </button>
          <button type="button" onClick={onDelete} className={buttonClass}>
            delete
          </button>
        </div>
      </div>
      {(flags.length > 0 || env.length > 0 || profile.extraArgs?.length) && (
        <p className="mt-1 font-mono text-[10px] break-all text-[color:var(--muted)]">
          {[
            ...flags.map(([k, v]) => `${k}=${JSON.stringify(v)}`),
            ...env.map(([k, v]) => `${k}=${v}`),
            ...(profile.extraArgs ?? []),
          ].join("  ")}
        </p>
      )}
      {profile.notes && <p className="mt-1 text-[color:var(--muted)] italic">{profile.notes}</p>}
    </div>
  );
}

function ProfileForm({
  model,
  engines,
  existing,
  suggestedContext = null,
  nodeLabel = null,
  onCancel,
  onSaved,
}: {
  model: LibraryModel;
  engines: EngineDescriptor[];
  existing?: ModelProfile;
  /** For a NEW profile: the contextSize to start at, from the target
   * node's admission dry run. Null when the model's own context fits. */
  suggestedContext?: number | null;
  nodeLabel?: string | null;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState(existing?.name ?? suggestedName(model));
  const [engine, setEngine] = useState(existing?.engine ?? engines[0]?.engine ?? "llama_cpp");
  const [flags, setFlags] = useState<Record<string, unknown>>(() => ({
    ...(existing?.flags ?? {}),
    ...(!existing && suggestedContext != null ? { contextSize: suggestedContext } : {}),
  }));
  const [extraArgs, setExtraArgs] = useState((existing?.extraArgs ?? []).join(" "));
  const [env, setEnv] = useState(
    Object.entries(existing?.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
  );
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [isDefault, setIsDefault] = useState(existing?.default ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const descriptor = engines.find((e) => e.engine === engine);
  const schema = descriptor?.flagSchema;

  async function save() {
    setSaving(true);
    setError(null);
    const spec: ModelProfileSpec = {
      name: name.trim(),
      engine,
      default: isDefault,
      // Empty values are dropped rather than stored as nulls: an unset
      // flag must not become `--flag null` on a command line.
      flags: Object.fromEntries(
        Object.entries(flags).filter(([, v]) => v !== null && v !== undefined && v !== ""),
      ),
      extraArgs: extraArgs.trim() ? extraArgs.trim().split(/\s+/) : [],
      env: parseEnv(env),
      notes: notes.trim() || undefined,
    };
    try {
      const base = `/v1/models/${encodeURIComponent(model.id)}/profiles`;
      if (existing) {
        // PUT, not PATCH: `flags` is a document, and merge semantics
        // give no way to express removing a flag.
        await api.put<ModelProfile>("library", `${base}/${encodeURIComponent(existing.id)}`, spec);
      } else {
        await api.post<ModelProfile>("library", base, spec);
      }
      await onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-3">
      {error && (
        <p className="status-error mb-2 rounded-[var(--radius)] border px-3 py-2 text-xs">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[color:var(--muted)]">name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="long context"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-[color:var(--muted)]">engine</span>
          <select
            value={engine}
            onChange={(e) => setEngine(e.target.value as typeof engine)}
            className={inputClass}
          >
            {engines.map((e) => (
              <option key={e.engine} value={e.engine}>
                {e.engine}
              </option>
            ))}
            {engines.length === 0 && <option value="llama_cpp">llama_cpp</option>}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="h-4 w-4"
          />
          <span>default</span>
        </label>
      </div>

      {/* Rendered from the agent's flagSchema, so adding a curated
          flag to an engine adapter is a server-side change only. */}
      {schema ? (
        <div className="mt-3">
          {schema.fields.map((field) => (
            <ConfigFieldInput
              key={field.key}
              field={field}
              value={flags[field.key] ?? field.default ?? ""}
              pending={saving}
              onChange={(v) => setFlags((prev) => ({ ...prev, [field.key]: v }))}
            />
          ))}
          {!existing && suggestedContext != null && (
            <p
              className="mt-1 text-xs text-[color:var(--muted)]"
              data-testid="context-prefill-note"
            >
              contextSize starts at {suggestedContext.toLocaleString()}: the largest context at
              which this file fits entirely in {nodeLabel ?? "this node"}&rsquo;s GPU memory.
              {model.contextLength != null && (
                <>
                  {" "}
                  The model allows {model.contextLength.toLocaleString()}; above the prefilled value
                  the launch spills into host memory or is refused.
                </>
              )}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-[color:var(--muted)]">
          No flag schema available for <span className="font-mono">{engine}</span> — the agent did
          not report one. You can still set extra arguments below.
        </p>
      )}

      <label className="mt-3 flex flex-col gap-1 text-xs">
        <span className="text-[color:var(--muted)]">
          extra arguments — the escape hatch for flags the curated surface misses
        </span>
        <input
          type="text"
          value={extraArgs}
          onChange={(e) => setExtraArgs(e.target.value)}
          placeholder="--lora adapter.gguf"
          spellCheck={false}
          className={`${inputClass} font-mono`}
        />
      </label>

      <label className="mt-3 flex flex-col gap-1 text-xs">
        <span className="text-[color:var(--muted)]">
          environment, one <span className="font-mono">KEY=value</span> per line — where{" "}
          <span className="font-mono">CUDA_VISIBLE_DEVICES</span> goes to pin this to one GPU
        </span>
        <textarea
          value={env}
          onChange={(e) => setEnv(e.target.value)}
          rows={2}
          spellCheck={false}
          className={`${inputClass} font-mono`}
        />
      </label>

      <label className="mt-3 flex flex-col gap-1 text-xs">
        <span className="text-[color:var(--muted)]">
          notes — tuning is empirical and the reasoning evaporates
        </span>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="OOMs above 24 layers on the 3090"
          className={inputClass}
        />
      </label>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !name.trim()}
          className={buttonClass}
        >
          {saving ? "saving…" : existing ? "save" : "create"}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className={buttonClass}>
          cancel
        </button>
      </div>
    </div>
  );
}

const buttonClass =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";

const inputClass =
  "rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none transition-colors hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)]";

/** `KEY=value` per line. Blank lines and lines without `=` are ignored
 * rather than rejected — a half-typed line should not block a save. */
function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function suggestedName(model: LibraryModel): string {
  return (model.profileCount ?? 0) === 0 ? DEFAULT_PROFILE_NAME : "";
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { detail?: { detail?: string; title?: string } | string } | undefined;
    if (typeof body?.detail === "string") return body.detail;
    return body?.detail?.detail ?? body?.detail?.title ?? err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
