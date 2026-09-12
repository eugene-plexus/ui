/**
 * Whose memory a fit verdict is about.
 *
 * The library scores a model against the host IT runs on -- its
 * `GET /v1/hardware` says so in its own description -- and in a
 * multi-host install that is frequently the wrong machine. On the first
 * real two-machine install the library lives in a container on a NAS
 * with no GPU, and every model is launched on a worker with an RTX 5090.
 * Discover said "no GPU detected", truthfully, about a machine nobody
 * was ever going to launch on.
 *
 * M3 built the override half: `vramBytes` / `ramBytes` on the fit
 * endpoints, "for a caller who knows the target host's numbers", and
 * deferred the inventory half to "the agent's topology when it is". M7
 * built that inventory -- `ComputeDevice` on the agent's `GET /v1/node`,
 * aggregated into `Node.devices` at the control root. Nothing ever
 * connected the two. This does.
 *
 * WHICH node: the one you are browsing. Launch posts to the local agent,
 * so the machine whose browser you are in is the machine the model will
 * run on, and scoring against any other would recommend a quant for a
 * card the launch never reaches. A node picker -- score here, launch
 * there -- is a design question for the install-wide inference screen,
 * not a default to invent in a helper.
 *
 * WHY THE LARGEST CARD, NOT THE SUM: the library collapses free, total
 * and largest-card into one number when a caller overrides the budget.
 * Handing it the sum of two cards would report `fits` for a model
 * neither card can hold alone; the largest single card's free memory is
 * the number "fits on one card" needs and the conservative one. The cost
 * is that the library's multi-GPU note ("scored against N GPUs summed")
 * cannot appear, because `gpuCount` is not something a caller can pass.
 */

import { useEffect, useState } from "react";

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

function memory(device: ComputeDevice): number {
  return device.memoryFreeBytes ?? device.memoryTotalBytes ?? 0;
}

/** The fit budget a node's own device list implies, or null when the
 * agent reported no devices at all -- detection failed, and the caller
 * should fall back to whatever the library measured rather than score
 * against a fabricated zero. */
export function budgetFromNode(node: NodeIdentity): NodeBudget | null {
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

/** The budget of the node this browser is talking to.
 *
 * `loaded` distinguishes "still asking" from "asked, and this node has
 * nothing to say" -- a screen should not fall back to the library's
 * numbers merely because the agent has not answered yet. */
export function useNodeBudget(): { budget: NodeBudget | null; loaded: boolean } {
  const [state, setState] = useState<{ budget: NodeBudget | null; loaded: boolean }>({
    budget: null,
    loaded: false,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const node = await api.get<NodeIdentity>("agent", "/v1/node");
        if (cancelled) return;
        setState({ budget: budgetFromNode(node), loaded: true });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) return;
        // The library's own reading is the fallback, and the screen says
        // whose it is; a page-level error here would block discovery
        // over a detail of its guidance.
        setState({ budget: null, loaded: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
