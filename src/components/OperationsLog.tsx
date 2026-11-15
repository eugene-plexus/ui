"use client";

import { useCallback, useState } from "react";

import { api, describeError } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";

/** One row of a machine's operations log (`agent.yaml` `OperationRecord`). */
export interface OperationRow {
  at: string;
  component: string;
  personId: string;
  name: string;
  owner: boolean;
  power?: string | null;
  action: string;
  target: string;
  status: number;
}

/** "Dana: stop runtime qwen3-32b, 14:05" -- who, what, to what, when. */
export function operationSentence(row: OperationRow): string {
  const when = new Date(row.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const what = [row.action, row.target].filter(Boolean).join(" ");
  const failed = row.status >= 400 ? ` (refused, ${row.status})` : "";
  return `${row.name}: ${what}, ${when}${failed}`;
}

/**
 * Who changed what on one machine (row 39): every change made through a
 * route in the operations table, by the owner or a person with an
 * operations power. Owner only; the agent keeps 90 days.
 */
export function OperationsLog({ target, label }: { target: string; label: string }) {
  const [rows, setRows] = useState<OperationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const answer = await api.get<{ entries: OperationRow[] }>(
        target,
        "/v1/node/operations-log?limit=50",
      );
      if (!Array.isArray(answer?.entries)) {
        setError("The machine answered without a list of changes.");
        return;
      }
      setRows(answer.entries);
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }, [target]);
  usePolling(load, 30_000);
  return (
    <div data-testid={`operations-log-${label}`} className="text-sm">
      <h3 className="font-ui font-semibold">{label}</h3>
      {error && <p className="status-warn">Changes could not be read. {error}</p>}
      {rows !== null && rows.length === 0 && (
        <p className="text-[color:var(--muted)]">No changes recorded.</p>
      )}
      {rows !== null && rows.length > 0 && (
        <ul className="list-inside list-disc">
          {rows.map((row, i) => (
            <li key={`${row.at}-${i}`} title={new Date(row.at).toLocaleString()}>
              {operationSentence(row)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
