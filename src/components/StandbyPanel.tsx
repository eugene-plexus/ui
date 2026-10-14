"use client";

/**
 * The warm standby, on Machines (specs `docs/design/warm-standby.md`).
 *
 * One machine at a time keeps a copy of the control root, so the install
 * can switch to it if this one stops for good. Choosing it is an owner's
 * action at the root (`PUT /v1/nodes/{name}/standby`); that machine's own
 * agent then starts the copy, so nothing is typed anywhere else. The
 * question is asked first and says the trade in plain words: the copy
 * holds the locked keys.
 */

import { useState } from "react";

import { api, describeError } from "@/lib/api";
import {
  isStandby,
  makeStandbyQuestion,
  standbyWords,
  stopStandbyQuestion,
  type StandbyStatus,
} from "@/lib/standby";

const BUTTON =
  "action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:opacity-50";

export interface StandbyNode {
  name: string;
  grants?: string[] | null;
}

export function StandbyPanel({
  nodes,
  standbys,
  onChanged,
}: {
  nodes: StandbyNode[];
  standbys: StandbyStatus[];
  onChanged: () => void;
}) {
  const current = nodes.find((n) => isStandby(n.grants))?.name ?? null;
  const reported = standbys.find((s) => s.node === current) ?? null;
  const [picked, setPicked] = useState("");
  const [asking, setAsking] = useState<"make" | "stop" | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function act(make: boolean) {
    const name = make ? picked : current;
    if (!name) return;
    setBusy(true);
    setProblem(null);
    try {
      const path = `/v1/nodes/${encodeURIComponent(name)}/standby`;
      if (make) await api.put("control", path, undefined);
      else await api.delete("control", path);
      setAsking(null);
      setPicked("");
      onChanged();
    } catch (e) {
      setProblem(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="standby" className="section-panel mb-6" data-testid="standby-panel">
      <h2 className="section-heading font-ui text-base font-semibold">Standby</h2>
      <p className="mb-3 text-sm text-[color:var(--muted)]">
        A standby keeps a copy of this install&rsquo;s control root on another machine. If this
        machine stops for good, you can switch to the copy with your passphrase.
      </p>
      {current ? (
        <div className="space-y-2">
          <p data-testid="standby-state">
            <span className="font-medium">{current}</span> is the standby.{" "}
            <span className="text-[color:var(--muted)]">
              {reported ? standbyWords(reported) : standbyWords({ node: current })}
            </span>
          </p>
          {asking === "stop" ? (
            <div className="space-y-2" data-testid="standby-ask">
              <p>{stopStandbyQuestion(current)}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={BUTTON}
                  disabled={busy}
                  onClick={() => void act(false)}
                >
                  Yes, stop it
                </button>
                <button
                  type="button"
                  className={BUTTON}
                  disabled={busy}
                  onClick={() => setAsking(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={BUTTON} onClick={() => setAsking("stop")}>
              Stop being the standby
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm" data-testid="standby-state">
            No machine is the standby.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <span>Machine</span>
              <select
                data-testid="standby-pick"
                value={picked}
                disabled={busy || nodes.length === 0}
                onChange={(e) => {
                  setPicked(e.target.value);
                  setAsking(null);
                }}
              >
                <option value="">Choose a machine</option>
                {nodes.map((n) => (
                  <option key={n.name} value={n.name}>
                    {n.name}
                  </option>
                ))}
              </select>
            </label>
            {asking !== "make" && (
              <button
                type="button"
                className={BUTTON}
                disabled={!picked || busy}
                onClick={() => setAsking("make")}
              >
                Make it the standby
              </button>
            )}
          </div>
          {asking === "make" && picked && (
            <div className="space-y-2" data-testid="standby-ask">
              <p>{makeStandbyQuestion(picked)}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={BUTTON}
                  disabled={busy}
                  onClick={() => void act(true)}
                >
                  Yes, make it the standby
                </button>
                <button
                  type="button"
                  className={BUTTON}
                  disabled={busy}
                  onClick={() => setAsking(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {problem && (
        <p
          role="alert"
          className="status-warn mt-2 rounded-[var(--radius)] border px-3 py-2 text-sm"
        >
          {problem}
        </p>
      )}
    </section>
  );
}
