"use client";

import { useState } from "react";
import { api, describeError } from "@/lib/api";
import type { RuntimeSpec } from "@/lib/types";
import type { Row } from "@/lib/inferenceRows";

/** Prepared models keep separate declarations and public identities. */
export function ExperimentalModels({
  target,
  node,
  rows,
}: {
  target: string;
  node: string | null;
  rows: Row[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [alias, setAlias] = useState("");
  const [path, setPath] = useState("");
  const [source, setSource] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const prepared = rows.filter((r) => r.engine === "strata" && r.runtime);
  const running = prepared.filter((r) => r.runtimeStatus === "ready");
  const stopped = prepared.filter((r) => ["stopped", "crashed"].includes(r.runtimeStatus ?? ""));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const spec: RuntimeSpec = {
      name: name.trim(),
      engine: "strata",
      host: "127.0.0.1",
      modelPath: path.trim(),
      modelAlias: alias.trim(),
      autoStart: false,
      autoDriver: true,
      startOnDemand: false,
    };
    try {
      await api.post(target, "/v1/runtimes", spec);
      setMessage(
        `Saved ${alias.trim()}. Start it from its row below, or switch to it from another Strata model.`,
      );
      setOpen(false);
      setName("");
      setAlias("");
      setPath("");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

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
        unknown; tools, media and automatic model preparation are not supported yet.
      </p>
      <button type="button" className="underline" onClick={() => setOpen(!open)} disabled={busy}>
        {open ? "Close model form" : "Add prepared Strata model"}
      </button>
      {open && (
        <form onSubmit={(event) => void save(event)} className="flex flex-wrap items-end gap-3">
          <p className="w-full text-[color:var(--muted)]">
            Use a Strata JSON config in a Library folder on this node, with its prepared weights,
            tokenizer and MTP assets. The original config and model files stay where they are.
          </p>
          <label>
            Saved name
            <input
              required
              pattern="[a-zA-Z0-9_-]+"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="block border p-1"
            />
          </label>
          <label>
            Model alias
            <input
              required
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              className="block border p-1"
            />
          </label>
          <label>
            Prepared config path
            <input
              required
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="D:\\Models\\strata-qwen.json"
              className="block min-w-72 border p-1"
            />
          </label>
          <button disabled={busy} className="border px-2 py-1">
            {busy ? "Saving…" : "Save model"}
          </button>
        </form>
      )}
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
