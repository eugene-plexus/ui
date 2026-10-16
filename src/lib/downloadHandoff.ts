import type { TargetNode } from "./nodeBudget";
import type { Download } from "./types";

const KEY = "eugene-download-destinations";
type Destination = Pick<TargetNode, "name" | "label" | "target">;
const memory = new Map<string, Destination>();

/** A download-only choice is a browser preference, not permission to launch.
 * Run still needs an explicit click and the agent checks the current resources. */
export function rememberDownloadTarget(id: string, node: TargetNode | null): void {
  if (!id || !node) return;
  const destination = { name: node.name, label: node.label, target: node.target };
  memory.set(id, destination);
  try {
    const entries = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Destination>;
    entries[id] = destination;
    localStorage.setItem(
      KEY,
      JSON.stringify(Object.fromEntries(Object.entries(entries).slice(-200))),
    );
    memory.delete(id);
  } catch {
    // The current tab still remembers when browser storage is unavailable.
  }
}

export function downloadTarget(
  id: string,
  nodes: readonly TargetNode[],
  fallback: TargetNode | null,
): TargetNode | null {
  let saved = memory.get(id);
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? "{}")[id] ?? saved;
  } catch {
    // Keep the in-memory choice.
  }
  if (
    !saved ||
    !(saved.name === null || typeof saved.name === "string") ||
    typeof saved.label !== "string" ||
    typeof saved.target !== "string"
  )
    return fallback;
  return (
    nodes.find((node) => node.name === saved.name) ?? {
      ...saved,
      local: false,
      reachable: false,
      lastError:
        "This machine is not currently available. Open the model in the Library to choose another machine.",
      budget: null,
    }
  );
}

/** Return to the exact transfer, not an unrelated Discover selection. */
export function downloadHref(download: Download): string {
  const params = new URLSearchParams({ repo: download.repo, download: download.id });
  if (download.source) params.set("source", download.source);
  return `/discover?${params}`;
}

export function modelLibraryHref(modelId: string, node: TargetNode | null): string {
  const params = new URLSearchParams({ model: modelId });
  if (node?.name) params.set("node", node.name);
  return `/library?${params}`;
}
