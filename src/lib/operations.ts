/**
 * Operations rights for people who are not the owner (row 39).
 *
 * `specs/docs/design/rows/row-39.md`. The owner can give a person two
 * operations powers on chosen machines: **Models** (`operate-models`) and
 * **Updates and restarts** (`operate-machines`, which includes logs). The
 * person signs in at `/administration` with their own account; this module
 * keeps that named session and, per machine, exchanges it at the control
 * root for a 10-minute operations token addressed to that machine only.
 *
 * The console then shows only the pages their powers use, sends each
 * request the token of the machine that serves it, and every other page
 * says "Only the owner can do this". The machines themselves enforce the
 * powers; nothing here is a gate, only a way not to show dead ends.
 *
 * Pure apart from `sessionStorage` and the injected `fetch`, so the tests
 * need no renderer.
 */

import { getSessionToken } from "./session";

export type Power = "operate-models" | "operate-machines";

export const MODELS: Power = "operate-models";
export const MACHINES: Power = "operate-machines";

/** The words a person sees for each power, in the header line. */
const POWER_WORDS: Record<Power, string> = {
  "operate-models": "models",
  "operate-machines": "updates and restarts",
};

export interface OperationsSession {
  /** The named administration session, addressed to the control root. */
  token: string;
  name: string;
  powers: Power[];
}

export interface MachineInScope {
  name: string;
  label?: string | null;
  kinds: string[];
}

const KEY = "eugene-operations-session";

export function getOperationsSession(): OperationsSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OperationsSession;
    return typeof parsed?.token === "string" && Array.isArray(parsed.powers) ? parsed : null;
  } catch {
    return null;
  }
}

export function setOperationsSession(session: OperationsSession): void {
  forget();
  try {
    sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* memory-only is not offered: the console needs it across pages */
  }
}

export function clearOperationsSession(): void {
  forget();
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** True when this tab runs the console for a person who is not the owner. */
export function inOperationsMode(): boolean {
  return getSessionToken() === null && getOperationsSession() !== null;
}

/** The powers a set of grants carries, in token order. */
export function powersOf(grants: {
  operateModels?: boolean | null;
  operateMachines?: boolean | null;
}): Power[] {
  const found: Power[] = [];
  if (grants.operateModels) found.push(MODELS);
  if (grants.operateMachines) found.push(MACHINES);
  return found;
}

/** "Signed in as Dana: models, updates and restarts". */
export function operationsLine(session: OperationsSession): string {
  const words = session.powers.map((p) => POWER_WORDS[p]).join(", ");
  return `Signed in as ${session.name}: ${words || "no powers"}`;
}

/**
 * The console pages each power uses. Every power reads Home, the
 * machines (and their updates), host history, metrics, the model list,
 * the dashboards and the alerts (row 38: read only; the rules, the SLO
 * targets and the webhook stay the owner's); Models adds Discover;
 * Updates and restarts adds Logs.
 */
const READ_PAGES = ["/", "/nodes", "/hosts", "/metrics", "/library", "/dashboards", "/alerts"];
const POWER_PAGES: Record<Power, string[]> = {
  "operate-models": ["/discover"],
  "operate-machines": ["/logs"],
};

export function allowedPages(powers: readonly Power[]): string[] {
  if (powers.length === 0) return [];
  return [...READ_PAGES, ...powers.flatMap((p) => POWER_PAGES[p] ?? [])];
}

function normalize(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] || "/";
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/** Whether a person with `powers` has a use for the page at `pathname`. */
export function allowedPath(pathname: string, powers: readonly Power[]): boolean {
  const path = normalize(pathname);
  return allowedPages(powers).some((page) =>
    page === "/" ? path === "/" : path === page || path.startsWith(`${page}/`),
  );
}

// ---------------------------------------------------------------------------
// tokens, per machine
// ---------------------------------------------------------------------------

/** Replace a token this long before it expires. */
const MARGIN_MS = 60_000;
const MACHINES_FOR_MS = 60_000;

let machinesCache: { at: number; list: MachineInScope[] } | null = null;
let localMachine: string | null | undefined;
const tokens = new Map<string, { token: string; expires: number }>();

function forget(): void {
  machinesCache = null;
  localMachine = undefined;
  tokens.clear();
}

export class OperationsError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`HTTP ${status}`);
    this.name = "OperationsError";
  }
}

type Fetch = typeof fetch;

async function control<T>(
  session: OperationsSession,
  method: "GET" | "POST",
  path: string,
  body: unknown,
  fetcher: Fetch,
): Promise<T> {
  const response = await fetcher(`/api/proxy/control${path}`, {
    method,
    cache: "no-store",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${session.token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    /* keep the text */
  }
  if (!response.ok) throw new OperationsError(response.status, parsed);
  return parsed as T;
}

/** The machines this person's powers reach, and what runs on each. */
export async function machinesInScope(
  session: OperationsSession,
  fetcher: Fetch = fetch,
): Promise<MachineInScope[]> {
  const now = Date.now();
  if (machinesCache && now - machinesCache.at < MACHINES_FOR_MS) return machinesCache.list;
  const answer = await control<{ machines?: MachineInScope[] }>(
    session,
    "GET",
    "/v1/auth/operations-machines",
    undefined,
    fetcher,
  );
  machinesCache = { at: now, list: answer.machines ?? [] };
  return machinesCache.list;
}

/** An operations token for `machine`, exchanged once and reused. */
export async function tokenFor(
  session: OperationsSession,
  machine: string,
  fetcher: Fetch = fetch,
): Promise<string> {
  const held = tokens.get(machine);
  if (held && held.expires - MARGIN_MS > Date.now()) return held.token;
  const answer = await control<{ token: string; expiresAt: string }>(
    session,
    "POST",
    "/v1/auth/operations-token",
    { machine },
    fetcher,
  );
  tokens.set(machine, { token: answer.token, expires: Date.parse(answer.expiresAt) });
  return answer.token;
}

/**
 * The machine that serves `target`, or null when none in scope does.
 *
 * `node:<name>` names it; `library` and `gateway` are the machine that
 * runs one; `agent` is the machine serving this console, found by asking
 * it who it is with each machine's token in turn (the agent answers only
 * the token addressed to it).
 */
export async function machineFor(
  session: OperationsSession,
  target: string,
  fetcher: Fetch = fetch,
): Promise<string | null> {
  if (target.startsWith("node:")) return target.slice(5) || null;
  const machines = await machinesInScope(session, fetcher);
  if (target === "library" || target === "gateway") {
    return machines.find((m) => m.kinds.includes(target))?.name ?? null;
  }
  if (target !== "agent") return null;
  if (localMachine !== undefined) return localMachine;
  for (const m of machines) {
    const token = await tokenFor(session, m.name, fetcher).catch(() => null);
    if (!token) continue;
    const answer = await fetcher("/api/proxy/agent/v1/node", {
      cache: "no-store",
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
    }).catch(() => null);
    if (answer?.ok) {
      localMachine = m.name;
      return localMachine;
    }
  }
  localMachine = null;
  return null;
}

/**
 * The bearer for a request to `target` in operations mode: the named
 * session itself for the control root, the machine's operations token
 * for anything on a machine in scope, and none otherwise (the machine
 * then says it is the owner's).
 */
export async function bearerFor(
  session: OperationsSession,
  target: string,
  fetcher: Fetch = fetch,
): Promise<string | null> {
  if (target === "control") return session.token;
  const machine = await machineFor(session, target, fetcher);
  return machine ? tokenFor(session, machine, fetcher) : null;
}
