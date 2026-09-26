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
import { useCallback, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { CopyButton } from "@/components/CopyButton";
import { ApiError, api } from "@/lib/api";
import { isLockedError } from "@/lib/controlUnlock";
import {
  checkControlAddress,
  installPorts,
  isLoopbackUrl,
  joinTokenState,
  rootControlUrl,
} from "@/lib/joinCommand";
import { describeLiveness, nodeLiveness } from "@/lib/nodeLiveness";
import { timeAgo, timeUntil } from "@/lib/relativeTime";
import { usePolling } from "@/lib/usePolling";
import { expertHint } from "@/lib/vocabulary";

/**
 * Troy's number, and the reason for it: unlock the root and it is
 * holding no observations at all, so every node reads as not-yet-checked
 * until its poller completes a pass. Two seconds is fast enough that the
 * flip to `reachable` looks like the page catching up rather than
 * something the operator had to do.
 *
 * `/v1/nodes` is a read of applied state plus cached probes -- it does
 * not probe anything -- so this costs one round trip to the root.
 */
const NODE_POLL_MS = 2000;

/** The join, the gateway and the placement behind "Serves". Slower: it
 * is three more reads and nobody is watching it tick. */
const SERVED_POLL_MS = 10000;

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
  lastError?: string | null;
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
  id: string;
  token: string;
  expiresAt: string;
  nodeName?: string | null;
}

