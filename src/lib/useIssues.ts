"use client";

/**
 * The Issues list, polled for the header badge and Home's card.
 *
 * `issues.ts` holds the rules and is pure; this holds the reads. The
 * split is the one `tasks.ts` / `useTasks.ts` already uses, and it is
 * what let every rule be tested against the bodies the live install
 * returns before anything fetched them.
 *
 * **Every read is soft.** This is mounted on every signed-in screen,
 * including the one a person opens because something is down, and a
 * badge that failed because the library was unreachable would be a
 * second symptom of one fault. A source that did not answer contributes
 * no issues and does not blank the others — `NodeFacts` is all-nullable
 * for exactly that reason.
 *
 * **An issue is not a task, so this is not the tray's cadence.** The
 * tray watches work in flight and polls every five seconds; a sealed
 * root, an unmounted folder or a mixed engine fleet does not change
 * second to second, and four reads per node is a real cost on an
 * install with ten of them. Thirty seconds, and `usePolling` skips the
 * ticks while the tab is hidden.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "./api";
import { isLockedError } from "./controlUnlock";
import {
  issuesFrom,
  worstSeverity,
  type ControlNodeRow,
  type Issue,
  type IssueSeverity,
  type NodeFacts,
} from "./issues";
import { targetFor } from "./nodeBudget";
import { getSessionToken } from "./session";
import type {
  ComponentList,
  EngineList,
  LibraryFolderReach,
  NodeIdentity,
  RoutingTableView,
  RuntimeList,
} from "./types";
import { usePolling } from "./usePolling";

const POLL_MS = 30_000;

/** A node that is down must not hold the whole poll open. Ten seconds is
 * well past a healthy proxy hop across a tailnet and well inside the
 * interval, so two polls can never overlap. */
const READ_TIMEOUT_MS = 10_000;

/**
 * What every read here carries, and why it is not the ambient session.
 *
 * `api.ts` intercepts a 401 against the *stored* token by clearing the
 * session and bouncing to `/login`; a supplied `bearer` is exempt,
 * because a refusal of a credential you handed it is not evidence about
 * the session. That exemption is the whole reason these reads pass the
 * token explicitly. This polls `control` from every page, forever, and
 * the install has already produced the state where a root refuses a
 * session the local agent minted — M9's shape, root initialized and the
 * local agent not enrolled. With the ambient token that state logs the
 * operator out every thirty seconds, from any screen, with no way to
 * stay signed in long enough to read the issue explaining why.
 *
 * A genuinely expired session is still caught: every screen's own
 * foreground reads use the ambient token and bounce as they always did.
 * The badge is not the thing that should end a session.
 */
function reads(token: string): { bearer: string; timeoutMs: number } {
  return { bearer: token, timeoutMs: READ_TIMEOUT_MS };
}

type Timed = Pick<NodeFacts, "identity" | "readWindow">;

/**
 * `GET /v1/node`, **bracketed**.
 *
 * The two `Date.now()` marks are the measurement, not bookkeeping. The
 * host reports what time it thinks it is; the offset of that clock from
 * this browser's is only known to lie inside `[time - after,
 * time - before]`, and the skew between two hosts is the difference of
 * two such intervals. Drop the brackets and `skewBetween` returns null
 * for every pair, `issuesFrom` returns no clock issue ever, and nothing
 * fails — which is why `issues.test.ts` pins that case explicitly.
 *
 * **`before` must be taken before the request, and no test here can
 * prove it.** Taking both marks afterwards narrows the interval to
 * nothing, which loses the property that latency only ever *hides* a
 * skew — a slow hop would then read as a real one. It is
 * unobservable through this hook because the invented skew is bounded
 * by the hop's own latency, and `READ_TIMEOUT_MS` (10 s) is a third of
 * `SKEW_WARN_SECONDS` (30 s): a read slow enough to invent a warning
 * has already been aborted. Sabotage-confirmed as escaping, and left
 * escaping rather than covered by a test that could not fail honestly.
 * **Both constants are load-bearing to that argument** — raising the
 * timeout past the warning threshold makes a false clock warning
 * reachable.
 */
async function readIdentity(target: string, options: ReturnType<typeof reads>): Promise<Timed> {
  const before = Date.now();
  try {
    const identity = await api.get<NodeIdentity>(target, "/v1/node", options);
    return { identity, readWindow: { before, after: Date.now() } };
  } catch {
    return { identity: null, readWindow: null };
  }
}

interface NodeAddress {
  name: string | null;
  label: string;
  local: boolean;
  target: string;
}

/**
 * One node's five reads, through the `node:<name>` hop for anything that
 * is not this machine.
 *
 * Three of the rules cannot be answered from the control root: its
 * `RuntimePlacement` is `{node, name, modelAlias, status, url, engine}`
 * and carries no `engineVersion`, `flags`, `lastRestart` or
 * `localPath`, so mixed builds, a model on the processor and the
 * loading state all need the node's own `GET /v1/runtimes`.
 *
 * **A node the root calls unreachable is still asked.** The root's
 * verdict is its own probe from its own position on the network, and
 * this browser may be somewhere else — that is the premise the
 * cross-node console rests on. If it is genuinely down the four reads
 * time out, contribute nothing, and the roster's `node-down` issue is
 * the one that gets reported.
 */
