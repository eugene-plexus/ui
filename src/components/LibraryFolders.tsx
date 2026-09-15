"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { FolderPicker } from "@/components/FolderPicker";
import { ApiError, api, describeError } from "@/lib/api";
import {
  type CellTone,
  type MountShape,
  cellFor,
  describeAge,
  foldersProblem,
  isAbsolutePath,
  libraryFoldersHref,
  mountFor,
  parseFolders,
  shapeOf,
  withMount,
} from "@/lib/libraryReach";
import { type TargetNode, useTargetNode } from "@/lib/nodeBudget";
import type { LibraryFolder, LibraryFolderReach, PathMapping } from "@/lib/types";

/**
 * The Library's folders, and how every node reaches them (2026-09-14).
 *
 * **Design:** `specs/docs/design/library-folders-and-reach.md`. Two
 * views of one thing, chosen by the tree selection:
 *
 * - **The Library selected — the grid.** Rows are folders, columns are
 *   nodes. A folder carries its own path (the library's host) and its
 *   mounts — where Linux/macOS nodes and Windows nodes find the same
 *   directory — stated once here and inherited by every node. Each cell
 *   is what that node would open, badged same path / inherited /
 *   override, with a status from the node's own check.
 * - **A node selected — one column.** The same rows for one machine,
 *   plus the Override box: only for the odd box that mounts a share
 *   somewhere else. Browse lists THAT node's disk, through
 *   `node:<name>`, because *"once a node is connected I never want to
 *   hop to another node's UI to do anything"* — the folder picker for a
 *   remote node's override is the example that principle was stated
 *   with.
 *
 * **Four sources, each soft.** The library's folder list, the control
 * root's node list, each node's check, and the selected node's
 * overrides. The page an operator opens when a mount is wrong must not
 * fail because a mount is wrong: a node that does not answer is a column
 * of "did not answer"; a library that cannot be reached shows the local
 * node's copy with its age.
 */

interface PickerState {
  kind: "folder-path" | "mount" | "override";
  /** Row index in the current draft. */
  index: number;
  /** Proxy target whose host to browse. */
  target: string;
  /** For a mount: which shape box the pick lands in, decided by the pick itself. */
  shape?: MountShape;
}