/** An outstanding token, as the root lists it: never the token itself. */
interface TokenRecord {
  id: string;
  expiresAt: string;
  nodeName?: string | null;
  used: boolean;
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
        components?: { node: string; name: string; kind: string; url?: string | null }[];
      }>("control", "/v1/components")
      .catch(() => null),
    api
      .get<{
        drivers?: {
          name: string;
          url?: string | null;
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
  // Two machines each running one model hold two drivers of one name,
  // so a driver is matched on its address as well; a bare name is used
  // only when exactly one driver carries it. A map by name let the last
  // one answer for both machines.
  const liveDrivers = drivers?.drivers ?? [];
  const liveFor = (name: string, url: string | null | undefined) => {
    const named = liveDrivers.filter((d) => d.name === name);
    return (
      named.find((d) => url != null && d.url === url) ?? (named.length === 1 ? named[0] : undefined)
    );
  };
  const runtimeStatus = new Map(
    (runtimes?.runtimes ?? []).map((r) => [`${r.node}/${r.name}`, r.status ?? null]),
  );
  const out: Record<string, Served[]> = {};
  for (const c of placement?.components ?? []) {
    if (c.kind !== "inference-driver") continue;
    const d = liveFor(c.name, c.url);
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
  const [outstanding, setOutstanding] = useState<TokenRecord[]>([]);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [newNodeName, setNewNodeName] = useState("");
  const [controlUrl, setControlUrl] = useState("");
  /** The control root's own machine, as the registry lists it: what every port guess starts from. */
  const [rootAgentUrl, setRootAgentUrl] = useState<string | null>(null);

  /**
   * The node list, on a two-second loop.
   *
   * **The last good answer is kept when a poll fails.** At one shot a
   * blanked table was the same as an empty one; at two seconds a single
   * missed round trip would flicker every row away and back, and this
   * page is where someone looks when they already suspect something is
   * wrong. The failure is reported beside the list instead.
   */
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
      // The command we print has to name an address the *other* machine
      // can reach. This root's own registry entry is the only place the
      // UI can learn one — the browser's own URL is the UI's host, which
      // on a single-box install is loopback and useless to say out loud.
      const root = (list.nodes ?? []).find((n) => n.role === "control" && n.url);
      setRootAgentUrl(root?.url ?? null);
      if (root?.url) setControlUrl((current) => current || rootControlUrl(root.url!));
    } catch (e) {
      // A sealed root is not an error to report, it is a thing to offer
      // to fix — so it gets the panel below instead of the red box.
      if (isLockedError(e)) {
        setLocked(true);
        setError(null);
        setNodes([]);
      } else {
        setError(describe(e));
        // Keep whatever was last true. See the docblock.
        setNodes((current) => current ?? []);
      }
    }
  }, []);

  const loadServed = useCallback(async () => {
    setServed(await servedByNode());
  }, []);

  /** Outstanding join tokens. Soft: the list is an extra, and a root
   * that cannot serve it must not take the page down. */
  const loadTokens = useCallback(async () => {
    try {
      const list = await api.get<{ tokens: TokenRecord[] }>("control", "/v1/nodes/join-tokens");
      setOutstanding(list.tokens ?? []);
    } catch {
      setOutstanding([]);
    }
  }, []);

  usePolling(load, NODE_POLL_MS);
  usePolling(loadServed, SERVED_POLL_MS, !locked);
  usePolling(loadTokens, SERVED_POLL_MS, !locked);

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
      await loadTokens();
    } catch (e) {
      setMintError(describe(e));
    } finally {
      setMinting(false);
    }
  }

  /**
   * Withdraw a token.
   *
   * Troy asked for it because minting was the only thing that could be
   * done to one: a token that went to the wrong window stayed live for
   * the rest of its TTL and the only remedy was to wait.
   *
   * No confirmation. The destructive direction here is *minting*, and
   * the cost of an unwanted revoke is one more click on Mint — whereas
   * a dialog between an operator and a credential they have decided to
   * kill is the wrong friction in the wrong place.
   */
  async function revoke(id: string) {
    setRevoking(id);
    setMintError(null);
    try {
      await api.delete("control", `/v1/nodes/join-tokens/${encodeURIComponent(id)}`);
      // The one on screen is now dead; stop offering its command.
      if (minted?.id === id) setMinted(null);
      await loadTokens();
    } catch (e) {
      setMintError(describe(e));
    } finally {
      setRevoking(null);
    }
  }

  // The token on screen, as the root's own list now reads it: a token
  // that has enrolled a machine, or run out, offers no command to copy.
  const mintedState = minted
    ? joinTokenState({
        expiresAt: minted.expiresAt,
        used: outstanding.find((t) => t.id === minted.id)?.used ?? false,
      })
    : null;
  // The ports go on the page, not only in the placeholder: the
  // placeholder vanished at the first keystroke and left the person to
  // guess which of three ports was wanted (2026-09-26).
  const ports = installPorts(rootAgentUrl);
  const addressCheck = checkControlAddress(controlUrl, ports);

  const joinCommand = minted
    ? [
        "eugene-plexus-agent join",
        `  --control ${controlUrl || "http://<this-host>:8083"}`,
        `  --token ${minted.token}`,
        ...(minted.nodeName ? [`  --name ${minted.nodeName}`] : []),
      ].join(" \\\n")
    : "";

  return (
    <AppShell
      controls={
        <span
          className="font-ui text-sm text-[color:var(--muted)]"
          title={status?.epoch != null ? epochHint(status.epoch) : undefined}
        >
          Every machine in this install.
        </span>
      }
    >
      <main className="relative z-10 mx-auto max-w-4xl px-6 py-8">
        {error && (
          <div className="status-error mb-6 rounded-[var(--radius)] border px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {locked && (
          <section className="mb-6 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-4">
            <h2 className="font-ui text-base font-semibold">This control root is locked</h2>
            <p className="mt-2 text-sm text-[color:var(--muted)]">
              It is set up and nothing is lost. It keeps this install&rsquo;s signing key sealed
              until it is given the passphrase after a restart. Until then no models are listed and
              nothing is served.
            </p>
            <p className="mt-2 text-sm text-[color:var(--muted)]">
              Signing in to this web UI unlocks it too, with the same passphrase. You see this form
              because the root restarted after you signed in, or holds a different passphrase. This
              form talks to the control root itself.
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
                className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:opacity-50"
              >
                {unlocking ? "Unlocking…" : "Unlock"}
              </button>
            </form>
            {unlockError && (
              <div className="status-error mt-3 rounded-[var(--radius)] border px-3 py-2 text-sm">
                {unlockError}
              </div>
            )}
            <p className="mt-3 text-sm text-[color:var(--muted)]">
              This happens on every restart unless auto-unlock is on. A host can use its OS keyring;
              a container has none, so it reads the passphrase from a file you mount — see{" "}
              <span className="font-mono">securityMode</span> in the control root&rsquo;s settings.
            </p>
          </section>
        )}

        <section className="mb-8">
          <h2 className="font-ui mb-3 text-base font-semibold">This install</h2>
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
                <thead className="font-ui text-sm text-[color:var(--muted)]">
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
                        {/* Three words, not two. `reachable: false` is both
                            "we looked and it was not there" and "nothing has
                            looked", and a root that has just been unlocked is
                            always the second -- which read as every node being
                            down for a poll interval. See `nodeLiveness.ts`. */}
                        <LivenessCell node={n} />
                        {/* When the root last heard from it. Always on the
                            wire and never shown, so a node that was down read
                            the same whether it left a minute or a week ago. */}
                        {timeAgo(n.lastSeenAt) && (
                          <span
                            className="ml-2 text-sm text-[color:var(--muted)]"
                            data-testid="node-last-seen"
                            title={
                              n.lastSeenAt ? new Date(n.lastSeenAt).toLocaleString() : undefined
                            }
                          >
                            {n.reachable ? "" : "last seen "}
                            {timeAgo(n.lastSeenAt)}
                          </span>
                        )}
                        {/* The root's own words for why. Until 2026-09-15 this
                            column said only "down" while the probe client held
                            "HTTP 401: ... not yet valid (iat)" -- half a second
                            of clock skew that read as a key problem. */}
                        {!n.reachable && n.lastError ? (
                          <div
                            className="mt-0.5 max-w-md text-sm text-[color:var(--muted)]"
                            data-testid="node-last-error"
                          >
                            {n.lastError}
                          </div>
                        ) : null}
                        {status?.epoch != null &&
                        n.lastSeenEpoch != null &&
                        n.lastSeenEpoch < status.epoch ? (
                          <span
                            className="ml-2 text-sm text-[color:var(--muted)]"
                            data-testid="node-behind"
                            title={behindHint(n.lastSeenEpoch, status.epoch)}
                          >
                            catching up
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-4 text-sm text-[color:var(--muted)]">
                        {[n.os, n.arch].filter(Boolean).join("/") || "—"}
                        {n.devices?.length ? ` · ${n.devices.length} device(s)` : ""}
                      </td>
                      <td className="py-2 pr-4 text-sm">
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
                                  {s.runtime ? (
                                    <span title={"runtime " + s.runtime}>
                                      {` (${s.runtime}${s.status ? `, ${s.status}` : ""})`}
                                    </span>
                                  ) : (
                                    ""
                                  )}
                                  {s.reachable === false ? " · unreachable" : ""}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <Link href="/inference" className="mt-1 block text-[0.6875rem] underline">
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
          <h2 className="font-ui mb-2 text-base font-semibold">Add a node</h2>
          <p className="mb-4 text-sm leading-relaxed text-[color:var(--muted)]">
            Make a token here, then run the command it gives you on the other machine. The token
            works once, for a short time, and is <strong>shown once</strong>. A lost one is replaced
            rather than looked up.
          </p>

          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="font-ui text-sm">
              <span className="mb-1 block text-[color:var(--muted)]">Node name (optional)</span>
              <input
                value={newNodeName}
                onChange={(e) => setNewNodeName(e.target.value)}
                placeholder="gpu-box"
                className="w-56 rounded-[var(--radius)] border border-[color:var(--border)] bg-transparent px-2 py-1 text-sm"
              />
            </label>
            <label className="font-ui text-sm">
              <span className="mb-1 block text-[color:var(--muted)]">
                Control root URL the other machine can reach
              </span>
              <input
                value={controlUrl}
                onChange={(e) => setControlUrl(e.target.value)}
                placeholder={`http://100.64.0.1:${ports.control}`}
                aria-describedby="port-guide"
                className="w-72 rounded-[var(--radius)] border border-[color:var(--border)] bg-transparent px-2 py-1 font-mono text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => void mint()}
              disabled={minting}
              className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1.5 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {minting ? "Making…" : "Make a join token"}
            </button>
          </div>

          <div
            id="port-guide"
            data-testid="port-guide"
            className="mb-4 text-sm leading-relaxed text-[color:var(--muted)]"
          >
            <p>
              Which port? The control root&rsquo;s machine listens on three
              {ports.offset !== 0 &&
                `, each moved by ${ports.offset > 0 ? "+" : ""}${ports.offset} on this install`}
              :
            </p>
            <ul className="mt-1 space-y-0.5">
              <li>
                <span className="font-mono">{ports.agent}</span> &mdash; the console, where you
                manage the install
              </li>
              <li>
                <span className="font-mono">{ports.gateway}</span> &mdash; where your apps send
                their requests
              </li>
              <li className="text-[color:var(--foreground)]">
                <span className="font-mono">{ports.control}</span> &mdash; the control root.{" "}
                <strong>A new machine joins here.</strong>
              </li>
            </ul>
          </div>

          {addressCheck && (
            <div
              data-testid="control-address-warning"
              role="alert"
              className="status-warn mb-4 rounded-[var(--radius)] border px-3 py-2 text-sm"
            >
              <ul className="space-y-0.5">
                {addressCheck.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
              {addressCheck.suggestion && (
                <button
                  type="button"
                  onClick={() => setControlUrl(addressCheck.suggestion!)}
                  className="font-ui mt-2 rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-0.5 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
                >
                  Use <span className="font-mono">{addressCheck.suggestion}</span>
                </button>
              )}
            </div>
          )}

          {mintError && (
            <div className="status-error mb-4 rounded-[var(--radius)] border px-3 py-2 text-sm">
              {mintError}
            </div>
          )}

          {outstanding.length > 0 && (
            <div
              data-testid="outstanding-tokens"
              className="mb-4 rounded-[var(--radius)] border border-[color:var(--border)] p-3"
            >
              <h3 className="font-ui mb-2 text-sm font-semibold">
                Outstanding tokens ({outstanding.length})
              </h3>
              <ul className="space-y-1.5">
                {outstanding.map((t) => (
                  <li
                    key={t.id}
                    data-testid="token-row"
                    data-token-id={t.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span>
                      <span className="font-mono">{t.id}</span>
                      {t.nodeName ? (
                        <>
                          {" "}
                          · for <span className="font-mono">{t.nodeName}</span>
                        </>
                      ) : (
                        <span className="text-[color:var(--muted)]"> · any node</span>
                      )}
                      <span className="text-[color:var(--muted)]">
                        {" "}
                        ·{" "}
                        {t.used ? (
                          "already used"
                        ) : joinTokenState(t) === "expired" ? (
                          <span title={new Date(t.expiresAt).toLocaleString()}>expired</span>
                        ) : (
                          <span title={new Date(t.expiresAt).toLocaleString()}>
                            expires {timeUntil(t.expiresAt) ?? "at an unknown time"}
                          </span>
                        )}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void revoke(t.id)}
                      disabled={revoking !== null}
                      data-testid="revoke-token"
                      className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-0.5 text-[0.6875rem] transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {revoking === t.id ? "revoking…" : "Revoke"}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[0.6875rem] text-[color:var(--muted)]">
                The id is a handle, not the token. The token was shown once and is not kept anywhere
                it could be read back. Revoking one stops it working immediately; a token that has
                already enrolled a node can be cleared here and the node is untouched.
              </p>
            </div>
          )}

          {minted && mintedState !== "usable" && (
            <p
              data-testid="join-token-spent"
              role="status"
              className="rounded-[var(--radius)] border border-[color:var(--border)] p-3 text-sm text-[color:var(--muted)]"
            >
              {mintedState === "used"
                ? "This token was used. The machine it added is in the list above."
                : "This token has expired. Make a new one above."}
            </p>
          )}

          {minted && mintedState === "usable" && (
            <div className="rounded-[var(--radius)] border border-[color:var(--border)] p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="font-ui text-sm text-[color:var(--muted)]">
                  Run this on the machine you are adding. It expires{" "}
                  <span title={new Date(minted.expiresAt).toLocaleString()}>
                    {timeUntil(minted.expiresAt) ?? "soon"}
                  </span>
                  .
                </span>
                <CopyButton text={joinCommand} label="Copy" />
              </div>
              <pre className="overflow-x-auto rounded-[var(--radius)] bg-[color:var(--panel)] p-3 font-mono text-xs">
                {joinCommand}
              </pre>
              {!controlUrl && (
                <p
                  className="mt-2 text-sm text-[color:var(--muted)]"
                  title="The address comes from the agent's advertiseUrl setting on this machine."
                >
                  This root has not said where other machines can reach it. Type that address in the
                  box above before copying the command.
                </p>
              )}
              {/* The guess is the root's own recorded address, which on a
                  single box is loopback until Reach is switched on -- and
                  the old hint only fired when there was NO address, so a
                  command naming 127.0.0.1 was copied with nothing said. */}
              {controlUrl && isLoopbackUrl(controlUrl) && (
                <p
                  data-testid="join-loopback"
                  role="alert"
                  className="status-warn mt-2 rounded-[var(--radius)] border px-3 py-2 text-sm"
                >
                  {new URL(controlUrl).hostname} only works on this machine, so this command will
                  fail on the other one. Turn on{" "}
                  <Link href="/" className="underline">
                    Reach it from other devices
                  </Link>{" "}
                  on Home, or type an address the other machine can reach in the box above.
                </p>
              )}
              <p className="mt-2 text-sm text-[color:var(--muted)]">
                The other machine will also offer this as a question the first time it starts, if it
                is started at a terminal.
              </p>
            </div>
          )}
        </section>
      </main>
    </AppShell>
  );
}

/**
 * Hover text for the epoch numbers: an expert reading a promotion needs
 * them, and nobody else does, so the page itself never says the word.
 */
function epochHint(root: number): string {
  return expertHint("The control root is at epoch ") + root + ".";
}

function behindHint(seen: number, root: number): string {
  return (
    expertHint("This node has not yet learned about a promotion. It last saw epoch ") +
    seen +
    expertHint(", and the root is at ") +
    root +
    expertHint(". Bounded, self-healing, and deliberately shown rather than hidden.")
  );
}

/** The liveness word for one node, with the reason behind it. */
function LivenessCell({ node }: { node: NodeRow }) {
  const liveness = nodeLiveness(node);
  const { label, title } = describeLiveness(liveness);
  return (
    <span
      data-testid="node-liveness"
      data-liveness={liveness}
      title={title}
      // `--ok` was never defined, so "reachable" was not green and "down"
      // was the same muted grey as "checking…": the failure read quieter
      // than the healthy state.
      className={
        liveness === "reachable"
          ? "text-status-success"
          : liveness === "down"
            ? "text-status-error"
            : "text-[color:var(--muted)]"
      }
    >
      {label}
    </span>
  );
}

/** The RFC7807 body, when the response carried one. */
function problemOf(e: unknown): { type?: string; title?: string; detail?: string } | null {
  if (!(e instanceof ApiError)) return null;
  if (typeof e.body !== "object" || e.body === null || !("detail" in e.body)) return null;
  const detail = (e.body as { detail?: unknown }).detail;
  if (typeof detail !== "object" || detail === null) return null;
  return detail as { type?: string; title?: string; detail?: string };
}

function describe(e: unknown): string {
  if (e instanceof ApiError) {
    const p = problemOf(e);
    // The root's own words first. It writes better errors than we can
    // guess at, and its 503 is two different situations.
    if (p?.detail || p?.title) return p.detail || p.title || "";
    if (e.status === 503) {
      return (
        "The control root is not reachable, or has not been set up yet. Until it is set " +
        "up it refuses every request, by design."
      );
    }
    return `${e.status} ${e.statusText}`;
  }
  return e instanceof Error ? e.message : String(e);
}
