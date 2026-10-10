"use client";

import { useEffect, useMemo, useState } from "react";

import { api, ApiError, describeError } from "@/lib/api";
import type { ModelEligibility } from "@/lib/eligibility";
import { engineName } from "@/lib/issues";
import { formatBytesShort } from "@/lib/tasks";
import type {
  EngineDescriptor,
  LibraryFolderList,
  LibraryModel,
  PreparedModelRequest,
} from "@/lib/types";

type Provenance = PreparedModelRequest["provenance"];

/**
 * Add a prepared model (library-sources-and-engines.md §4.5, LS3).
 *
 * A model an engine prepared for itself -- Strata's pack, lookup table and
 * MTP helper, with its JSON configuration -- becomes a Library model with
 * profiles, a row and Run. The Library writes one small provenance file
 * into a Library folder; the engine's own files stay where they are. This
 * replaces the Inference page's form, which posted a runtime straight to a
 * node with no profile.
 */

/** Engines on the picked node that load models they prepared. */
export function preparingEngines(engines: EngineDescriptor[] | null): EngineDescriptor[] {
  return (engines ?? []).filter((e) => (e.accepts ?? []).some((r) => r.format === "prepared"));
}

/** `D:\Strata\strata-qwen.json` is called `strata-qwen`, as a GGUF is by its stem. */
export function nameFromEntry(entry: string): string {
  const last =
    entry
      .trim()
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? "";
  const stem = last.replace(/\.json$/i, "");
  return stem
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 100);
}

/** The Library folder an entry path lies in, compared as Windows does when
 * either looks like a Windows path. The Library checks it again. */
export function folderHolding(entry: string, folders: string[]): string | null {
  const windows = /^[A-Za-z]:|^\\\\/.test(entry);
  const norm = (p: string) => {
    const slashes = p.replace(/\\/g, "/").replace(/\/+$/, "");
    return windows ? slashes.toLowerCase() : slashes;
  };
  const target = norm(entry);
  return folders.find((f) => target.startsWith(norm(f) + "/")) ?? null;
}

/** Two spellings of one path, compared as Windows does when either looks
 * like a Windows path. */
export function samePath(a: string, b: string): boolean {
  const windows = /^[A-Za-z]:|^\\\\/.test(a) || /^[A-Za-z]:|^\\\\/.test(b);
  const norm = (p: string) => {
    const slashes = p.replace(/\\/g, "/").replace(/\/+$/, "");
    return windows ? slashes.toLowerCase() : slashes;
  };
  return norm(a) === norm(b);
}

