"use client";

import { type TargetNode, describeBudget } from "@/lib/nodeBudget";

/**
 * Which node a screen is about.
 *
 * One control for two things that must agree -- whose memory a fit
 * verdict is scored against, and where Launch goes -- because a verdict
 * about node A followed by a launch on node B recommends a quant for a
 * card the launch never reaches.
 *
 * Renders as a plain label on a single-node install: a dropdown with one
 * entry is a question with no answer, and most installs are one box.
 */
export function NodePicker({
  nodes,
  selected,
  onSelect,
}: {
  nodes: TargetNode[];
  selected: TargetNode | null;
  onSelect: (name: string | null) => void;
}) {
  if (!selected) return null;

  const summary = describeBudget(selected.budget);
  const title =
    "Verdicts are scored against this node's free memory, and Launch runs the model here. " +
    "The library itself may run on another machine; its own hardware is not what is measured.";

  if (nodes.length <= 1) {
    return (
      <span className="font-ui text-xs text-[color:var(--muted)]" title={title}>
        {selected.label} · {summary}
      </span>
    );
  }

  return (
    <label className="font-ui flex items-center gap-1.5 text-xs text-[color:var(--muted)]">
      <span title={title}>node</span>
      <select
        value={selected.name ?? ""}
        onChange={(event) => onSelect(event.target.value === "" ? null : event.target.value)}
        className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-2 py-1 text-xs outline-none focus:border-[color:var(--border-hover)]"
        aria-label="Node to score against and launch on"
      >
        {nodes.map((node) => (
          <option key={node.name ?? "__local"} value={node.name ?? ""}>
            {node.label}
            {node.local ? " (here)" : ""}
            {node.reachable ? "" : " (down)"} — {describeBudget(node.budget)}
          </option>
        ))}
      </select>
    </label>
  );
}
