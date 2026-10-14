"use client";

import { useEffect, useState } from "react";

import { api, describeError } from "@/lib/api";
import type { TargetNode } from "@/lib/nodeBudget";
import { runtimesForModel } from "@/lib/runningModel";
import { formatBytesShort } from "@/lib/tasks";
import type { LibraryModel, ModelDeleted, ModelDeletion, Runtime, RuntimeList } from "@/lib/types";

/**
 * Delete a model from the Library, any format (LS8,
 * library-sources-and-engines.md §6.11; Troy: a Delete for every model).
 *
 * The Library plans it (`GET /v1/models/{id}/deletion`): every file it
 * removes and its size, files kept because another model uses them, the
 * saved profiles, and prepared models made from it. The console adds what
 * only it can see: every node's runtimes for this model. Refused while any
 * node runs it; the runtimes declared for it are removed once its files
 * are gone, so nothing points at a file that is not there.
 */

/** A node's runtimes that name this model, and whether one runs. */
export interface NodeRuntimes {
  node: TargetNode;
  runtimes: Runtime[];
  /** Why this node's runtimes could not be read; null when they were. */
  error: string | null;
}

export function isRunning(runtime: Runtime): boolean {
  return (
    runtime.status !== "stopped" && runtime.status !== "exited" && runtime.status !== "crashed"
  );
}

/** Why the console will not delete it now, or null. */
export function blockedBy(found: NodeRuntimes[]): string | null {
  const running = found.flatMap((n) =>
    n.runtimes.filter(isRunning).map((r) => `${r.name} on ${n.node.label}`),
  );
  if (running.length > 0) {
    return `It is running (${running.join(", ")}): stop it there first.`;
  }
  const unread = found.filter((n) => n.error !== null);
  if (unread.length > 0) {
    return `Could not ask ${unread.map((n) => n.node.label).join(", ")} whether it runs it (${unread[0]!.error}).`;
  }
  return null;
}

export function DeleteModel({
  model,
  nodes,
  onDeleted,
}: {
  model: LibraryModel;
  nodes: TargetNode[];
  onDeleted: (deleted: ModelDeleted) => void;
}) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<ModelDeletion | null>(null);
  const [found, setFound] = useState<NodeRuntimes[] | null>(null);
  const [also, setAlso] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPlan(null);
    setFound(null);
    setError(null);
    void (async () => {
      try {
        const answer = await api.get<ModelDeletion>(
          "library",
          `/v1/models/${encodeURIComponent(model.id)}/deletion`,
        );
        if (!cancelled) setPlan(answer);
      } catch (err) {
        if (!cancelled) setError(describeError(err));
      }
      const each = await Promise.all(
        nodes
          .filter((n) => n.reachable)
          .map(async (node): Promise<NodeRuntimes> => {
            try {
              const list = await api.get<RuntimeList>(node.target, "/v1/runtimes");
              return { node, runtimes: runtimesForModel(model, list.runtimes), error: null };
            } catch (err) {
              return { node, runtimes: [], error: describeError(err) };
            }
          }),
      );
      if (!cancelled) setFound(each);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, model, nodes]);

  const blocked = found ? blockedBy(found) : null;
  const refusal = plan?.refusal ?? blocked;
  const declared = (found ?? []).flatMap((n) => n.runtimes.map((r) => ({ node: n.node, r })));

  async function confirm() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const done = await api.post<ModelDeleted>(
        "library",
        `/v1/models/${encodeURIComponent(model.id)}/delete`,
        { token: plan.token, ...(also.length ? { alsoDelete: also } : {}) },
      );
      // Nothing may point at a file that is gone.
      for (const { node, r } of declared) {
        try {
          await api.delete<void>(node.target, `/v1/runtimes/${encodeURIComponent(r.name)}`);
        } catch {
          // Its file is gone; the runtime says so when it is next started.
        }
      }
      setOpen(false);
      onDeleted(done);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  const freed =
    (plan?.bytesFreed ?? 0) +
    (plan?.preparedFrom ?? [])
      .filter((p) => also.includes(p.id))
      .reduce((sum, p) => sum + p.bytesFreed, 0);

  if (!open) {
    return (
      <div>
        <button
          type="button"
          data-testid="delete-model"
          onClick={() => setOpen(true)}
          className="action-button font-ui status-error rounded-[var(--radius)] border px-3 py-1 text-sm"
        >
          Delete…
        </button>
      </div>
    );
  }

  return (
    <section
      data-testid="delete-model-confirm"
      className="status-error flex flex-col gap-2 rounded-[var(--radius)] border px-4 py-3 text-sm"
    >
      <p className="font-ui font-semibold">Delete {model.name} from the Library and from disk?</p>
      {!plan && !error && <p>Reading what it is made of…</p>}
      {plan && (
        <>
          <p>
            Removes {plan.files.length} file{plan.files.length === 1 ? "" : "s"} (
            {formatBytesShort(plan.bytesFreed)})
            {plan.profiles > 0
              ? ` and ${plan.profiles} saved profile${plan.profiles === 1 ? "" : "s"}`
              : ""}
            . This cannot be undone.
          </p>
          <ul data-testid="delete-files" className="max-h-40 overflow-y-auto font-mono text-xs">
            {plan.files.map((f) => (
              <li key={f.path} className="break-all">
                {f.path} · {formatBytesShort(f.sizeBytes ?? 0)}
              </li>
            ))}
          </ul>
          {plan.kept.length > 0 && (
            <div data-testid="delete-kept">
              <p>Kept, because other models use them:</p>
              <ul className="font-mono text-xs">
                {plan.kept.map((k) => (
                  <li key={k.path} className="break-all">
                    {k.path} · used by {k.usedBy.map((u) => u.name).join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {plan.preparedFrom.length > 0 && (
            <div data-testid="delete-prepared-from">
              <p>
                Prepared from it, which stop working without it (their engine reads it while it runs
                them):
              </p>
              {plan.preparedFrom.map((p) => (
                <label key={p.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={also.includes(p.id)}
                    disabled={!!p.refusal}
                    onChange={(e) =>
                      setAlso(e.target.checked ? [...also, p.id] : also.filter((x) => x !== p.id))
                    }
                  />
                  Delete {p.name} too ({formatBytesShort(p.bytesFreed)})
                  {p.refusal && <span className="text-xs"> · {p.refusal}</span>}
                </label>
              ))}
            </div>
          )}
          {declared.length > 0 && !blocked && (
            <p data-testid="delete-runtimes">
              Its settings on{" "}
              {declared.map(({ node, r }) => `${node.label} (${r.name})`).join(", ")} are removed
              too.
            </p>
          )}
        </>
      )}
      {refusal && (
        <p data-testid="delete-refused" role="alert">
          {refusal}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-[var(--radius)] border px-3 py-2">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          data-testid="delete-confirm"
          disabled={busy || !plan || !found || !!refusal}
          onClick={() => void confirm()}
          className="action-button font-ui rounded-[var(--radius)] border px-3 py-1 font-medium"
        >
          {busy ? "Deleting…" : `Delete${freed ? ` and free ${formatBytesShort(freed)}` : ""}`}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className="underline">
          Cancel
        </button>
      </div>
    </section>
  );
}
