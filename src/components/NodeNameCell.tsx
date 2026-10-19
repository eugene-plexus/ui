"use client";

/**
 * A machine's name on Machines, and where it is changed
 * (specs `docs/design/node-labels.md`).
 *
 * What people see is the machine's label; its name is its identity and
 * never changes, so it is shown under the label here, the one screen an
 * owner debugging a connection reads it from. Renaming sets the label at
 * the root (`PUT /v1/nodes/{name}/label`), which every console in the
 * install then shows.
 */

import { useState } from "react";

import { api, describeError } from "@/lib/api";
import { nodeLabel } from "@/lib/nodeLabels";

const BUTTON =
  "action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:opacity-50";

export function NodeNameCell({
  node,
  onChanged,
}: {
  node: { name: string; label?: string | null };
  onChanged: () => void;
}) {
  const shown = nodeLabel(node);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(shown);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const path = `/v1/nodes/${encodeURIComponent(node.name)}/label`;

  async function save(label: string | null) {
    setBusy(true);
    setProblem(null);
    try {
      if (label === null || label.trim() === "" || label.trim() === node.name) {
        await api.delete("control", path);
      } else {
        await api.put("control", path, { label: label.trim() });
      }
      setEditing(false);
      onChanged();
    } catch (e) {
      setProblem(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span data-testid={`node-label-${node.name}`}>{shown}</span>
        <button
          type="button"
          className="font-ui text-sm font-normal underline"
          onClick={() => {
            setDraft(shown);
            setProblem(null);
            setEditing(true);
          }}
          aria-label={`Rename ${shown}`}
          data-testid={`node-rename-${node.name}`}
        >
          Rename
        </button>
        {shown !== node.name ? (
          <div
            className="basis-full font-mono text-xs font-normal text-[color:var(--muted)]"
            title="Its name in this install, which addresses and logs use. It never changes."
          >
            {node.name}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <form
      className="font-normal"
      onSubmit={(e) => {
        e.preventDefault();
        void save(draft);
      }}
    >
      <label className="block">
        <span className="sr-only">New name for {shown}</span>
        <input
          className="font-ui w-56 rounded-[var(--radius)] border border-[color:var(--border)] bg-transparent px-2 py-1 text-sm"
          value={draft}
          maxLength={64}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          data-testid={`node-label-input-${node.name}`}
        />
      </label>
      <div className="mt-1 flex flex-wrap gap-2">
        <button type="submit" className={BUTTON} disabled={busy}>
          Save
        </button>
        {node.label ? (
          <button type="button" className={BUTTON} disabled={busy} onClick={() => void save(null)}>
            Use {node.name}
          </button>
        ) : null}
        <button type="button" className={BUTTON} disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
      {problem ? (
        <p role="alert" className="text-status-error mt-1 max-w-sm text-sm">
          {problem}
        </p>
      ) : null}
    </form>
  );
}
