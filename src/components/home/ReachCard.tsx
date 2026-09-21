"use client";

import { useCallback, useState } from "react";

import { CopyButton } from "@/components/CopyButton";
import { api, describeError } from "@/lib/api";
import {
  canRestartHere,
  evidence,
  firewallNote,
  headline,
  listening,
  reachState,
  startsWhen,
} from "@/lib/reach";
import type { NodeReach, NodeReachResult } from "@/lib/types";

/**
 * "Reach it from other devices": one switch, and three honest lines.
 *
 * Hobbyist UX §6.1 and §7 S5, decision #8. The state it replaces is an
 * install that answers only `127.0.0.1` with nothing saying so — the
 * person opens the address on their phone, gets *connection refused*,
 * and has no way to tell whether the problem is Eugene, the firewall,
 * the router or the address they typed.
 *
 * **The card never claims reach it has not got.** Three things have to
 * be true and each fails identically from outside, so each gets its own
 * line and its own remedy, and the only *proof* it will ever show is a
 * connection something off this machine actually made. A firewall
 * verdict is evidence about rules; it is not evidence about
 * reachability, and the card does not present it as such.
 *
 * **Turning it on does not restart Eugene unless the person says so.**
 * The agent's own socket is fixed for the life of the process, so the
 * change is only half done until it restarts — which this card says,
 * rather than reporting success and leaving somebody to discover it on
 * their phone. Restart is a second, explicit button, and it is absent
 * entirely where nothing would start the agent again: a browser click
 * must not be able to end an install.
 */
export function ReachCard({
  reach,
  onChanged,
}: {
  /** This machine's reach, from `GET /v1/node`; null until it answers. */
  reach: NodeReach | null;
  /** Called after the switch changes anything, so Home re-reads. */
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<NodeReachResult["steps"] | null>(null);

  const state = reachState(reach);

  const send = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const result = await api.post<NodeReachResult>("agent", "/v1/node/reach", body);
        setSteps(result.steps);
        onChanged();
        return result;
      } catch (e) {
        setError(describeError(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [onChanged],
  );

  if (state.kind === "loading") return null;

  const on = state.kind !== "off";
  const note = firewallNote(reach);
  const proof = evidence(reach);
  const bound = listening(reach);
  const startsAt = startsWhen(reach);
  const remedy = state.kind === "blocked" ? state.remedy : null;

  return (
    <section
      data-testid="home-reach"
      className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-ui text-sm font-semibold">Reach it from other devices</h2>
        <button
          type="button"
          data-testid="reach-switch"
          role="switch"
          aria-checked={on}
          disabled={busy || (state.kind === "off" && state.proposed === null)}
          onClick={() => void send({ enabled: !on, allowFirewall: !on })}
          className="font-ui rounded-[var(--radius)] border border-[color:var(--accent-left)] px-3 py-1 text-sm font-semibold disabled:opacity-50"
        >
          {busy ? "Working…" : on ? "Turn off" : "Turn on"}
        </button>
      </div>

      <p data-testid="reach-headline" className="font-ui mt-1 text-sm text-[color:var(--muted)]">
        {headline(state)}
      </p>

      {state.kind === "restart-needed" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {canRestartHere(reach) ? (
            <button
              type="button"
              data-testid="reach-restart"
              disabled={busy}
              onClick={() => void send({ enabled: true, restartAgent: true })}
              className="font-ui rounded-[var(--radius)] border border-[color:var(--accent-left)] px-3 py-1 text-sm font-semibold disabled:opacity-50"
            >
              Restart Eugene
            </button>
          ) : (
            <p className="font-ui text-[0.6875rem] text-[color:var(--muted)]">
              Nothing starts Eugene on this machine automatically, so it cannot restart itself. Stop
              it and start it again the way you started it
              {state.command ? ": " : "."}
              {state.command && <code className="font-mono">{state.command}</code>}
            </p>
          )}
          <span className="font-ui text-[0.6875rem] text-[color:var(--muted)]">
            This page will reconnect on its own.
          </span>
        </div>
      )}

      {remedy && (
        <div className="mt-2">
          <p className="font-ui text-[0.6875rem] text-[color:var(--muted)]">
            Allow it by running this as administrator:
          </p>
          <div className="mt-1 flex items-start gap-2">
            <pre
              data-testid="reach-remedy"
              className="min-w-0 flex-1 overflow-x-auto rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--bg)] p-2 font-mono text-[0.6875rem]"
            >
              {remedy}
            </pre>
            <CopyButton text={remedy} title="Copy the firewall command" />
          </div>
        </div>
      )}

      {proof && (
        <p
          data-testid="reach-evidence"
          className="font-ui status-ok mt-2 rounded-[var(--radius)] px-2 py-1 text-[0.6875rem]"
        >
          {proof}
        </p>
      )}

      {note && (
        <p
          data-testid="reach-note"
          className="font-ui mt-2 text-[0.6875rem] text-[color:var(--muted)]"
        >
          {note}
        </p>
      )}

      {error && (
        <p
          data-testid="reach-error"
          className="status-error mt-2 rounded-[var(--radius)] px-2 py-1 text-[0.6875rem]"
        >
          {error}
        </p>
      )}

      {steps && steps.some((s) => !s.ok) && (
        <ul data-testid="reach-steps" className="mt-2 flex flex-col gap-1">
          {steps
            .filter((s) => !s.ok)
            .map((s) => (
              <li key={s.step} className="font-ui text-[0.6875rem] text-[color:var(--muted)]">
                {s.detail ?? `${s.step} did not work.`}
              </li>
            ))}
        </ul>
      )}

      {/* **What starts Eugene, in every state.** R2.6 made a Windows
          install a service that comes back at boot before anyone signs
          in; an install made before it is a logon task that does not,
          and until now no screen could tell the two apart. The agent has
          put this on the wire since S5 and nothing read it. */}
      {startsAt && (
        <p
          data-testid="reach-starts"
          className="font-ui mt-2 text-[0.6875rem] text-[color:var(--muted)]"
        >
          {startsAt}
        </p>
      )}

      <p className="font-ui mt-2 border-t border-[color:var(--border)] pt-1 text-[0.6875rem] text-[color:var(--muted)]">
        {bound && (
          <>
            Listening: <code className="font-mono">{bound}</code>.{" "}
          </>
        )}
        {/* `cross-link-related-settings` (Troy, standing): the other half
            of this switch is the agent's own Advertise address field,
            which is the expert override and wins over anything chosen
            here. Both halves name each other; a half added without its
            link is a defect. */}
        To type the address yourself — a machine with several networks, or a container published on
        a different port —{" "}
        <a href="/config?sel=agent" className="underline">
          set the advertise address in this machine&rsquo;s Config
        </a>
        .
      </p>
    </section>
  );
}
