"use client";

import Link from "next/link";
import { useState } from "react";
import { api, describeError } from "@/lib/api";
import type { Row } from "@/lib/inferenceRows";

/** Prepared models keep separate declarations and public identities.
 *
 * Since LS3 they are Library models: added on the Library page (*Add a
 * prepared model*), run from there with a profile. What stays here is
 * switching between two of them on one node. */
export function ExperimentalModels({ node, rows }: { node: string | null; rows: Row[] }) {
  const [source, setSource] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const prepared = rows.filter((r) => r.engine === "strata" && r.runtime);
  const running = prepared.filter((r) => r.runtimeStatus === "ready");
  const stopped = prepared.filter((r) => ["stopped", "crashed"].includes(r.runtimeStatus ?? ""));

  async function swap() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api.post<{ message?: string }>("gateway", "/v1/runtimes/switch", {
        ...(node ? { node } : {}),
        source,
        target: next,
      });
      setMessage(result.message ?? "Model switch started. Watch the new model's status below.");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 text-sm">
      <p>
        <strong>Strata · Experimental</strong> — text chat with prepared models. Memory fit is
        unknown; tools, media and automatic model preparation are not supported yet. Add a prepared
        model on the{" "}
        <Link href="/library" className="underline">
          Library
        </Link>{" "}
        page (<em>add prepared model</em>), then Run it there.
      </p>
      {running.length > 0 && stopped.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label>
            Switch from{" "}
            <select
              aria-label="Model to stop"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              disabled={busy}
            >
              <option value="">Choose running model</option>
              {running.map((r) => (
                <option key={r.runtime} value={r.runtime!}>
                  {r.model ?? r.runtime}
                </option>
              ))}
            </select>
          </label>
          <label>
            to{" "}
            <select
              aria-label="Model to start"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              disabled={busy}
            >
              <option value="">Choose saved model</option>
              {stopped.map((r) => (
                <option key={r.runtime} value={r.runtime!}>
                  {r.model ?? r.runtime}
                </option>
              ))}
            </select>
          </label>
          <button
            className="border px-2 py-1"
            disabled={busy || !source || !next}
            onClick={() => void swap()}
          >
            {busy ? "Switching…" : "Switch model"}
          </button>
          <p className="w-full text-[color:var(--muted)]">
            Waits up to 30 seconds for current gateway requests to finish, then stops the old model
            and loads the new one. Each keeps its own alias.
          </p>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="text-status-error">
          {error}
        </p>
      )}
    </div>
  );
}
