"use client";

/**
 * Change Eugene's passphrase, from the owner's row on People (row 5, 5b).
 *
 * Posts to this machine's agent (`POST /v1/auth/passphrase`), which hands
 * it to the control root. The root re-wraps every key it keeps, and sends
 * the new passphrase to each machine that keeps one of its own. The answer
 * lists each machine, so the owner sees which ones still need a sign-in.
 */

import { useState } from "react";
import { api, describeError } from "@/lib/api";
import type { components } from "@/generated/agent";

type Result = components["schemas"]["PassphraseChangeResult"];
type Machine = components["schemas"]["PassphraseMachine"];

const MIN_PASSPHRASE = 12;

/** One line for each machine, as the owner reads it. */
export function machineLine(machine: Machine): string {
  if (machine.state === "changed")
    return machine.detail
      ? `${machine.node}: changed, but ${machine.detail}`
      : `${machine.node}: changed`;
  if (machine.state === "plain") return `${machine.node}: not sent: reached in plain HTTP`;
  return `${machine.node}: changes at its next sign-in`;
}

export function PassphraseChange({
  inputClass,
  primaryClass,
}: {
  inputClass: string;
  primaryClass: string;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const short = next.length > 0 && next.length < MIN_PASSPHRASE;
  const differs = again.length > 0 && again !== next;
  const ready = current.length > 0 && next.length >= MIN_PASSPHRASE && again === next;

  async function submit() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.post<Result>("agent", "/v1/auth/passphrase", { current, new: next }));
      setCurrent("");
      setNext("");
      setAgain("");
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex min-w-0 flex-col gap-3 text-sm"
      data-testid="passphrase-change"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void submit();
      }}
    >
      <h4 className="font-ui font-semibold">Change passphrase</h4>
      <p className="text-[color:var(--muted)]">
        The keys the passphrase protects stay the same. It does not change the root token key, and
        the console cannot change that key yet. A copy of Eugene made before the change still opens
        with the old passphrase. After a leak, also change the sign-in key, under Apps that sign in
        with Eugene.
      </p>
      <label className="flex max-w-sm flex-col gap-2">
        Current passphrase
        <input
          type="password"
          autoComplete="current-password"
          className={inputClass}
          value={current}
          disabled={busy}
          required
          onChange={(e) => setCurrent(e.target.value)}
        />
      </label>
      <label className="flex max-w-sm flex-col gap-2">
        New passphrase
        <input
          type="password"
          autoComplete="new-password"
          className={inputClass}
          value={next}
          disabled={busy}
          minLength={MIN_PASSPHRASE}
          required
          onChange={(e) => setNext(e.target.value)}
        />
      </label>
      <label className="flex max-w-sm flex-col gap-2">
        New passphrase again
        <input
          type="password"
          autoComplete="new-password"
          className={inputClass}
          value={again}
          disabled={busy}
          required
          onChange={(e) => setAgain(e.target.value)}
        />
      </label>
      {short && <p className="status-warn">At least {MIN_PASSPHRASE} characters.</p>}
      {differs && <p className="status-warn">The two new passphrases differ.</p>}
      <button type="submit" className={`${primaryClass} self-start`} disabled={busy || !ready}>
        Change passphrase
      </button>
      {error && (
        <p role="alert" className="status-error">
          {error}
        </p>
      )}
      {result && (
        <div role="status" className="flex flex-col gap-1" data-testid="passphrase-changed">
          <p className="status-success">Passphrase changed.</p>
          {result.cleanup && (
            <p className="status-warn">
              Old copies could not be removed yet: {result.cleanup}. Eugene tries again every hour.
            </p>
          )}
          {result.passphraseFile === "old" && (
            <p className="status-warn">
              The passphrase file still holds the old passphrase. Put the new one in it, or Eugene
              stays locked after a restart until someone signs in.
            </p>
          )}
          {result.machines.length > 0 && (
            <ul className="flex flex-col gap-1">
              {result.machines.map((machine) => (
                <li key={machine.node} title={machine.detail ?? undefined}>
                  {machineLine(machine)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
