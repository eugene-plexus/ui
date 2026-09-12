/**
 * Which node a screen is about: whose memory a fit verdict is scored
 * against, and where Launch goes.
 *
 * The library scores a model against the host IT runs on -- its
 * `GET /v1/hardware` says so in its own description -- and in a
 * multi-host install that is frequently the wrong machine. On the first
 * real two-machine install the library lives in a container on a NAS
 * with no GPU, and every model is launched on a worker with an RTX 5090.
 * Discover said "no GPU detected", truthfully, about a machine nobody
 * was ever going to launch on -- and recommended a 57 GB BF16 for CPU
 * inference to a machine with a 32 GB card.
 *
 * M3 built the override half: `vramBytes` / `ramBytes` on the fit
 * endpoints, "for a caller who knows the target host's numbers", and
 * deferred the inventory half to "the agent's topology when it is". M7
 * built that inventory -- `ComputeDevice` on the agent's `GET /v1/node`,
 * aggregated into `Node.devices` at the control root. Nothing ever
 * connected the two. This does.
 *
 * WHICH node: the one the operator picks, defaulting to the one whose
 * browser they are in. Scoring and launching are the same choice, made
 * once -- a verdict about node A followed by a launch on node B would
 * recommend a quant for a card the launch never reaches. `target` is
 * the proxy target that reaches the chosen node's agent: `agent` for
 * this one, `node:<name>` for any other.
 *
 * WHY THE LARGEST CARD, NOT THE SUM: the library collapses free, total
 * and largest-card into one number when a caller overrides the budget.
 * Handing it the sum of two cards would report `fits` for a model
 * neither card can hold alone; the largest single card's free memory is
 * the number "fits on one card" needs and the conservative one. The cost
 * is that the library's multi-GPU note ("scored against N GPUs summed")
 * cannot appear, because `gpuCount` is not something a caller can pass.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, api } from "./api";
import type { ComputeDevice, NodeIdentity } from "./types";

export interface NodeBudget {
  /** The node's name in the install, or null before it has enrolled. */
  node: string | null;
  /** The accelerator the verdict is scored against, or null on a CPU-only host. */
  gpu: {
    name: string;
    kind: ComputeDevice["kind"];
    totalBytes: number | null;
    freeBytes: number;
  } | null;
  gpuCount: number;
  /** What goes in `vramBytes`. Zero on a CPU-only host, which the library
   * reads as "no accelerator" and scores against host memory alone. */
  vramBytes: number;
  /** What goes in `ramBytes`, when the agent reported host memory. */
  ramBytes: number | null;
  /** Apple silicon. The library's own `unifiedMemory` flag still comes
   * from the host the library runs on, so a Mac worker scored by a Linux
   * library is read as a discrete GPU with `vramBytes` of memory. Right
   * for the fits/no line, wrong about the `split` case, which does not
   * exist on one pool. Surfaced so a screen can say so. */
  unifiedMemory: boolean;
}

/** A node as a screen chooses it. */
export interface TargetNode {
  /** Install name; null for an unenrolled single host. */
  name: string | null;
  /** What to print. */
  label: string;
  /** The browser's own machine. */
  local: boolean;
  /** Proxy target that reaches this node's agent. */
  target: string;
  /** As the control root last saw it; always true for the local node. */
  reachable: boolean;
  budget: NodeBudget | null;
}

/** The shape both sources share: the agent's own `/v1/node` and one row
 * of the control root's `/v1/nodes`. */
interface DeviceBearer {
  name?: string | null;
  devices?: ComputeDevice[] | null;
}

function memory(device: ComputeDevice): number {
  return device.memoryFreeBytes ?? device.memoryTotalBytes ?? 0;
}

/** The fit budget a node's own device list implies, or null when the
 * agent reported no devices at all -- detection failed, and the caller
 * should fall back to whatever the library measured rather than score
 * against a fabricated zero. */
export function budgetFromNode(node: DeviceBearer): NodeBudget | null {
  const devices = node.devices ?? [];
  if (devices.length === 0) return null;

  const accelerators = devices.filter((d) => d.kind !== "cpu");
  const gpu = accelerators.reduce<ComputeDevice | null>(
    (best, d) => (best === null || memory(d) > memory(best) ? d : best),
    null,
  );
  const cpu = devices.find((d) => d.kind === "cpu") ?? null;

  return {
    node: node.name ?? null,
    gpu: gpu
      ? {
          name: gpu.name ?? gpu.kind,
          kind: gpu.kind,
          totalBytes: gpu.memoryTotalBytes ?? null,
          freeBytes: memory(gpu),
        }
      : null,
    gpuCount: accelerators.length,
    vramBytes: gpu ? memory(gpu) : 0,
    ramBytes: cpu ? memory(cpu) : null,
    unifiedMemory: gpu?.kind === "metal",
  };
}

