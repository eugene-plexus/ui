/**
 * Which running models still hold a file the Library's folders no longer
 * name (2026-09-27).
 *
 * Troy saved a folder's Windows mount and read *"Nodes pick the change up
 * at their next launch"* as "reboot every node". Nothing needs rebooting:
 * each node reads the new folders when the page checks it, and resolves a
 * model's path every time that model starts. What is left is the models
 * already running, which keep the file they opened. The agent says both
 * halves on each runtime -- `openedPath`, what the running process was
 * handed, and `localPath`, what its next start would open -- so this
 * module only compares two strings the agent computed. It never works a
 * path out itself: the agent's Windows/POSIX matching lives in one place.
 */

import type { LibraryFolderReach, Runtime } from "./types";

export interface StaleModel {
  /** The node's install name; null for an unenrolled single host. */
  node: string | null;
  /** What to print for the node. */
  nodeLabel: string;
  /** Proxy target that reaches the node's agent. */
  target: string;
  /** The runtime's name, which the restart route takes. */
  runtime: string;
  /** The file the running process opened. */
  opened: string;
  /** The file a restart opens. */
  next: string;
}

/** The running runtimes on one node whose next start opens another file. */
export function staleOn(
  node: { name: string | null; label: string; target: string },
  runtimes: readonly Runtime[],
): StaleModel[] {
  return runtimes.flatMap((r): StaleModel[] =>
    r.openedPath && r.localPath && r.openedPath !== r.localPath
      ? [
          {
            node: node.name,
            nodeLabel: node.label,
            target: node.target,
            runtime: r.name,
            opened: r.openedPath,
            next: r.localPath,
          },
        ]
      : [],
  );
}

/**
 * What to say once the folders are saved, from each node's check.
 *
 * A node that answered its check with `libraryConsulted` has the new list
 * now. One that did not answer reads the list the next time it starts a
 * model -- every start asks the Library. One that answered and could not
 * reach the Library has a reason, shown beside the grid, and no promise
 * is made for it: a control host registered at a loopback address stays
 * unreachable however many models start.
 */
export function savedMessage(
  checks: readonly { label: string; reach: LibraryFolderReach | null }[],
): string {
  const silent = checks.filter((c) => c.reach === null).map((c) => c.label);
  const failed = checks.filter((c) => c.reach && !c.reach.libraryConsulted).map((c) => c.label);
  if (silent.length === 0 && failed.length === 0) {
    return checks.length > 1
      ? "Folders saved, and every machine has read them."
      : "Folders saved, and this machine has read them.";
  }
  const parts = ["Folders saved."];
  if (failed.length > 0) {
    parts.push(`${listOf(failed)} could not read them; the reason is below.`);
  }
  if (silent.length > 0) {
    parts.push(
      `${listOf(silent)} did not answer, and will read them the next time ` +
        `${silent.length === 1 ? "it starts" : "they start"} a model.`,
    );
  }
  return parts.join(" ");
}

/**
 * The machines that could not read the Library's folders on their last
 * check, each with the agent's own reason. On such a machine no folder's
 * mount applies, so a model declared from the Library's path is refused as
 * missing however the mounts are set -- the live install, 2026-09-27, whose
 * control host was registered at 127.0.0.1.
 */
export function unreadFolders(
  checks: readonly { label: string; reach: LibraryFolderReach | null }[],
): { label: string; reason: string }[] {
  return checks.flatMap(({ label, reach }) =>
    reach && !reach.libraryConsulted && reach.libraryError
      ? [{ label, reason: reach.libraryError }]
      : [],
  );
}

/** "Restart these 3 models" / "Restart this model". */
export function restartLabel(count: number): string {
  return count === 1 ? "Restart this model" : `Restart these ${count} models`;
}

function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
