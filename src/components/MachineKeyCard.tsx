"use client";

import { useState } from "react";

import { ConfirmButton } from "@/components/ConfirmButton";
import { api, describeError } from "@/lib/api";
import { CHANGE_KEY_PROMPT, describeMachineKey, type ObservedKeyChange } from "@/lib/machineKey";
import { useNodeLabels } from "@/lib/nodeLabels";
import type { NodeIdentity } from "@/lib/types";

/**
 * One machine's key, and changing it from here (row 3, part 3b).
 *
 * The change runs on that machine, through its own agent: the console never
 * opens another machine's page to do it. It keeps both keys listed until
 * every machine has the new one, so traffic does not stop. A machine also
 * changes its key by itself once a year (`machineKeyChangeDays`).
 */
export function MachineKeyCard({
  name,
  label,
  target,
  identity,
  observed,
  others,
  onChanged,
}: {
  name: string;
  label?: string | null;
  /** The proxy target that reaches this machine's agent. */
  target: string;
  identity: NodeIdentity | null;
  /** The root's view of a change under way (`Node.machineKeyChange`). */
  observed: ObservedKeyChange | null | undefined;
  /** How many other machines hold a machine key. */
  others: number;
  onChanged: () => void | Promise<void>;
}) {
  const labelOf = useNodeLabels();
  const who = label || name;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const view = describeMachineKey({
    who,
    machine: identity?.machine ?? null,
    observed: observed ?? null,
    others,
    labelOf: (n) => labelOf(n) ?? n,
  });
  if (!view) return null;

  async function act(call: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await call();
      await onChanged();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2 text-sm"
      data-testid={`machine-key-${name}`}
    >
      <p className="font-ui font-semibold">{who}</p>
      <ul className="mb-2 space-y-0.5">
        {view.lines.map((line) => (
          <li
            key={line.text}
            className={
              line.tone === "good"
                ? "text-status-success"
                : line.tone === "bad"
                  ? "text-status-error"
                  : "text-[color:var(--muted)]"
            }
          >
            {line.text}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {view.canStart && (
          <ConfirmButton
            label="Change this machine's key now"
            ariaLabel={`Change ${who}'s key now`}
            confirmLabel="Change the key"
            prompt={CHANGE_KEY_PROMPT}
            disabled={busy}
            className="text-sm underline"
            onConfirm={() => act(() => api.post(target, "/v1/node/machine-key", {}))}
          />
        )}
        {view.canStop && (
          <button
            type="button"
            className="text-sm underline"
            aria-label={`Stop the key change on ${who}`}
            disabled={busy}
            onClick={() => void act(() => api.delete(target, "/v1/node/machine-key"))}
          >
            Stop
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-status-error mt-1">
          {error}
        </p>
      )}
    </div>
  );
}
