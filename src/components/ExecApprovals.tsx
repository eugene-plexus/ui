"use client";

import { useCallback, useEffect, useState } from "react";

import { api, describeError } from "@/lib/api";
import type { ExecApproval, ExecApprovalList } from "@/lib/types";

/** A machine whose agent keeps approvals, as Settings names it. */
export interface ApprovalMachine {
  target: string;
  label: string;
}

interface Listed {
  machine: ApprovalMachine;
  approval: ExecApproval;
}

/** What Settings' search finds this card by. */
export const EXEC_APPROVALS_SEARCH_TEXTS = [
  "Approved programs",
  "approve",
  "program",
  "engine binary",
  "Eugene's own account",
];

/**
 * The programs an owner approved for Eugene's own account (row 8, part 8c):
 * each one runs although one other account can change it, so that account
 * can act as Eugene. Remove takes an approval back; the program asks again
 * from its next start. Shown only when some machine has one.
 *
 * `machines` must keep its identity between renders (a memo): every new
 * array reads every machine again.
 */
export function ExecApprovals({ machines }: { machines: ApprovalMachine[] }) {
  const [listed, setListed] = useState<Listed[]>([]);
  const [error, setError] = useState<string | null>(null);
  const read = useCallback(async () => {
    const all = await Promise.all(
      machines.map(async (machine) => {
        try {
          const got = await api.get<ExecApprovalList>(machine.target, "/v1/exec-approvals");
          return got.approvals.map((approval) => ({ machine, approval }));
        } catch {
          // An agent from before 8c, or one not answering: Settings says
          // which machines it could not read; there is nothing to list.
          return [];
        }
      }),
    );
    setListed(all.flat());
  }, [machines]);
  useEffect(() => {
    void read();
  }, [read]);

  async function remove(item: Listed) {
    try {
      await api.delete(
        item.machine.target,
        `/v1/exec-approvals/${encodeURIComponent(item.approval.id)}`,
      );
      setError(null);
      await read();
    } catch (err) {
      setError(`${item.approval.path} was not taken back: ${describeError(err)}`);
    }
  }

  if (listed.length === 0 && error === null) return null;
  return (
    <section data-testid="exec-approvals" data-topic="exec-approvals" className="section-panel">
      <h2 className="section-heading font-ui text-base font-semibold">Approved programs</h2>
      <p className="mt-0.5 mb-3 text-sm text-[color:var(--muted)]">
        Eugene&apos;s own account runs these although another account can change them. That account
        can act as Eugene.
      </p>
      <ul className="flex flex-col gap-2">
        {listed.map((item) => (
          <li
            key={`${item.machine.target}\n${item.approval.id}`}
            data-testid="exec-approval-row"
            className="flex flex-wrap items-center justify-between gap-2 text-sm"
          >
            <span className="min-w-0 break-all">
              <span className="font-mono">{item.approval.path}</span>
              <span className="text-[color:var(--muted)]">
                {" · "}
                {item.machine.label}
                {" · "}
                {item.approval.account} can change it, and so act as Eugene
              </span>
            </span>
            <button
              type="button"
              onClick={() => void remove(item)}
              className="action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-0.5 text-sm text-[color:var(--foreground)] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p
          role="alert"
          className="status-error mt-2 rounded-[var(--radius)] border px-3 py-2 text-sm"
        >
          {error}
        </p>
      )}
    </section>
  );
}
