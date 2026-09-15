/**
 * Library folders and how each node reaches them (2026-09-14).
 *
 * Pure. The Folders page renders this; the components own the facts.
 *
 * The library's `modelRoots` is a list of `LibraryFolder` — the directory
 * as the library's host spells it, plus `mounts`: where OTHER machines
 * find the same directory, one per OS shape. A node takes the mount of
 * its own shape and inherits it as a rule; its own `pathMappings` are
 * the overrides, for the one machine that mounts a share elsewhere. So
 * the reach of a folder is stated once, on the folder, and a ten-node
 * install with three folders is three records rather than thirty rows.
 *
 * **The shape of a path says which nodes it is for.** A drive letter or
 * a UNC prefix is Windows; a leading `/` is POSIX. That is the agent's
 * own classifier (`is_windows_shaped`) restated, because components
 * share schemas, not code — and it is why the mounts editor has exactly
 * two boxes with no OS dropdown.
 */

import type {
  FolderReachSource,
  LibraryFolder,
  LibraryFolderReach,
  LibraryFolderStatus,
} from "./types";

export type MountShape = "posix" | "windows";

/** A drive letter or a UNC prefix: the string is for a Windows host. */
export function isWindowsShaped(path: string): boolean {
  return /^[A-Za-z]:([\\/]|$)/.test(path) || path.startsWith("\\\\") || path.startsWith("//");
}

export function shapeOf(path: string): MountShape {
  return isWindowsShaped(path) ? "windows" : "posix";
}

/** Absolute in either convention, or `~`-relative. Same rule the library
 * applies at PATCH; enforced here so a typo is caught before the round
 * trip. */
export function isAbsolutePath(path: string): boolean {
  return isWindowsShaped(path) || path.startsWith("/") || path.startsWith("~");
}

/** The object form, whatever the wire or a draft holds. A bare string is
 * a folder with no mounts — the shape every config written for
 * `path_list` still has. */
export function parseFolders(value: unknown): LibraryFolder[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): LibraryFolder[] => {
    if (typeof item === "string") return item.trim() ? [{ path: item.trim(), mounts: [] }] : [];
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.path !== "string" || !record.path.trim()) return [];
    const mounts = Array.isArray(record.mounts)
      ? record.mounts.filter((m): m is string => typeof m === "string" && m.trim().length > 0)
      : [];
    return [{ path: record.path.trim(), mounts }];
  });
}

/** The mount a node of `shape` would take: the first of that shape. */
export function mountFor(folder: LibraryFolder, shape: MountShape): string | null {
  return (folder.mounts ?? []).find((m) => shapeOf(m) === shape) ?? null;
}

/**
 * The folder with its `shape` mount replaced by `path` (or removed when
 * `path` is blank). Other-shape mounts are kept in place. Keeps at most
 * one mount per shape, which is also what the library accepts.
 */
export function withMount(folder: LibraryFolder, shape: MountShape, path: string): LibraryFolder {
  const kept = (folder.mounts ?? []).filter((m) => shapeOf(m) !== shape);
  const trimmed = path.trim();
  return { path: folder.path, mounts: trimmed ? [...kept, trimmed] : kept };
}

/** Why a folder list cannot be saved yet, or null. Mirrors the library's
 * validator so the operator hears it beside the box. */
export function foldersProblem(folders: LibraryFolder[]): string | null {
  const seen = new Set<string>();
  for (const [index, folder] of folders.entries()) {
    if (!folder.path.trim()) return `folder ${index + 1} has no path`;
    const key = folder.path.trim().toLowerCase();
    if (seen.has(key)) return `${folder.path} is listed twice`;
    seen.add(key);
    const shapes = new Set<MountShape>();
    for (const mount of folder.mounts ?? []) {
      if (!isAbsolutePath(mount)) {
        return `${mount} is not an absolute path (a mount is /mnt/models, Z:\\models or \\\\nas\\models)`;
      }
      const shape = shapeOf(mount);
      if (shapes.has(shape))
        return `${folder.path} has two ${shape} mounts; a node takes the first`;
      shapes.add(shape);
    }
  }
  return null;
}

/* ─────────────────────────── one node's cells ─────────────────────────── */

export type CellTone = "ok" | "warn" | "error" | "unknown";

/** One folder as one node reaches it, ready to render. */
export interface ReachCell {
  folderPath: string;
  /** What the node would open, or null when it has not said. */
  localPath: string | null;
  source: FolderReachSource | null;
  tone: CellTone;
  /** One line under the path. */
  note: string;
}

export const SOURCE_LABEL: Record<FolderReachSource, string> = {
  same_path: "same path",
  inherited: "inherited",
  override: "override",
};

/** The cell for `folderPath` from one node's check answer. A node that
 * did not answer, or whose copy lacks the folder, is `unknown` — never an
 * error, because the page you open when a mount is wrong must not fail
 * because a mount is wrong. */
export function cellFor(folderPath: string, reach: LibraryFolderReach | null): ReachCell {
  const row: LibraryFolderStatus | undefined = reach?.folders.find((f) => f.path === folderPath);
  if (!reach) {
    return {
      folderPath,
      localPath: null,
      source: null,
      tone: "unknown",
      note: "node did not answer",
    };
  }
  if (!row) {
    const age = reach.folderListAgeSeconds;
    return {
      folderPath,
      localPath: null,
      source: null,
      tone: "unknown",
      note: reach.libraryConsulted
        ? "not in this node's folder list"
        : age == null
          ? "this node has never read the Library's folders"
          : `this node's copy is ${describeAge(age)} old and lacks it`,
    };
  }
  if (!row.exists) {
    return {
      folderPath,
      localPath: row.localPath,
      source: row.source,
      tone: "error",
      note: row.problem ?? "missing",
    };
  }
  if (row.problem) {
    return {
      folderPath,
      localPath: row.localPath,
      source: row.source,
      tone: "warn",
      note: row.problem,
    };
  }
  const models =
    row.modelsUnder == null
      ? ""
      : row.modelsUnder === 0
        ? " · no models under it yet"
        : ` · ${row.modelsReachable ?? 0} of ${row.modelsUnder} models reachable`;
  return {
    folderPath,
    localPath: row.localPath,
    source: row.source,
    tone: "ok",
    note: `${SOURCE_LABEL[row.source]}${models}`,
  };
}

export function describeAge(seconds: number): string {
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}

/* ─────────────────────────── the selection ─────────────────────────── */

/** The tree `sel` for "how `node` reaches the Library". */
export function librarySelectionFor(node: string | null): string {
  return node ? `library:node:${node}` : "library:node";
}

/** The Folders page for one node, carrying the selection the tree uses. */
export function libraryFoldersHref(node: string | null): string {
  return `/library/folders?sel=${encodeURIComponent(librarySelectionFor(node))}`;
}
