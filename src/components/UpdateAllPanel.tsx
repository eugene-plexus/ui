"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, describeError } from "@/lib/api";
import type { UpdateAllRun, UpdateAllStatus } from "@/lib/types";
import { ConfirmButton } from "./ConfirmButton";

const labels = {
  pending: "Waiting",
  checking: "Checking",
  updating: "Updating",
  updated: "Updated",
  current: "Current",
  manual: "Manual update needed",
  failed: "Failed",
  skipped: "Not updated",
};

export function UpdateAllPanel({ onChanged }: { onChanged: () => void | Promise<void> }) {
  const [run, setRun] = useState<UpdateAllRun | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = useRef<UpdateAllRun | null>(null);
  const revision = useRef(0);
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  }, [onChanged]);
  const accept = useCallback((next: UpdateAllRun | null) => {
    if (last.current?.state === "running" && next && next.state !== "running")
      void changed.current();
    last.current = next;
    setRun(next);
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const readingRevision = revision.current;
      try {
        const status = await api.get<UpdateAllStatus>("agent", "/v1/updates/all", {
          timeoutMs: 10_000,
        });
        if (!stopped && readingRevision === revision.current) {
          accept(status.run ?? null);
          setError(null);
          setUnsupported(false);
          setLoaded(true);
        }
      } catch (e) {
        if (!stopped && readingRevision === revision.current) {
          setUnsupported(e instanceof ApiError && e.status === 404);
          setError(describeError(e));
          setLoaded(true);
        }
      } finally {
        if (!stopped) timer = setTimeout(poll, last.current?.state === "running" ? 3_000 : 15_000);
      }
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [accept]);

  async function start() {
    revision.current++;
    setBusy(true);
    setError(null);
    try {
      const next = await api.post<UpdateAllRun>("agent", "/v1/updates/all", {});
      revision.current++;
      accept(next);
    } catch (e) {
      setError(
        `${describeError(e)} Progress will be checked again; a lost reply does not mean the job stopped.`,
      );
    } finally {
      setBusy(false);
    }
  }

  const running = run?.state === "running";
  return (
    <div
      className="mb-4 rounded-[var(--radius)] border border-[color:var(--border)] p-3"
      data-testid="update-all-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-ui text-sm font-semibold">Update the whole install</h3>
          <p className="text-sm text-[color:var(--muted)]">
            Updates machines on their chosen channels, then their installed apps, including
            Workbench. Containers use their host&apos;s update controls.
          </p>
        </div>
        <ConfirmButton
          label={busy ? "Starting…" : running ? "Update in progress" : "Update all"}
          confirmLabel="Start updates"
          cancelLabel="Cancel"
          prompt="Updates the root first, then one machine at a time. Models and apps stop during their updates. Save active work before continuing."
          disabled={!loaded || busy || running || unsupported || !!error}
          onConfirm={start}
          testId="update-all"
          className="action-button action-button--primary font-ui rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1.5 text-sm text-[color:var(--on-accent-left)] disabled:opacity-50"
        />
      </div>
      {unsupported ? (
        <p className="mt-2 text-sm">
          Update this console&apos;s machine once to enable Update all.
        </p>
      ) : (
        error && (
          <p role="alert" className="status-warn mt-2 text-sm">
            {running ? `Waiting to reconnect. The update continues on Eugene. ${error}` : error}
          </p>
        )
      )}
      {run && (
        <div className="mt-3">
          <p role="status" className="text-sm font-semibold">
            {running
              ? "Updates are running. You can close this page and return here for progress."
              : run.state === "complete"
                ? "All machines and installed catalogue apps are current."
                : "Updates finished with items needing attention."}
          </p>
          <ul className="mt-2 space-y-2 text-sm">
            {run.items.map((item, i) => (
              <li key={`${item.node}:${item.app ?? item.kind}:${i}`}>
                <span className="font-semibold">
                  {item.node}
                  {item.kind === "app" ? ` · ${item.app ?? "Apps"}` : ""}: {labels[item.state]}
                </span>
                <p className="break-words text-[color:var(--muted)]">{item.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
