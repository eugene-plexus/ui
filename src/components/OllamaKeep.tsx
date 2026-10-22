"use client";

import { useCallback, useEffect, useState } from "react";
import { api, describeError } from "@/lib/api";
import type { components } from "@/generated/library";
import { formatBytesShort } from "@/lib/tasks";
import { timeAgo } from "@/lib/relativeTime";
import { labelOf } from "@/lib/nodeLabels";
import { usePolling } from "@/lib/usePolling";

type KeepJob = components["schemas"]["KeepJob"];
type NodeList = components["schemas"]["NodeOllamaList"];
type FolderList = components["schemas"]["LibraryFolderList"];

export function KeepModel({
  model,
  node,
  digest,
  onChanged,
}: {
  model?: string;
  node?: string;
  digest?: string;
  onChanged: () => void;
}) {
  const [job, setJob] = useState<KeepJob | null>(null);
  const [folders, setFolders] = useState<FolderList["folders"]>([]);
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void api
      .get<FolderList>("library", "/v1/folders")
      .then((list) => {
        if (active)
          setFolders((list.folders ?? []).filter((f) => f.kind !== "ollama" && !f.readOnly));
      })
      .catch((err) => {
        if (active) setError(describeError(err));
      });
    return () => {
      active = false;
    };
  }, []);
  const jobId = job?.id;
  const poll = useCallback(async () => {
    if (!jobId) return;
    try {
      const next = await api.get<KeepJob>("library", `/v1/keep-jobs/${encodeURIComponent(jobId)}`);
      setJob(next);
      setError(null);
      if (next.state === "done") onChanged();
    } catch (err) {
      setError(describeError(err));
    }
  }, [jobId, onChanged]);
  usePolling(poll, 1000, job?.state === "running");
  async function keep() {
    setBusy(true);
    setError(null);
    try {
      const next = await api.post<KeepJob>(
        "library",
        node
          ? `/v1/nodes/${encodeURIComponent(node)}/ollama/keep`
          : `/v1/models/${encodeURIComponent(model!)}/keep`,
        { ...(node ? { digest } : {}), ...(folder ? { folder } : {}) },
      );
      setJob(next);
      if (next.state === "done") onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!job) return;
    try {
      setJob(await api.delete<KeepJob>("library", `/v1/keep-jobs/${encodeURIComponent(job.id)}`));
    } catch (err) {
      setError(describeError(err));
    }
  }
  return (
    <div className="space-y-1 text-sm">
      {!job || job.state === "failed" || job.state === "cancelled" ? (
        <div className="flex items-center gap-2">
          <label>
            Keep in{" "}
            <select
              aria-label="Library folder"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              disabled={busy}
            >
              <option value="">First writable folder</option>
              {folders.map((f) => (
                <option key={f.path} value={f.path}>
                  {f.path}
                </option>
              ))}
            </select>
          </label>
          <button
            className="action-button rounded border px-3 py-1"
            disabled={busy}
            onClick={() => void keep()}
          >
            Keep in the Library
          </button>
        </div>
      ) : null}
      {job?.state === "running" && (
        <p role="status">
          Keeping... {formatBytesShort(job.bytesDone)} of {formatBytesShort(job.bytesTotal)}{" "}
          <button onClick={() => void cancel()}>Cancel</button>
        </p>
      )}
      {job?.state === "done" && (
        <p role="status">
          Kept in {job.target} ({job.method === "link" ? "linked: no extra disk" : "copied"})
        </p>
      )}
      {job?.state === "cancelled" && <p>Keep cancelled.</p>}
      {job?.note && <p>{job.note}</p>}
      {(error || job?.error) && <p role="alert">{error || job?.error}</p>}
    </div>
  );
}

export function OtherOllama({ onChanged }: { onChanged: () => void }) {
  const [nodes, setNodes] = useState<NodeList["nodes"]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const body = await api.get<NodeList>("library", "/v1/nodes/ollama");
      setNodes(body.nodes ?? []);
      setError(null);
    } catch (err) {
      setError(describeError(err));
    }
  }, []);
  usePolling(load, 60000);
  if (!nodes.length && !error) return null;
  return (
    <section
      className="max-h-64 space-y-2 overflow-y-auto border-b p-4"
      aria-label="In Ollama on other machines"
    >
      <h2>In Ollama on other machines</h2>
      {error && <p role="alert">{error}</p>}
      {nodes.map((n) => (
        <div key={n.node}>
          <p>
            {labelOf(n.node)} — Read {timeAgo(n.readAt)}
          </p>
          {Date.now() - Date.parse(n.readAt) > 120000 && (
            <p>
              {labelOf(n.node)} has not reported since {new Date(n.readAt).toLocaleTimeString()}.
            </p>
          )}
          {n.stores.map((s) => (
            <div key={s.path}>
              {s.error && <p role="alert">{s.error}</p>}
              {s.models.map((m) => (
                <div key={m.digest} className="my-2">
                  <span>{m.tags[0]}</span> —{" "}
                  {formatBytesShort(m.sizeBytes + (m.projectorSizeBytes ?? 0))}
                  {m.libraryModel ? (
                    <p>Already in the Library</p>
                  ) : (
                    <KeepModel
                      node={n.node}
                      digest={m.digest}
                      onChanged={() => {
                        onChanged();
                        void load();
                      }}
                    />
                  )}
                </div>
              ))}
              {s.skipped.map((skip, i) => (
                <p key={i}>
                  {skip.name}: {skip.detail}
                </p>
              ))}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

export function ReportOllama({ node }: { node: string }) {
  const target = `node:${node}` as const;
  const [value, setValue] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const config = await api.get<{ reportOllama?: boolean }>(target, "/v1/config");
    setValue(typeof config.reportOllama === "boolean" ? config.reportOllama : null);
  }, [target]);
  useEffect(() => {
    void load().catch((err) => setError(describeError(err)));
  }, [load]);
  async function change() {
    setBusy(true);
    try {
      const result = await api.patch<{ rejected?: { message?: string }[] }>(target, "/v1/config", {
        reportOllama: !value,
      });
      if (result.rejected?.length)
        throw new Error(result.rejected[0]?.message ?? "The setting was refused.");
      await load();
      setError(null);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-1 text-sm">
      {value !== null && (
        <label>
          <input type="checkbox" checked={value} disabled={busy} onChange={() => void change()} />{" "}
          Report Ollama models
        </label>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
