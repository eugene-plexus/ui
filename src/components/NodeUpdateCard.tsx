"use client";

import { useEffect, useState } from "react";

import { ConfirmButton } from "@/components/ConfirmButton";
import { CopyButton } from "@/components/CopyButton";
import { api, describeError } from "@/lib/api";
import type { NodeIdentity } from "@/lib/types";
import { describeUpdate } from "@/lib/updates";

/** After this long without the machine reporting back, say so. */
const NO_WORD_MS = 15 * 60 * 1000;

/**
 * One machine's version, and updating it from here.
 *
 * The update runs on that machine, outside Eugene, and restarts it: the
 * page loses it for a minute or two and then reads it again. Until the
 * machine reports how it went, the card says it is updating, whatever the
 * reads in between answer -- a machine that is restarting does not answer
 * at all, and that silence is the update working, not failing.
 */
export function NodeUpdateCard({
  name,
  target,
  identity,
  loaded,
  now,
  onChanged,
  onUpdating,
}: {
  name: string;
  /** The proxy target that reaches this machine's agent. */
  target: string;
  identity: NodeIdentity | null;
  loaded: boolean;
  now: number;
  onChanged: () => void | Promise<void>;
  onUpdating?: (updating: boolean) => void;
}) {
  const [busy, setBusy] = useState<"checking" | "updating" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState<{ at: number; label: string } | null>(null);
  const view = describeUpdate(identity, now);

  // An update this page asked for is over once the machine says it finished
  // after the request -- or, having never reported back, after a long wait.
  const finished =
    requested !== null &&
    identity?.update?.last?.finishedAt != null &&
    Date.parse(identity.update.last.finishedAt) >= requested.at - 60_000;
  const waiting = requested !== null && !finished && now - requested.at < NO_WORD_MS;
  const silent = requested !== null && !finished && now - requested.at >= NO_WORD_MS;
  const over = requested !== null && (finished || silent);
  useEffect(() => {
    if (!over) return;
    setRequested(null);
    onUpdating?.(false);
  }, [over, onUpdating]);

  async function check() {
    setBusy("checking");
    setError(null);
    try {
      await api.post(target, "/v1/node/update/check", {});
      await onChanged();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  async function update() {
    if (!view.target) return;
    setBusy("updating");
    setError(null);
    try {
      await api.post(target, "/v1/node/update", { target: view.target });
      setRequested({ at: Date.now(), label: view.headline });
      onUpdating?.(true);
      await onChanged();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  // Before the first read answers, the machine has not failed to answer:
  // "This machine did not answer" was shown while it was still loading.
  const reading = !loaded && identity === null;
  const headline = waiting
    ? `Updating ${name}`
    : reading
      ? "Reading this machine's version…"
      : view.headline;
  const detail = waiting
    ? "Eugene on this machine is restarting with the new version. This page picks it up again when it is back."
    : silent
      ? "It has not reported back after fifteen minutes. Check that machine."
      : reading
        ? null
        : view.detail;
  const tone =
    view.state === "failed" || silent
      ? "status-error"
      : view.state === "available" || view.state === "manual"
        ? "status-warn"
        : "";

  return (
    <section
      data-testid="node-update"
      data-node={name}
      data-state={waiting ? "running" : view.state}
      className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-ui text-sm font-semibold">{name}</h3>
        <span data-testid="node-version" className="font-mono text-xs text-[color:var(--muted)]">
          {loaded ? view.version : "…"}
        </span>
      </div>
      <p
        data-testid="node-update-headline"
        className={`mt-2 text-sm ${tone ? `${tone} rounded-[var(--radius)] border px-2 py-1` : ""}`}
      >
        {headline}
      </p>
      {detail && (
        <p data-testid="node-update-detail" className="mt-1 text-sm text-[color:var(--muted)]">
          {detail}
        </p>
      )}
      {!waiting && view.steps.length > 0 && (
        <ol data-testid="node-update-steps" className="mt-2 list-decimal space-y-1 pl-5 text-sm">
          {view.steps.map((step, i) => (
            <li key={i}>
              {step.text}
              {step.command && (
                <span className="mt-1 flex items-center gap-2">
                  <code className="font-mono text-xs break-all">{step.command}</code>
                  <CopyButton text={step.command} />
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {!waiting && view.state === "current" && view.last?.outcome === "succeeded" && (
        <p className="mt-1 text-sm text-[color:var(--muted)]">{view.last.detail}</p>
      )}
      {!waiting && identity?.update && view.state !== "development" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {view.canUpdate && (
            <ConfirmButton
              testId="node-update-now"
              label={busy === "updating" ? "Starting…" : "Update"}
              confirmLabel={`Update ${name}`}
              prompt={`${name} restarts, and the models on it stop for a minute or two.`}
              disabled={busy !== null}
              onConfirm={update}
              className="action-button action-button--primary font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1.5 text-sm font-medium text-[color:var(--on-accent-left)] hover:brightness-110 disabled:opacity-50"
            />
          )}
          <button
            type="button"
            data-testid="node-update-check"
            onClick={check}
            disabled={busy !== null}
            className="action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5 text-sm hover:bg-[color:var(--panel-hover)] disabled:opacity-50"
          >
            {busy === "checking" ? "Checking…" : "Check now"}
          </button>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="status-error mt-2 rounded-[var(--radius)] border px-2 py-1 text-sm"
        >
          {error}
        </p>
      )}
    </section>
  );
}