/** The query parameters that point a library fit call at this budget.
 * Empty when there is no budget, so the library scores against its own
 * host as before -- the caller spreads this into its params either way. */
export function fitQuery(budget: NodeBudget | null): Record<string, string> {
  if (budget === null) return {};
  const query: Record<string, string> = { vramBytes: String(budget.vramBytes) };
  if (budget.ramBytes !== null) query.ramBytes = String(budget.ramBytes);
  return query;
}

/** One line about a node's hardware, for pickers and headers. */
export function describeBudget(budget: NodeBudget | null): string {
  if (!budget) return "hardware unknown";
  if (!budget.gpu) return "no GPU";
  const gib = (budget.gpu.freeBytes / 1024 ** 3).toFixed(0);
  return `${budget.gpu.name} · ${gib} GiB free${budget.gpuCount > 1 ? ` · ${budget.gpuCount} GPUs` : ""}`;
}

/** The proxy target for a node: the local agent by name, otherwise the
 * node-addressed hop. Exported so a screen that already knows which node
 * it wants (the inference screen, acting on a row) reaches it the same
 * way a picker would. */
export function targetFor(name: string | null, localName: string | null): string {
  return name === null || name === localName ? "agent" : `node:${name}`;
}

interface ControlNodeRow {
  name: string;
  url?: string | null;
  reachable?: boolean;
  devices?: ComputeDevice[] | null;
}

const STORAGE_KEY = "eugene-plexus.targetNode";

function remembered(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function remember(name: string | null): void {
  try {
    if (name === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // A per-browser convenience. Losing it costs one re-pick.
  }
}

/** The nodes an operator can score against and launch on, and which
 * one is chosen.
 *
 * Two reads. The local agent's `/v1/node` always answers and is the
 * default; the control root's `/v1/nodes` adds the rest of the install
 * and fails harmlessly on a standalone host (there is no rest). A
 * remembered choice is honoured only if that node is still enrolled --
 * otherwise a node that left the install would keep being scored
 * against forever.
 *
 * `loaded` distinguishes "still asking" from "asked": a screen should
 * not fall back to the library's own numbers merely because the agent
 * has not answered yet. */
export function useTargetNode(): {
  nodes: TargetNode[];
  selected: TargetNode | null;
  select: (name: string | null) => void;
  budget: NodeBudget | null;
  loaded: boolean;
} {
  const [nodes, setNodes] = useState<TargetNode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [choice, setChoice] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let local: NodeIdentity | null = null;
      try {
        local = await api.get<NodeIdentity>("agent", "/v1/node");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return;
      }
      let rows: ControlNodeRow[] = [];
      try {
        rows = (await api.get<{ nodes?: ControlNodeRow[] }>("control", "/v1/nodes")).nodes ?? [];
      } catch {
        // Standalone, or the root is down or sealed: this host is the
        // only node there is to offer, and it is offered.
      }
      if (cancelled) return;

      const localName = local?.name ?? null;
      const list: TargetNode[] = [];
      list.push({
        name: localName,
        label: localName ?? "this host",
        local: true,
        target: "agent",
        reachable: true,
        budget: local ? budgetFromNode(local) : null,
      });
      for (const row of rows) {
        if (row.name === localName) continue;
        list.push({
          name: row.name,
          label: row.name,
          local: false,
          target: targetFor(row.name, localName),
          reachable: row.reachable ?? true,
          budget: budgetFromNode(row),
        });
      }
      setNodes(list);
      const wanted = remembered();
      setChoice(wanted !== null && list.some((n) => n.name === wanted) ? wanted : localName);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const select = useCallback((name: string | null) => {
    setChoice(name);
    remember(name);
  }, []);

  const selected = useMemo(() => {
    if (choice === undefined) return null;
    return nodes.find((n) => n.name === choice) ?? nodes.find((n) => n.local) ?? null;
  }, [nodes, choice]);

  return { nodes, selected, select, budget: selected?.budget ?? null, loaded };
}