/** One line saying what the engine read off its file (LS7, B22 replaced). */
export function describeDraft(draft: Provenance): string {
  const files = draft.files ?? [];
  const bytes = files.reduce((sum, f) => sum + (f.sizeBytes ?? 0), 0);
  return [
    draft.title,
    draft.contextLength ? `${draft.contextLength.toLocaleString()} tokens of context` : null,
    draft.mode,
    files.length ? `${files.length} files, ${formatBytesShort(bytes)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

const BESIDE = "";

export function AddPreparedModel({
  engines,
  target,
  models,
  eligibility,
  where,
  onAdded,
  onClose,
}: {
  /** The picked node's engines; null while unknown. */
  engines: EngineDescriptor[] | null;
  /** The picked node's agent, which reads the engine's file (LS7). */
  target: string | null;
  models: LibraryModel[];
  eligibility: Map<string, ModelEligibility> | null;
  /** The picked node's name, for the sentence about whose disk the entry is on. */
  where: string;
  onAdded: (model: LibraryModel) => void;
  onClose: () => void;
}) {
  const offered = useMemo(() => preparingEngines(engines), [engines]);
  const [engine, setEngine] = useState<string>("");
  const [entry, setEntry] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [folders, setFolders] = useState<string[] | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the engine read off the file (LS7): a draft of its provenance, or
  // why the engine cannot read it (`refused` blocks adding it).
  const [draft, setDraft] = useState<Provenance | null>(null);
  const [reading, setReading] = useState(false);
  const [unread, setUnread] = useState<{ text: string; refused: boolean } | null>(null);

  useEffect(() => {
    const first = offered[0];
    if (!engine && first) setEngine(first.engine);
  }, [engine, offered]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await api.get<LibraryFolderList>("library", "/v1/folders");
        if (!cancelled) setFolders(list.folders.map((f) => f.path));
      } catch (err) {
        if (!cancelled) setError(describeError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const holder = folders ? folderHolding(entry, folders) : null;
  // The Library is the home of a model's files (Troy, LS7): an engine's
  // files outside every Library folder are moved in first, never adopted
  // from one node's own disk.
  const outside = entry.trim() !== "" && folders !== null && holder === null;
  // Beside the entry when it is in a Library folder, else the first folder,
  // until the person chooses.
  const chosenFolder = folder ?? (holder ? BESIDE : (folders?.[0] ?? BESIDE));
  const shownName = nameTouched ? name : nameFromEntry(entry);

  useEffect(() => {
    setDraft(null);
    setUnread(null);
    const path = entry.trim();
    if (!path || !engine || !target || outside || holder === null) return;
    let cancelled = false;
    setReading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const read = await api.post<Provenance>(
            target,
            `/v1/engines/${encodeURIComponent(engine)}/prepared/inspect`,
            { entry: path },
          );
          if (!cancelled) setDraft(read);
        } catch (err) {
          if (!cancelled)
            setUnread({
              text: describeError(err),
              refused: err instanceof ApiError && err.status === 422,
            });
        } finally {
          if (!cancelled) setReading(false);
        }
      })();
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setReading(false);
    };
  }, [entry, engine, target, outside, holder]);

  // What it could have been made from: the Library's models this engine
  // runs after preparing them, and the one its file names (B26).
  const named = draft?.source?.path
    ? models.find((m) => samePath(m.path, draft.source?.path ?? ""))
    : undefined;
  const sources = models.filter(
    (m) =>
      m.id === named?.id ||
      eligibility
        ?.get(m.id)
        ?.engines.some((v) => v.engine === engine && v.verdict === "after_preparation"),
  );
  // The person's choice, else the one the engine's file names.
  const chosenSource = source ?? named?.id ?? "";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const from = models.find((m) => m.id === chosenSource);
    // What the engine read (its files relative to the entry's folder, which
    // the Library rebases), with the source the person chose.
    const read = draft ? { ...draft } : {};
    const hub =
      draft?.source && from && named?.id === from.id
        ? { repoId: draft.source.repoId, file: draft.source.file }
        : {};
    const body: PreparedModelRequest = {
      name: shownName.trim(),
      ...(chosenFolder !== BESIDE ? { root: chosenFolder } : {}),
      provenance: {
        ...read,
        engine: engine as Provenance["engine"],
        entry: entry.trim(),
        source: from ? { ...hub, path: from.path } : undefined,
      },
    };
    if (!from) delete body.provenance.source;
    try {
      onAdded(await api.post<LibraryModel>("library", "/v1/models/prepared", body));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  if (engines === null) {
    return <p className="text-sm text-[color:var(--muted)]">Checking which engines {where} has…</p>;
  }
  if (offered.length === 0) {
    return (
      <div className="flex flex-col gap-2 text-sm" data-testid="add-prepared">
        <p>
          No engine on {where} loads prepared models. Strata does; install it from Backends first.
        </p>
        <button type="button" className="self-start underline" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  const label = engineName(engine);
  return (
    <form
      data-testid="add-prepared"
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-3 text-sm"
    >
      <div>
        <h2 className="text-base font-medium">Add a prepared model</h2>
        <p className="mt-1 text-[color:var(--muted)]">
          A model an engine prepared for itself, such as one made by Strata&rsquo;s setup. Its files
          must already be in a Library folder: the Library is their home, so any machine can run it
          and nothing is lost with one. The Library keeps one small file about it beside them, and
          it then has profiles and Run like any other model.
        </p>
      </div>

      {offered.length > 1 && (
        <label className="flex flex-col gap-1">
          Engine
          <select
            value={engine}
            onChange={(e) => setEngine(e.target.value)}
            className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] p-1"
          >
            {offered.map((e) => (
              <option key={e.engine} value={e.engine}>
                {engineName(e.engine)}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1">
        {label}&rsquo;s configuration file, on {where}
        <input
          required
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          placeholder={"D:\\Strata\\strata-qwen.json"}
          spellCheck={false}
          className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] p-1 font-mono"
        />
        <span className="text-[0.6875rem] text-[color:var(--muted)]">
          The JSON file {label}&rsquo;s setup wrote. It names the model&rsquo;s other files, which
          must be on {where} too. {label} checks them when the model starts.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        Name
        <input
          required
          pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,99}"
          value={shownName}
          onChange={(e) => {
            setNameTouched(true);
            setName(e.target.value);
          }}
          className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] p-1"
        />
        <span className="text-[0.6875rem] text-[color:var(--muted)]">
          Letters, numbers, dots, dashes and underscores. Apps ask for the model by this name.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        Keep its file in
        <select
          value={chosenFolder}
          onChange={(e) => setFolder(e.target.value)}
          disabled={folders === null}
          className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] p-1"
        >
          {holder && <option value={BESIDE}>Beside the configuration file ({holder})</option>}
          {(folders ?? []).map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        Made from
        <select
          value={chosenSource}
          onChange={(e) => setSource(e.target.value)}
          className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] p-1"
        >
          <option value="">Not in the Library, or not known</option>
          {sources.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>

      {reading && (
        <p className="text-[color:var(--muted)]">
          Asking {label} on {where} what this file is…
        </p>
      )}
      {draft && (
        <p data-testid="prepared-read" className="rounded-[var(--radius)] border px-3 py-2">
          {label} read: {describeDraft(draft) || "its files"}.
          {named
            ? ` Made from ${named.name}, which is in the Library.`
            : draft.source?.path
              ? ` It names ${draft.source.path} as what it was made from, which the Library does not list.`
              : ""}
        </p>
      )}
      {unread && (
        <p
          data-testid="prepared-unread"
          className={`${unread.refused ? "status-error" : "status-warn"} rounded-[var(--radius)] border px-3 py-2`}
        >
          {unread.refused
            ? `${label} cannot use this file: ${unread.text}`
            : `${label} on ${where} could not be asked what this file is (${unread.text}). It can still be added; the Library then names what it does not know.`}
        </p>
      )}

      {outside && (
        <p
          data-testid="prepared-outside"
          className="status-warn rounded-[var(--radius)] border px-3 py-2"
        >
          This file is not in a Library folder. Move the engine&rsquo;s folder into one first, then
          choose its file there.
        </p>
      )}

      {error && (
        <p role="alert" className="status-error rounded-[var(--radius)] border px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={busy || folders === null || outside || reading || !!unread?.refused}
          className="action-button action-button--primary font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1 text-sm font-medium text-[color:var(--on-accent-left)]"
        >
          {busy ? "Adding…" : "Add model"}
        </button>
        <button type="button" onClick={onClose} className="underline" disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
