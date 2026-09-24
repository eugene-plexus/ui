/**
 * The folder the wizard offers to make for a person who has no models yet.
 *
 * Hobbyist UX §6.2, slice S2: *"◉ Make a folder for me: D:\Users\sam\Eugene
 * Models"*. The wizard used to open with an empty text box asking where
 * the model files already were, which §0.4 measured as the one question a
 * new user cannot answer — they have no files. The proposal is a plain
 * folder under the home directory of the machine the library runs on,
 * and it stays a plain folder: no sub-structure, no index the person
 * cannot read, the path printed wherever it is mentioned (§10 trap 3).
 *
 * **Whose home.** The library lists its own host's starting points at
 * `GET /v1/directories` with no path, and one entry is named `Home`. That
 * is the machine downloads land on, so its home is the one to build under
 * — not the browser's, which on a two-machine install is a different
 * computer.
 *
 * **The path's own shape says how to join it.** A drive letter or a UNC
 * prefix means Windows and a backslash; a leading slash means POSIX and a
 * forward slash. The same rule the library folders design uses for mounts
 * (*"the path's own shape says which OS"*), because the running browser's
 * platform says nothing about the library's.
 *
 * Pure: no fetching, no React. Nothing here creates a directory — the
 * library makes a missing destination when the first download starts
 * (`downloads.py`), which is what lets the wizard promise *"Nothing is
 * created until the first download lands there"* and mean it.
 */

import type { DirectoryListing } from "./types";

/** The folder's name, as the person will see it in their file manager. */
export const MODELS_FOLDER_NAME = "Eugene Models";

/** The library host's home directory, from its root listing; `null` when
 * the listing carries no `Home` entry (an older library, or a host whose
 * home could not be resolved). */
export function homeFrom(listing: DirectoryListing | null | undefined): string | null {
  const entry = (listing?.entries ?? []).find((e) => e.name === "Home");
  const path = entry?.path?.trim();
  return path ? path : null;
}

/**
 * The folder an installer already chose, from the library's `GET /v1/folders`
 * (2026-09-24), or `null` when there is none -- which is every per-user install.
 *
 * It wins over `<home>/Eugene Models` because the library's home is not always
 * the person's. Under its own account on Linux it is `/var/lib/eugene-plexus`,
 * which the person cannot open; as a Windows service it is SYSTEM's profile,
 * inside the Windows directory; in the container it is nobody's. The installers
 * set the library's default folder for exactly those cases, and until now the
 * wizard proposed past it.
 */
export function presetModelsFolder(list: { folders?: unknown } | null | undefined): string | null {
  const folders: unknown[] = Array.isArray(list?.folders) ? list.folders : [];
  const first = folders[0];
  const path =
    typeof first === "string"
      ? first
      : first && typeof first === "object"
        ? (first as { path?: unknown }).path
        : null;
  return typeof path === "string" && path.trim() ? path.trim() : null;
}

/** The directory `path` is in, for a picker to start from; `path` itself when
 * it has no parent to give. */
export function parentOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.replace(/[\\/][^\\/]*$/, "") || trimmed;
}

/** `<home>/Eugene Models`, joined the way the home path's shape implies;
 * `null` when there is no home to build under. */
export function proposedModelsFolder(listing: DirectoryListing | null | undefined): string | null {
  const home = homeFrom(listing);
  return home === null ? null : joinPath(home, MODELS_FOLDER_NAME);
}

/**
 * Join one name onto a base path with the separator the base's shape
 * implies. A trailing separator on the base is absorbed, so `C:\` and
 * `C:\Users\sam\` both come out right.
 */
export function joinPath(base: string, name: string): string {
  const sep = separatorFor(base);
  // Stripping the trailing separator and adding one back is what makes
  // `/` become `/Eugene Models` and `C:\` become `C:\Eugene Models`, rather
  // than a doubled slash or a drive-relative `C:Eugene Models`.
  const trimmed = base.replace(/[\\/]+$/, "");
  return `${trimmed}${sep}${name}`;
}

/** `\` for a Windows-shaped path (drive letter or UNC), `/` for a
 * POSIX-shaped one; a path with neither shape follows whichever
 * separator it already uses, defaulting to `/`. */
export function separatorFor(path: string): "\\" | "/" {
  if (/^[A-Za-z]:/.test(path) || path.startsWith("\\\\")) return "\\";
  if (path.startsWith("/")) return "/";
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}
