"use client";

/**
 * Nodes — the machines this install spans, and how to add one.
 *
 * The first control-root screen, and deliberately the *minimal* one. It
 * mints a join token and renders the command to paste on the other
 * machine, the way `k3s`, `docker swarm` and `tailscale up` all do it.
 * The control-root workflows that are still blocked on the undecided
 * "should the agent own the UI" question are not here, and this would be
 * built the same way wherever the UI ends up living.
 *
 * **Why a screen at all, when there is a CLI.** A join token is minted at
 * the control root (`POST /v1/nodes/join-token`, single-use and
 * short-lived since M5), and until now the only way to mint one was
 * `curl` — which fails the rule this project works to: if it is tunable,
 * the UI exposes it.
 *
 * **Why the UI is not the only path.** The other half of the same
 * argument: you cannot reach a worker's web UI from your laptop until
 * that agent binds non-loopback, it binds non-loopback only when it
 * advertises a non-loopback address, and setting that is part of what
 * joining does. So the browser mints the token here, and the machine
 * being added answers the question on its own terminal. See the agent's
 * `onboarding.py`.
 *
 * Everything on this page reads the control root through the UI's own
 * proxy, which resolves `control` through the agent's topology. There is
 * no env var pointing at it.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { CopyButton } from "@/components/CopyButton";
import { ApiError, api } from "@/lib/api";

interface NodeRow {
  name: string;
  role: string;
  reachable: boolean;
  url?: string | null;
  agentVersion?: string | null;
  os?: string | null;
  arch?: string | null;
  lastSeenEpoch?: number | null;
  lastSeenAt?: string | null;
  signingPublicKey?: string | null;
  advertiseSequence?: number | null;
  devices?: { kind?: string; name?: string | null; memoryTotalBytes?: number | null }[] | null;
}

interface MintedToken {
  token: string;
  expiresAt: string;
  nodeName?: string | null;
}

interface ControlStatus {
  role?: string;
  epoch?: number;
  appliedIndex?: number;
}

export default function NodesPage() {
  const [nodes, setNodes] = useState<NodeRow[] | null>(null);
  const [status, setStatus] = useState<ControlStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [minted, setMinted] = useState<MintedToken | null>(null);
  const [newNodeName, setNewNodeName] = useState("");
  const [controlUrl, setControlUrl] = useState("");

  const load = useCallback(async () => {
    try {
      const [list, st] = await Promise.all([
        api.get<{ nodes: NodeRow[] }>("control", "/v1/nodes"),
        api.get<ControlStatus>("control", "/v1/control/status").catch(() => null),
      ]);
      setNodes(list.nodes ?? []);
      setStatus(st);
      setError(null);
      // The command we print has to name an address the *other* machine
      // can reach. This root's own registry entry is the only place the
      // UI can learn one — the browser's own URL is the UI's host, which
      // on a single-box install is loopback and useless to say out loud.
      const root = (list.nodes ?? []).find((n) => n.role === "control" && n.url);
      if (root?.url) setControlUrl(rootControlUrl(root.url));
    } catch (e) {
      setError(describe(e));
      setNodes([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function mint() {
    setMinting(true);
    setMintError(null);
    setMinted(null);
    try {
      const body = newNodeName.trim() ? { nodeName: newNodeName.trim() } : {};
      setMinted(await api.post<MintedToken>("control", "/v1/nodes/join-token", body));
    } catch (e) {
      setMintError(describe(e));
    } finally {
      setMinting(false);
    }
  }

  const joinCommand = minted
    ? [
        "eugene-plexus-agent join",
        `  --control ${controlUrl || "http://<this-host>:8083"}`,
        `  --token ${minted.token}`,
        ...(minted.nodeName ? [`  --name ${minted.nodeName}`] : []),
      ].join(" \\\n")
    : "";

  return (
    <main className="relative z-10 mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="font-ui text-xl font-semibold">Nodes</h1>
          <p className="mt-1 text-sm text-[color:var(--muted)]">
            Every machine in this install.
            {status?.epoch != null && <> This root is at epoch {status.epoch}.</>}
          </p>
        </div>
        <Link
          href="/"
          className="font-ui shrink-0 rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
        >
          Back
        </Link>
      </header>

      {error && (
        <div className="status-error mb-6 rounded-[var(--radius)] border px-3 py-2 text-xs">
          {error}
        </div>
      )}

      <section className="mb-8">
        <h2 className="font-ui mb-3 text-sm font-semibold">This install</h2>
        {nodes === null ? (
          <p className="text-sm text-[color:var(--muted)]">Loading…</p>
        ) : nodes.length === 0 ? (
          <p className="text-sm text-[color:var(--muted)]">
            No nodes are enrolled. That is unusual — the machine running the control root enrolls
            itself like any other.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="font-ui text-xs text-[color:var(--muted)]">
                <tr>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Role</th>
                  <th className="py-2 pr-4">Address</th>
                  <th className="py-2 pr-4">Seen</th>
                  <th className="py-2 pr-4">Host</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((n) => (
                  <tr key={n.name} className="border-t border-[color:var(--border)]">
                    <td className="py-2 pr-4 font-medium">{n.name}</td>
                    <td className="py-2 pr-4 text-[color:var(--muted)]">{n.role}</td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {n.url ?? <span className="text-[color:var(--muted)]">none recorded</span>}
                      {/* A node that has re-advertised has moved at least
                          once. Surfaced because a changed address used to
                          be invisible until routing failed. */}
                      {n.advertiseSequence ? (
                        <span className="ml-2 text-[color:var(--muted)]">
                          (re-advertised ×{n.advertiseSequence})
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4">
                      {n.reachable ? (
                        <span className="text-[color:var(--ok,inherit)]">reachable</span>
                      ) : (
                        <span className="text-[color:var(--muted)]">down</span>
                      )}
                      {status?.epoch != null &&
                      n.lastSeenEpoch != null &&
                      n.lastSeenEpoch < status.epoch ? (
                        <span
                          className="ml-2 text-xs text-[color:var(--muted)]"
                          title="This node has not yet learned about a promotion. Bounded, self-healing, and deliberately shown rather than hidden."
                        >
                          epoch {n.lastSeenEpoch}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4 text-xs text-[color:var(--muted)]">
                      {[n.os, n.arch].filter(Boolean).join("/") || "—"}
                      {n.devices?.length ? ` · ${n.devices.length} device(s)` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-ui mb-2 text-sm font-semibold">Add a node</h2>
        <p className="mb-4 text-sm leading-relaxed text-[color:var(--muted)]">
          Mint a token here, then run the command it produces on the other machine. The token is
          single-use, short-lived, and <strong>shown once</strong> — it is not stored in a form
          anything can read back, so a lost one is re-minted rather than looked up.
        </p>

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="font-ui text-xs">
            <span className="mb-1 block text-[color:var(--muted)]">Node name (optional)</span>
            <input
              value={newNodeName}
              onChange={(e) => setNewNodeName(e.target.value)}
              placeholder="gpu-box"
              className="w-56 rounded-[var(--radius)] border border-[color:var(--border)] bg-transparent px-2 py-1 text-sm"
            />
          </label>
          <label className="font-ui text-xs">
            <span className="mb-1 block text-[color:var(--muted)]">
              Control root URL the other machine can reach
            </span>
            <input
              value={controlUrl}
              onChange={(e) => setControlUrl(e.target.value)}
              placeholder="http://100.64.0.1:8083"
              className="w-72 rounded-[var(--radius)] border border-[color:var(--border)] bg-transparent px-2 py-1 font-mono text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => void mint()}
            disabled={minting}
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {minting ? "Minting…" : "Mint a join token"}
          </button>
        </div>

        {mintError && (
          <div className="status-error mb-4 rounded-[var(--radius)] border px-3 py-2 text-xs">
            {mintError}
          </div>
        )}

        {minted && (
          <div className="rounded-[var(--radius)] border border-[color:var(--border)] p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="font-ui text-xs text-[color:var(--muted)]">
                Run this on the machine you are adding. Expires{" "}
                {new Date(minted.expiresAt).toLocaleTimeString()}.
              </span>
              <CopyButton text={joinCommand} label="Copy" />
            </div>
            <pre className="overflow-x-auto rounded-[var(--radius)] bg-[color:var(--panel)] p-3 font-mono text-xs">
              {joinCommand}
            </pre>
            {!controlUrl && (
              <p className="mt-2 text-xs text-[color:var(--muted)]">
                This root has no address other hosts can reach recorded, so the command above needs
                its URL filled in by hand. Set <code>advertiseUrl</code> in the agent config on this
                machine.
              </p>
            )}
            <p className="mt-2 text-xs text-[color:var(--muted)]">
              The other machine will also offer this as a question the first time it starts, if it
              is started at a terminal.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

/**
 * Turn a node's agent address into the control root's.
 *
 * `Node.url` is where the *agent* listens (8079 by default); the control
 * root is a component on that same host, on its own port. Swapping the
 * port is a guess and is presented as an editable field for exactly that
 * reason — an operator on a non-default port fixes it in one place
 * rather than discovering it on the other machine.
 */
function rootControlUrl(agentUrl: string): string {
  try {
    const parsed = new URL(agentUrl);
    parsed.port = "8083";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return agentUrl;
  }
}

function describe(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 503) {
      return (
        "The control root is not reachable, or has not been set up yet. An uninitialized " +
        "trust root answers 503 across its whole surface by design — it does not fall open."
      );
    }
    if (
      typeof e.body === "object" &&
      e.body !== null &&
      "detail" in e.body &&
      typeof (e.body as { detail?: unknown }).detail === "object"
    ) {
      const detail = (e.body as { detail: { title?: string; detail?: string } }).detail;
      return detail.detail || detail.title || `${e.status} ${e.statusText}`;
    }
    return `${e.status} ${e.statusText}`;
  }
  return e instanceof Error ? e.message : String(e);
}
