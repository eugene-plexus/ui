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

/** What a node serves, from the two views that know: the control root's
 * placement of drivers and runtimes, and the gateway's live picture of
 * each driver (model id, reachability). Joined by driver name. */
interface Served {
  driver: string;
  model: string | null;
  runtime: string | null;
  reachable: boolean | null;
  status: string | null;
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

/** Drivers per node, with what the gateway knows about each. Both reads
 * fail soft: a sealed root or a gateway in safe mode leaves the column
 * saying "nothing" rather than taking the page down with it. */
async function servedByNode(): Promise<Record<string, Served[]>> {
  const [placement, drivers, runtimes] = await Promise.all([
    api
      .get<{
        components?: { node: string; name: string; kind: string }[];
      }>("control", "/v1/components")
      .catch(() => null),
    api
      .get<{
        drivers?: {
          name: string;
          reachable: boolean;
          modelId?: string | null;
          runtime?: string | null;
        }[];
      }>("gateway", "/v1/admin/drivers")
      .catch(() => null),
    api
      .get<{
        runtimes?: { node: string; name: string; status?: string | null }[];
      }>("control", "/v1/runtimes")
      .catch(() => null),
  ]);
  const live = new Map((drivers?.drivers ?? []).map((d) => [d.name, d]));
  const runtimeStatus = new Map(
    (runtimes?.runtimes ?? []).map((r) => [`${r.node}/${r.name}`, r.status ?? null]),
  );
  const out: Record<string, Served[]> = {};
  for (const c of placement?.components ?? []) {
    if (c.kind !== "inference-driver") continue;
    const d = live.get(c.name);
    (out[c.node] ??= []).push({
      driver: c.name,
      model: d?.modelId ?? null,
      runtime: d?.runtime ?? null,
      reachable: d ? d.reachable : null,
      status: d?.runtime ? (runtimeStatus.get(`${c.node}/${d.runtime}`) ?? null) : null,
    });
  }
  return out;
}

export default function NodesPage() {
  const [nodes, setNodes] = useState<NodeRow[] | null>(null);
  const [served, setServed] = useState<Record<string, Served[]>>({});
  const [status, setStatus] = useState<ControlStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
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
      setLocked(false);
      setServed(await servedByNode());
      // The command we print has to name an address the *other* machine
      // can reach. This root's own registry entry is the only place the
      // UI can learn one — the browser's own URL is the UI's host, which
      // on a single-box install is loopback and useless to say out loud.
      const root = (list.nodes ?? []).find((n) => n.role === "control" && n.url);
      if (root?.url) setControlUrl(rootControlUrl(root.url));
    } catch (e) {
      // A sealed root is not an error to report, it is a thing to offer
      // to fix — so it gets the panel below instead of the red box.
      if (isLocked(e)) {
        setLocked(true);
        setError(null);
      } else {
        setError(describe(e));
      }
      setNodes([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Open a sealed control root from the browser.
   *
   * **This is the only way to do it from a browser**, and until
   * 2026-09-12 there was none. Signing in on `/login` posts to the
   * *agent*, which is not the thing that is sealed — so every other page
   * renders, an open session carries on working, and the only symptoms
   * are this screen and a gateway with no models. The remedy used to be
   * curl, which is a poor answer for a NAS appliance.
   *
   * **The lock is per-process, not per-session.** Unsealing puts the
   * master key in the root's memory, so this fixes it for every caller
   * at once and the token that comes back is of no further use here —
   * the browser's ordinary session works again the moment the root can
   * verify it. That is why it is discarded rather than stored.
   *
   * No `skipAuth`: control ignores an Authorization header on its own
   * login route, and the agent resolves the `control` target in process,
   * so the browser's existing session is the only credential involved.
   * The wizard's `enrollLocalAgent` makes the same call the same way.
   */
  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    if (!passphrase) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      await api.post("control", "/v1/auth/login", { passphrase });
      setPassphrase("");
      await load();
    } catch (err) {
      setUnlockError(describe(err));
    } finally {
      setUnlocking(false);
    }
  }

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

      {locked && (
        <section className="mb-6 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-4">
          <h2 className="font-ui text-sm font-semibold">This control root is locked</h2>
          <p className="mt-2 text-xs text-[color:var(--muted)]">
            It is set up and its records are intact — it just holds the install&rsquo;s signing key
            sealed and has not been given the passphrase since it last started. Nothing is lost.
            Until it is unlocked the gateway cannot read this install&rsquo;s topology, so{" "}
            <span className="font-mono">/v1/models</span> is empty and nothing routes.
          </p>
          <p className="mt-2 text-xs text-[color:var(--muted)]">
            Signing in to this web UI does not unlock it: that login goes to the node agent, which
            is not what is sealed. This form talks to the control root itself.
          </p>
          <form onSubmit={unlock} className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="unlock-passphrase" className="sr-only">
              Operator passphrase
            </label>
            <input
              id="unlock-passphrase"
              type="password"
              autoComplete="current-password"
              value={passphrase}
              onChange={(ev) => setPassphrase(ev.target.value)}
              placeholder="Operator passphrase"
              className="min-w-[16rem] flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-transparent px-3 py-1.5 text-sm"
            />
            <button
              type="submit"
              disabled={unlocking || !passphrase}
              className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:opacity-50"
            >
              {unlocking ? "Unlocking…" : "Unlock"}
            </button>
          </form>
          {unlockError && (
            <div className="status-error mt-3 rounded-[var(--radius)] border px-3 py-2 text-xs">
              {unlockError}
            </div>
          )}
          <p className="mt-3 text-xs text-[color:var(--muted)]">
            This happens on every restart unless auto-unlock is on. A host can use its OS keyring; a
            container has none, so it reads the passphrase from a file you mount — see{" "}
            <span className="font-mono">securityMode</span> in the control root&rsquo;s settings.
          </p>
        </section>
      )}

      <section className="mb-8">
        <h2 className="font-ui mb-3 text-sm font-semibold">This install</h2>
        {nodes === null ? (
          <p className="text-sm text-[color:var(--muted)]">Loading…</p>
        ) : locked ? (
          // Not "no nodes" — we did not get to ask. Saying the registry
          // is empty here would be a confident wrong answer about the
          // thing the operator is most likely to act on.
          <p className="text-sm text-[color:var(--muted)]">Unknown until the root is unlocked.</p>
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
                  <th className="py-2 pr-4">Serves</th>
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
                    <td className="py-2 pr-4 text-xs">
                      {/* The question this table could not answer: a node was
                          "reachable" and nothing said what it was for. */}
                      {(served[n.name] ?? []).length === 0 ? (
                        <span className="text-[color:var(--muted)]">nothing</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {(served[n.name] ?? []).map((s) => (
                            <li key={s.driver} className="font-mono">
                              {s.model ?? s.driver}
                              <span className="ml-1 font-sans text-[color:var(--muted)]">
                                via {s.driver}
                                {s.runtime
                                  ? ` (runtime ${s.runtime}${s.status ? `, ${s.status}` : ""})`
                                  : ""}
                                {s.reachable === false ? " · unreachable" : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <Link href="/inference" className="mt-1 block text-[11px] underline">
                        Inference →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Hidden rather than disabled while locked: minting a join token
          is a control-root write, so the button could only produce the
          same 503 the panel above already explains. */}
      <section hidden={locked}>
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

/** The RFC7807 body, when the response carried one. */
function problemOf(e: unknown): { type?: string; title?: string; detail?: string } | null {
  if (!(e instanceof ApiError)) return null;
  if (typeof e.body !== "object" || e.body === null || !("detail" in e.body)) return null;
  const detail = (e.body as { detail?: unknown }).detail;
  if (typeof detail !== "object" || detail === null) return null;
  return detail as { type?: string; title?: string; detail?: string };
}

/**
 * Is this the *sealed* 503 rather than the *uninitialized* one?
 *
 * The control root distinguishes them carefully — `dependencies.py` says
 * telling them apart "matters most on the day it matters at all",
 * because "run first-run setup" is advice to wipe an install that
 * already exists. This page used to throw the distinction away by
 * returning one sentence for every 503, so a sealed root read as an
 * absent one.
 */
function isLocked(e: unknown): boolean {
  if (!(e instanceof ApiError) || e.status !== 503) return false;
  const p = problemOf(e);
  return p?.type?.endsWith("#locked") === true || p?.title === "Locked";
}

function describe(e: unknown): string {
  if (e instanceof ApiError) {
    const p = problemOf(e);
    // The root's own words first. It writes better errors than we can
    // guess at, and its 503 is two different situations.
    if (p?.detail || p?.title) return p.detail || p.title || "";
    if (e.status === 503) {
      return (
        "The control root is not reachable, or has not been set up yet. An uninitialized " +
        "trust root answers 503 across its whole surface by design — it does not fall open."
      );
    }
    return `${e.status} ${e.statusText}`;
  }
  return e instanceof Error ? e.message : String(e);
}