export function LibraryFolders({ nodeName }: { nodeName: string | null | undefined }) {
  const picker = useTargetNode();
  const nodes = picker.nodes;
  const gridView = nodeName === undefined;
  const selectedNode: TargetNode | null = gridView
    ? null
    : (nodes.find((n) => (nodeName === null ? n.local : n.name === nodeName)) ?? null);

  // The library's folders: the server's copy and the operator's draft.
  const [serverFolders, setServerFolders] = useState<LibraryFolder[] | null>(null);
  const [draft, setDraft] = useState<LibraryFolder[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  // Each node's check answer, by proxy target.
  const [reaches, setReaches] = useState<Record<string, LibraryFolderReach | null>>({});
  // The selected node's overrides: server and draft.
  const [serverOverrides, setServerOverrides] = useState<PathMapping[]>([]);
  const [overrideDraft, setOverrideDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState<PickerState | null>(null);
  const [mountBrowseNode, setMountBrowseNode] = useState<string>("");

  const loadFolders = useCallback(async () => {
    try {
      const list = await api.get<{ folders?: unknown }>("library", "/v1/folders");
      const folders = parseFolders(list.folders);
      setServerFolders(folders);
      setDraft(folders);
      setLibraryError(null);
      setCopyNote(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      // The library is not answering. This machine's agent holds the
      // last folder list it read; show that, and say what it is.
      setLibraryError(describeError(err));
      try {
        const local = await api.post<LibraryFolderReach>("agent", "/v1/library/folders/check", {});
        const folders = local.folders.map((f) => ({ path: f.path, mounts: [] }));
        setServerFolders(folders);
        setDraft(folders);
        setCopyNote(
          local.folderListAgeSeconds == null
            ? "this machine has never read the Library's folders"
            : `showing this machine's copy, ${describeAge(local.folderListAgeSeconds)} old — mounts are not in it`,
        );
      } catch {
        setServerFolders([]);
        setDraft([]);
      }
    }
  }, []);

  const checkNode = useCallback(
    async (node: TargetNode, overrides?: PathMapping[]): Promise<LibraryFolderReach | null> => {
      try {
        const body = overrides ? { pathMappings: overrides } : {};
        const reach = await api.post<LibraryFolderReach>(
          node.target,
          "/v1/library/folders/check",
          body,
        );
        setReaches((prev) => ({ ...prev, [node.target]: reach }));
        return reach;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        setReaches((prev) => ({ ...prev, [node.target]: null }));
        return null;
      }
    },
    [],
  );

  const loadOverrides = useCallback(async (node: TargetNode) => {
    try {
      const config = await api.get<{ pathMappings?: unknown }>(node.target, "/v1/config");
      const rows = Array.isArray(config.pathMappings)
        ? (config.pathMappings as unknown[]).flatMap((m): PathMapping[] => {
            const r = m as Record<string, unknown>;
            return typeof r?.from === "string" && typeof r?.to === "string"
              ? [{ from: r.from, to: r.to }]
              : [];
          })
        : [];
      setServerOverrides(rows);
      setOverrideDraft(Object.fromEntries(rows.map((r) => [r.from, r.to])));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setFailure(`Could not read ${node.label}'s overrides: ${describeError(err)}`);
    }
  }, []);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    if (!picker.loaded) return;
    const wanted = gridView ? nodes : selectedNode ? [selectedNode] : [];
    for (const node of wanted) void checkNode(node);
    if (selectedNode) void loadOverrides(selectedNode);
    // The library's folders (`draft`) are deliberately not a dependency:
    // a check reads the node's own copy, and re-checking every node on
    // every keystroke in the mounts editor would be a poll of the whole
    // install.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker.loaded, gridView, selectedNode?.target, checkNode, loadOverrides]);

  const dirty = useMemo(
    () => serverFolders !== null && JSON.stringify(serverFolders) !== JSON.stringify(draft),
    [serverFolders, draft],
  );
  const problem = useMemo(() => foldersProblem(draft), [draft]);

  async function saveFolders() {
    setBusy("folders");
    setFailure(null);
    setStatus(null);
    try {
      const result = await api.patch<{ applied?: string[]; rejected?: { message?: string }[] }>(
        "library",
        "/v1/config",
        { modelRoots: draft },
      );
      if (result.rejected && result.rejected.length > 0) {
        setFailure(result.rejected.map((r) => r.message ?? "rejected").join("; "));
      } else {
        setStatus("Folders saved. Nodes pick the change up at their next launch.");
        await loadFolders();
        for (const node of nodes) void checkNode(node);
      }
    } catch (err) {
      setFailure(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  function overridesFromDraft(): PathMapping[] {
    return Object.entries(overrideDraft)
      .filter(([, to]) => to.trim().length > 0)
      .map(([from, to]) => ({ from, to: to.trim() }));
  }

  const overridesDirty =
    JSON.stringify(serverOverrides.map((r) => [r.from, r.to]).sort()) !==
    JSON.stringify(
      overridesFromDraft()
        .map((r) => [r.from, r.to])
        .sort(),
    );

  async function testOverrides() {
    if (!selectedNode) return;
    setBusy("test");
    setStatus(null);
    const reach = await checkNode(selectedNode, overridesFromDraft());
    setStatus(
      reach
        ? `Checked on ${selectedNode.label} with the unsaved overrides; nothing was saved.`
        : `${selectedNode.label} did not answer.`,
    );
    setBusy(null);
  }

  async function saveOverrides() {
    if (!selectedNode) return;
    setBusy("overrides");
    setFailure(null);
    setStatus(null);
    try {
      const result = await api.patch<{ applied?: string[]; rejected?: { message?: string }[] }>(
        selectedNode.target,
        "/v1/config",
        { pathMappings: overridesFromDraft() },
      );
      if (result.rejected && result.rejected.length > 0) {
        setFailure(result.rejected.map((r) => r.message ?? "rejected").join("; "));
      } else {
        setStatus(`Overrides saved on ${selectedNode.label}. They apply at the next launch.`);
        await loadOverrides(selectedNode);
        await checkNode(selectedNode);
      }
    } catch (err) {
      setFailure(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  function onPicked(path: string) {
    if (!browsing) return;
    if (browsing.kind === "folder-path") {
      setDraft((prev) => prev.map((f, i) => (i === browsing.index ? { ...f, path } : f)));
    } else if (browsing.kind === "mount") {
      // The picked path's own shape says which box it belongs in.
      setDraft((prev) =>
        prev.map((f, i) => (i === browsing.index ? withMount(f, shapeOf(path), path) : f)),
      );
    } else {
      const folder = draft[browsing.index];
      if (folder) setOverrideDraft((prev) => ({ ...prev, [folder.path]: path }));
    }
    setBrowsing(null);
  }

  const title = gridView
    ? "Folders"
    : `Folders on ${selectedNode?.label ?? nodeName ?? "this machine"}`;

  return (
    <main
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4"
      data-testid="library-folders"
      data-view={gridView ? "grid" : "node"}
      data-node={selectedNode?.name ?? ""}
    >
      <header className="mb-3">
        <h2 className="font-ui text-sm font-semibold">{title}</h2>
        <p className="mt-1 max-w-3xl text-xs text-[color:var(--muted)]">
          {gridView ? (
            <>
              A node runs a model only from one of these folders. Each folder is a directory on the
              machine the Library runs on; its <em>mounts</em> say where other machines find the
              same directory, once, and every node of that kind inherits it. A cell is what that
              node would open.{" "}
              <strong>
                Set a mount here when every node of that kind mounts the share at the same place.
              </strong>{" "}
              A machine that mounts it somewhere else gets an <em>override</em> instead, on its own
              column: click the node&rsquo;s name in the header, or pick it under Library in the
              tree.
            </>
          ) : (
            <>
              What this machine opens for each Library folder, and which rule says so.{" "}
              <strong>The folder&rsquo;s own mounts</strong> &mdash; where every Windows node, and
              every Linux or macOS node, finds it &mdash; are set once on{" "}
              <Link
                href={libraryFoldersHref(null)}
                className="underline"
                data-testid="folder-mounts-link"
              >
                Library &rarr; Folders
              </Link>
              , and this machine inherits them. An override here is only for a machine that mounts a
              share somewhere other than the folder&rsquo;s own mounts say; leave it empty
              otherwise. Browse lists <strong>this node&rsquo;s</strong> disk, wherever you are
              reading this from.
            </>
          )}
        </p>
      </header>

      {libraryError && (
        <p className="status-warn mb-3 rounded-[var(--radius)] border px-3 py-2 text-xs">
          The Library could not be reached ({libraryError}).{copyNote ? ` ${copyNote}.` : ""}
        </p>
      )}
      {failure && (
        <p className="status-error mb-3 rounded-[var(--radius)] border px-3 py-2 text-xs">
          {failure}
        </p>
      )}
      {status && !failure && (
        <p className="status-ok mb-3 rounded-[var(--radius)] border px-3 py-2 text-xs">{status}</p>
      )}

      {serverFolders === null ? (
        <p className="text-xs text-[color:var(--muted)]">Reading the Library&rsquo;s folders…</p>
      ) : gridView ? (
        <FolderGrid
          draft={draft}
          nodes={nodes}
          reaches={reaches}
          busy={busy !== null}
          libraryEditable={!libraryError}
          mountBrowseNode={mountBrowseNode}
          onMountBrowseNode={setMountBrowseNode}
          onChange={setDraft}
          onBrowse={setBrowsing}
        />
      ) : (
        <NodeColumn
          node={selectedNode}
          nodeName={nodeName ?? null}
          folders={draft}
          reach={selectedNode ? (reaches[selectedNode.target] ?? null) : null}
          checked={selectedNode ? selectedNode.target in reaches : false}
          overrides={overrideDraft}
          busy={busy !== null}
          onOverride={(folderPath, value) =>
            setOverrideDraft((prev) => ({ ...prev, [folderPath]: value }))
          }
          onBrowse={setBrowsing}
        />
      )}

      {gridView && serverFolders !== null && !libraryError && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonClass}
            disabled={busy !== null}
            onClick={() => setDraft((prev) => [...prev, { path: "", mounts: [] }])}
          >
            add folder
          </button>
          <button
            type="button"
            className={primaryClass}
            data-testid="folders-save"
            disabled={busy !== null || !dirty || problem !== null}
            onClick={() => void saveFolders()}
            title={
              problem ??
              (dirty ? "Write the folders and their mounts to the Library" : "Nothing changed")
            }
          >
            {busy === "folders" ? "saving…" : "save folders"}
          </button>
          {dirty && (
            <button
              type="button"
              className={buttonClass}
              disabled={busy !== null}
              onClick={() => serverFolders && setDraft(serverFolders)}
            >
              revert
            </button>
          )}
          {problem && <span className="status-error text-xs">{problem}</span>}
        </div>
      )}

      {!gridView && selectedNode && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonClass}
            data-testid="overrides-test"
            disabled={busy !== null}
            onClick={() => void testOverrides()}
            title="Check the unsaved overrides against this node's disk and the Library's files. Saves nothing."
          >
            {busy === "test" ? "checking…" : "test"}
          </button>
          <button
            type="button"
            className={primaryClass}
            data-testid="overrides-save"
            disabled={busy !== null || !overridesDirty}
            onClick={() => void saveOverrides()}
          >
            {busy === "overrides" ? "saving…" : "save overrides"}
          </button>
          <Link
            href={libraryFoldersHref(null) + "&view=grid"}
            className="hidden"
            aria-hidden="true"
          >
            grid
          </Link>
          <Link href="/library/folders?sel=library" className="text-xs underline">
            every node
          </Link>
        </div>
      )}

      {browsing && (
        <FolderPicker
          target={browsing.target}
          initialPath={
            browsing.kind === "override"
              ? overrideDraft[draft[browsing.index]?.path ?? ""] || null
              : browsing.kind === "folder-path"
                ? draft[browsing.index]?.path || null
                : null
          }
          onClose={() => setBrowsing(null)}
          onPick={onPicked}
        />
      )}
    </main>
  );
}

/* ─────────────────────────────── the grid ─────────────────────────────── */

function FolderGrid({
  draft,
  nodes,
  reaches,
  busy,
  libraryEditable,
  mountBrowseNode,
  onMountBrowseNode,
  onChange,
  onBrowse,
}: {
  draft: LibraryFolder[];
  nodes: TargetNode[];
  reaches: Record<string, LibraryFolderReach | null>;
  busy: boolean;
  libraryEditable: boolean;
  mountBrowseNode: string;
  onMountBrowseNode: (target: string) => void;
  onChange: (folders: LibraryFolder[]) => void;
  onBrowse: (state: PickerState) => void;
}) {
  function setMount(index: number, shape: MountShape, value: string) {
    onChange(draft.map((f, i) => (i === index ? withMount(f, shape, value) : f)));
  }
  const browseTarget = mountBrowseNode || nodes[0]?.target || "";

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs" data-testid="folders-grid">
        <thead>
          <tr className="text-left text-[11px] text-[color:var(--muted)]">
            <th className="border-b border-[color:var(--border)] px-2 py-1.5 font-medium">
              Folder <span className="font-normal">(on the Library&rsquo;s machine)</span>
            </th>
            <th className="border-b border-[color:var(--border)] px-2 py-1.5 font-medium">
              Mounted on Linux / macOS nodes at
            </th>
            <th className="border-b border-[color:var(--border)] px-2 py-1.5 font-medium">
              Mounted on Windows nodes at
            </th>
            {nodes.map((node) => (
              <th
                key={node.target}
                className="border-b border-[color:var(--border)] px-2 py-1.5 font-medium"
                data-node-column={node.name ?? ""}
              >
                <Link href={libraryFoldersHref(node.name)} className="underline">
                  {node.label}
                </Link>
                {node.local && <span className="ml-1 font-normal">(here)</span>}
              </th>
            ))}
            <th className="border-b border-[color:var(--border)]" />
          </tr>
        </thead>
        <tbody>
          {draft.length === 0 && (
            <tr>
              <td colSpan={4 + nodes.length} className="px-2 py-3 text-[color:var(--muted)] italic">
                No folders yet. Add the directory where your models already are.
              </td>
            </tr>
          )}
          {draft.map((folder, index) => (
            <tr
              key={index}
              data-folder={folder.path}
              className="align-top odd:bg-[color:var(--panel-soft)]"
            >
              <td className="px-2 py-1.5">
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={folder.path}
                    spellCheck={false}
                    disabled={busy || !libraryEditable}
                    aria-label="Folder path on the Library's machine"
                    placeholder="/models"
                    onChange={(e) =>
                      onChange(
                        draft.map((f, i) => (i === index ? { ...f, path: e.target.value } : f)),
                      )
                    }
                    className={inputClass}
                  />
                  <button
                    type="button"
                    className={smallButtonClass}
                    disabled={busy || !libraryEditable}
                    onClick={() => onBrowse({ kind: "folder-path", index, target: "library" })}
                    title="Pick the directory on the machine the Library runs on."
                  >
                    browse
                  </button>
                </div>
              </td>
              <MountCell
                value={mountFor(folder, "posix") ?? ""}
                shape="posix"
                placeholder="/mnt/models"
                disabled={busy || !libraryEditable}
                onChange={(v) => setMount(index, "posix", v)}
                testId="mount-posix"
              />
              <MountCell
                value={mountFor(folder, "windows") ?? ""}
                shape="windows"
                placeholder="\\\\NAS\\models"
                disabled={busy || !libraryEditable}
                onChange={(v) => setMount(index, "windows", v)}
                testId="mount-windows"
              />
              {nodes.map((node) => {
                const cell = cellFor(folder.path, reaches[node.target] ?? null);
                const checked = node.target in reaches;
                return (
                  <td
                    key={node.target}
                    className="px-2 py-1.5"
                    data-node-cell={node.name ?? ""}
                    data-tone={checked ? cell.tone : "pending"}
                  >
                    <Link href={libraryFoldersHref(node.name)} className="block hover:underline">
                      <Dot tone={checked ? cell.tone : "unknown"} />
                      <span className="font-mono break-all">
                        {cell.localPath ?? (checked ? "—" : "…")}
                      </span>
                      <span className="block text-[10px] text-[color:var(--muted)]">
                        {checked ? cell.note : "checking…"}
                      </span>
                    </Link>
                  </td>
                );
              })}
              <td className="px-2 py-1.5">
                <button
                  type="button"
                  className={smallButtonClass}
                  disabled={busy || !libraryEditable}
                  onClick={() => onChange(draft.filter((_, i) => i !== index))}
                  title="Stop cataloguing this folder. Nothing on disk is touched."
                >
                  remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {libraryEditable && draft.length > 0 && nodes.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--muted)]">
          <span>Browse for a mount on</span>
          <select
            value={browseTarget}
            onChange={(e) => onMountBrowseNode(e.target.value)}
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-2 py-1 text-xs"
            aria-label="Node whose disk to browse for a mount"
          >
            {nodes.map((node) => (
              <option key={node.target} value={node.target}>
                {node.label}
                {node.local ? " (here)" : ""}
              </option>
            ))}
          </select>
          {draft.map((folder, index) => (
            <button
              key={index}
              type="button"
              className={smallButtonClass}
              disabled={busy || !folder.path}
              onClick={() => onBrowse({ kind: "mount", index, target: browseTarget })}
              title="The picked path's own shape says which box it lands in."
            >
              for {folder.path || `folder ${index + 1}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MountCell({
  value,
  shape,
  placeholder,
  disabled,
  onChange,
  testId,
}: {
  value: string;
  shape: MountShape;
  placeholder: string;
  disabled: boolean;
  onChange: (value: string) => void;
  testId: string;
}) {
  const wrongShape = value.trim().length > 0 && isAbsolutePath(value) && shapeOf(value) !== shape;
  return (
    <td className="px-2 py-1.5">
      <input
        type="text"
        value={value}
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        data-testid={testId}
        aria-label={shape === "posix" ? "Mount on Linux and macOS nodes" : "Mount on Windows nodes"}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} ${wrongShape ? "border-[color:var(--status-error,#f85149)]" : ""}`}
        title={
          wrongShape
            ? `${value} is ${shapeOf(value)}-shaped; this box is for ${shape} nodes`
            : "Blank means: reached at the folder's own path, or not at all"
        }
      />
    </td>
  );
}

/* ─────────────────────────────── one node ─────────────────────────────── */

function NodeColumn({
  node,
  nodeName,
  folders,
  reach,
  checked,
  overrides,
  busy,
  onOverride,
  onBrowse,
}: {
  node: TargetNode | null;
  nodeName: string | null;
  folders: LibraryFolder[];
  reach: LibraryFolderReach | null;
  checked: boolean;
  overrides: Record<string, string>;
  busy: boolean;
  onOverride: (folderPath: string, value: string) => void;
  onBrowse: (state: PickerState) => void;
}) {
  if (!node) {
    return (
      <p className="text-xs text-[color:var(--muted)]">
        {nodeName ? (
          <>
            <span className="font-mono">{nodeName}</span> is not in the node registry as this
            console sees it. If it was just enrolled, reload; if the control root is sealed, unlock
            it under Control root → Nodes.
          </>
        ) : (
          "Reading this machine's identity…"
        )}
      </p>
    );
  }
  return (
    <table className="w-full border-collapse text-xs" data-testid="folders-node">
      <thead>
        <tr className="text-left text-[11px] text-[color:var(--muted)]">
          <th className="border-b border-[color:var(--border)] px-2 py-1.5 font-medium">
            Library folder
          </th>
          <th className="border-b border-[color:var(--border)] px-2 py-1.5 font-medium">
            Opens on {node.label} as
          </th>
          <th className="border-b border-[color:var(--border)] px-2 py-1.5 font-medium">Status</th>
          <th className="border-b border-[color:var(--border)] px-2 py-1.5 font-medium">
            Override <span className="font-normal">(only if this machine differs)</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {folders.length === 0 && (
          <tr>
            <td colSpan={4} className="px-2 py-3 text-[color:var(--muted)] italic">
              The Library has no folders yet.
            </td>
          </tr>
        )}
        {folders.map((folder, index) => {
          const cell = cellFor(folder.path, reach);
          const value = overrides[folder.path] ?? "";
          return (
            <tr
              key={folder.path || index}
              data-folder={folder.path}
              data-tone={checked ? cell.tone : "pending"}
              className="align-top odd:bg-[color:var(--panel-soft)]"
            >
              <td className="px-2 py-1.5 font-mono break-all">{folder.path}</td>
              <td className="px-2 py-1.5 font-mono break-all" data-testid="node-local-path">
                {cell.localPath ?? (checked ? "—" : "…")}
                {cell.source && (
                  <span
                    className="ml-2 rounded-[var(--radius)] border border-[color:var(--border)] px-1 font-sans text-[10px] text-[color:var(--muted)]"
                    data-testid="node-source"
                  >
                    {cell.source === "same_path"
                      ? "same path"
                      : cell.source === "inherited"
                        ? "inherited from the folder"
                        : "override"}
                  </span>
                )}
              </td>
              <td className="px-2 py-1.5">
                <Dot tone={checked ? cell.tone : "unknown"} />
                <span className="text-[color:var(--muted)]">
                  {checked ? cell.note : "checking…"}
                </span>
              </td>
              <td className="px-2 py-1.5">
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={value}
                    spellCheck={false}
                    disabled={busy}
                    data-testid="override-input"
                    aria-label={`Where ${node.label} mounts ${folder.path}`}
                    placeholder="inherits the folder's mount"
                    onChange={(e) => onOverride(folder.path, e.target.value)}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    className={smallButtonClass}
                    data-testid="override-browse"
                    disabled={busy}
                    onClick={() => onBrowse({ kind: "override", index, target: node.target })}
                    title={`Pick the directory on ${node.label}'s own disk.`}
                  >
                    browse
                  </button>
                  {value && (
                    <button
                      type="button"
                      className={smallButtonClass}
                      disabled={busy}
                      onClick={() => onOverride(folder.path, "")}
                      title="Remove the override; this machine goes back to the folder's mount."
                    >
                      clear
                    </button>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Dot({ tone }: { tone: CellTone }) {
  const colour =
    tone === "ok"
      ? "var(--status-ok, #3fb950)"
      : tone === "warn"
        ? "var(--status-warn, #d29922)"
        : tone === "error"
          ? "var(--status-error, #f85149)"
          : "var(--muted)";
  return (
    <span
      aria-hidden="true"
      className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
      style={{ backgroundColor: colour }}
    />
  );
}

const inputClass =
  "min-w-0 flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-2 py-1 font-mono text-xs outline-none transition-colors hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)] disabled:cursor-not-allowed disabled:opacity-50";
const buttonClass =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";
const smallButtonClass =
  "font-ui shrink-0 rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-[11px] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30";
const primaryClass =
  "font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1 text-xs font-medium text-[color:var(--on-accent-left)] transition-[filter,opacity] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30";