async function readNode(
  address: NodeAddress,
  known: Timed | null,
  options: ReturnType<typeof reads>,
): Promise<NodeFacts> {
  const [timed, runtimes, engines, folders, components] = await Promise.all([
    known ?? readIdentity(address.target, options),
    api.get<RuntimeList>(address.target, "/v1/runtimes", options).catch(() => null),
    api.get<EngineList>(address.target, "/v1/engines", options).catch(() => null),
    api
      .post<LibraryFolderReach>(address.target, "/v1/library/folders/check", {}, options)
      .catch(() => null),
    // **The fifth read, and the only place a crash-looping component's
    // own diagnosis lives** (R1.5, review §6.1 #7). The control root's
    // `ComponentPlacement` carries `status` and no `lastError`, and the
    // gateway's driver list says nothing about the gateway — so a taken
    // port is only explicable from the owning agent.
    api.get<ComponentList>(address.target, "/v1/components", options).catch(() => null),
  ]);
  return {
    name: address.name,
    label: address.label,
    local: address.local,
    identity: timed.identity,
    readWindow: timed.readWindow,
    runtimes,
    engines,
    folders,
    components,
  };
}

/** The install's node list, and whether the root refused because it is
 * sealed. Both come out of one call: a locked root answers 503 across
 * its whole surface, so the failure *is* the observation. */
async function readRoster(
  options: ReturnType<typeof reads>,
): Promise<{ nodes: ControlNodeRow[] | null; locked: boolean }> {
  try {
    const list = await api.get<{ nodes?: ControlNodeRow[] }>("control", "/v1/nodes", options);
    return { nodes: list.nodes ?? [], locked: false };
  } catch (e) {
    // Standalone, uninitialized, unreachable or sealed. Only the last is
    // an issue; the rest are installs that have no control root to talk
    // about, and a list that complained about them would be wrong on
    // every single-box install there is.
    return { nodes: null, locked: isLockedError(e) };
  }
}

export interface IssuesState {
  issues: Issue[];
  /**
   * The raw per-node reads the issues were derived from.
   *
   * Exposed because the Inference screen needs three fields the control
   * root's `RuntimePlacement` does not carry — `flags`, `lastRestart`
   * and `localPath` — plus each node's device list, and those are
   * exactly what this poll already fetched. A second poll for the same
   * four endpoints would double the traffic to every node in the
   * install to render two lines.
   */
  facts: NodeFacts[];
  /** Blocking if anything is, so the badge can colour itself without
   * being opened. Null when the list is empty. */
  worst: IssueSeverity | null;
  /** False until the first poll has answered, so a badge can stay quiet
   * rather than flashing "all clear" at a person whose root is sealed. */
  loaded: boolean;
  /** Pull the list forward — what the sealed-root row calls after an
   * unlock, instead of leaving the issue on screen for half a minute
   * after it was fixed. */
  reload: () => Promise<void>;
}

/**
 * Every mounted list's loader, so a fix made from one refreshes them all.
 *
 * The header badge and Home's card are two `useIssues` calls with two
 * polls, and Inference is a third. Until 2026-09-23 an unlock from Home's
 * card pulled only the card's list forward, and the badge in the header
 * -- the one on screen everywhere -- kept saying the root was locked for
 * the rest of its thirty seconds.
 */
const mounted = new Set<() => Promise<void>>();

/**
 * Refresh something else whenever the Issues lists are pulled forward.
 * A fix made from the list -- an unlock, above all -- changes more than
 * the list: the resource tree said "control root unreachable" and lacked
 * every other machine until the page was left, beside a badge that had
 * already cleared.
 */
export function useRefreshWithIssues(load: () => Promise<void>): void {
  useEffect(() => {
    mounted.add(load);
    return () => {
      mounted.delete(load);
    };
  }, [load]);
}

export function useIssues(): IssuesState {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [facts, setFacts] = useState<NodeFacts[]>([]);
  const [loaded, setLoaded] = useState(false);
  // `reload` can be called while a poll is in flight, and the two can
  // finish in either order. Only the newest answer is allowed to land.
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const token = getSessionToken();
    if (!token) return;
    const options = reads(token);
    const mine = (sequence.current += 1);

    const [routing, local, roster] = await Promise.all([
      api.get<RoutingTableView>("gateway", "/v1/admin/routing", options).catch(() => null),
      readIdentity("agent", options),
      readRoster(options),
    ]);

    // The local node's name is what tells the others apart from it, and
    // on a standalone host it is null — the agent has never enrolled, so
    // it has no name in an install that does not exist. `targetFor`
    // resolves that to the plain `agent` target.
    const localName = local.identity?.name ?? null;
    const perNode = await Promise.all([
      readNode(
        { name: localName, label: localName ?? "this machine", local: true, target: "agent" },
        local,
        options,
      ),
      ...(roster.nodes ?? [])
        .filter((row) => row.name !== localName)
        .map((row) =>
          readNode(
            {
              name: row.name,
              label: row.name,
              local: false,
              target: targetFor(row.name, localName),
            },
            null,
            options,
          ),
        ),
    ]);

    if (mine !== sequence.current) return;
    setFacts(perNode);
    setIssues(
      issuesFrom({
        controlRoot: routing?.control_root,
        controlLocked: roster.locked,
        nodes: roster.nodes,
        perNode,
      }),
    );
    setLoaded(true);
  }, []);

  usePolling(load, POLL_MS);

  useEffect(() => {
    mounted.add(load);
    return () => {
      mounted.delete(load);
    };
  }, [load]);

  const reload = useCallback(async () => {
    await Promise.all([...mounted].map((each) => each()));
  }, []);

  const worst = useMemo(() => worstSeverity(issues), [issues]);
  return { issues, facts, worst, loaded, reload };
}
