/**
 * Server-side runtime config.
 *
 * Read by the proxy route handler when a request lands. We deliberately
 * don't expose these URLs to the browser — every API call from the UI
 * goes through `/api/proxy/...`, which forwards server-side. This keeps
 * the UI origin-restricted (no CORS dance on the components) and lets us
 * keep the orchestrator on a private network without poking holes.
 *
 * Fixed-target set: `orchestrator`, `watchdog`, plus the v0.2 body
 * components (`memory`, `identity`, `connector`). Anything else is a
 * driver SLOT name, resolved in two hops (v0.2.1 item 2): the
 * orchestrator's `/v1/config` maps the slot to its primary backend
 * NAME, and the watchdog's `/v1/components` maps that name to a URL.
 * The watchdog is the single source of truth for every component URL
 * (drivers included); the orchestrator config holds only names. Env var
 * overrides exist as the bootstrap escape hatch (so the proxy can reach
 * the watchdog in the first place).
 */

export type ProxyTarget = string;

const FIXED_TARGETS = new Set(["orchestrator", "watchdog", "memory", "identity", "connector"]);

const DEFAULT_ORCHESTRATOR = "http://127.0.0.1:8080";
const DEFAULT_WATCHDOG = "http://127.0.0.1:8079";
const DEFAULT_MEMORY = "http://127.0.0.1:8083";
const DEFAULT_IDENTITY = "http://127.0.0.1:8084";
const DEFAULT_CONNECTOR = "http://127.0.0.1:8085";

interface WatchdogComponentEntry {
  name: string;
  kind: string;
  url: string;
}

export function orchestratorUrl(): string {
  return process.env.ORCHESTRATOR_URL?.trim() || DEFAULT_ORCHESTRATOR;
}

export function watchdogUrl(): string {
  return process.env.WATCHDOG_URL?.trim() || DEFAULT_WATCHDOG;
}

// Body components are looked up against the watchdog's topology at
// request time so the proxy follows whatever URL the operator wired up
// in `watchdog.yaml`. The env-var defaults below are the fallback when
// the watchdog hasn't been asked yet OR the component isn't present in
// topology — they match the v0.2 default ports so a stock install just
// works.
//
// v0.2 note: watchdog's /v1/components is bearer-auth-protected. The
// proxy threads the incoming request's `Authorization` header here so
// the server-side lookup works for logged-in operators. Pre-login
// (e.g. wizard) the header is absent and we fall back to defaults.
async function fetchTopologyUrl(
  kind: string,
  fallback: string,
  envOverride: string | undefined,
  authHeader: string | undefined,
): Promise<string> {
  if (envOverride?.trim()) return envOverride.trim();
  try {
    const headers: HeadersInit = authHeader ? { Authorization: authHeader } : {};
    const response = await fetch(`${watchdogUrl()}/v1/components`, { headers });
    if (!response.ok) return fallback;
    const doc = (await response.json()) as { components?: WatchdogComponentEntry[] };
    const list = doc.components ?? [];
    const entry = list.find(
      (c) =>
        c &&
        typeof c.kind === "string" &&
        c.kind === kind &&
        typeof c.url === "string" &&
        c.url.length > 0,
    );
    return entry?.url ?? fallback;
  } catch {
    return fallback;
  }
}

// Resolve a single watchdog-topology entry's URL by (kind, name). Used
// for driver-slot backends, which are stored as topology names (v0.2.1
// item 2) — the URL lives only in the watchdog topology. Returns null
// when the watchdog is unreachable or has no matching entry.
async function fetchTopologyUrlByName(
  kind: string,
  name: string,
  authHeader: string | undefined,
): Promise<string | null> {
  try {
    const headers: HeadersInit = authHeader ? { Authorization: authHeader } : {};
    const response = await fetch(`${watchdogUrl()}/v1/components`, { headers });
    if (!response.ok) return null;
    const doc = (await response.json()) as { components?: WatchdogComponentEntry[] };
    const entry = (doc.components ?? []).find(
      (c) =>
        c && c.kind === kind && c.name === name && typeof c.url === "string" && c.url.length > 0,
    );
    return entry?.url ?? null;
  } catch {
    return null;
  }
}

export async function resolveTarget(
  target: ProxyTarget,
  authHeader?: string,
): Promise<{ url: string } | { error: string }> {
  if (target === "orchestrator") {
    return { url: orchestratorUrl() };
  }
  if (target === "watchdog") {
    return { url: watchdogUrl() };
  }
  if (target === "memory") {
    const url = await fetchTopologyUrl(
      "memory",
      DEFAULT_MEMORY,
      process.env.MEMORY_URL,
      authHeader,
    );
    return { url };
  }
  if (target === "identity") {
    const url = await fetchTopologyUrl(
      "identity",
      DEFAULT_IDENTITY,
      process.env.IDENTITY_URL,
      authHeader,
    );
    return { url };
  }
  if (target === "connector") {
    const url = await fetchTopologyUrl(
      "connector",
      DEFAULT_CONNECTOR,
      process.env.CONNECTOR_URL,
      authHeader,
    );
    return { url };
  }
  // Anything else is a driver SLOT name (the config-page driver tabs are
  // sourced from /v1/admin/drivers, which reports slot names). Resolve it
  // in two hops, mirroring the v0.2.1-item-2 split of ownership:
  //   1. orchestrator /v1/config maps the slot → its primary backend NAME
  //   2. watchdog /v1/components maps that name → a URL
  // URLs live only in the watchdog topology; the orchestrator config holds
  // names. Both endpoints are bearer-auth-protected, so forward the
  // incoming Authorization header.
  if (FIXED_TARGETS.has(target)) {
    return { error: `unsupported fixed target: ${target}` };
  }
  try {
    const headers: HeadersInit = authHeader ? { Authorization: authHeader } : {};
    const response = await fetch(`${orchestratorUrl()}/v1/config`, { headers });
    if (!response.ok) {
      return {
        error: `orchestrator /v1/config returned ${response.status} ${response.statusText}`,
      };
    }
    const doc = (await response.json()) as Record<string, unknown>;
    const drivers = doc.drivers;
    if (!Array.isArray(drivers)) {
      return { error: "orchestrator /v1/config has no drivers list" };
    }
    const slot = drivers.find(
      (d): d is Record<string, unknown> =>
        typeof d === "object" && d !== null && (d as { name?: unknown }).name === target,
    );
    if (!slot) {
      const known = drivers
        .filter((d): d is { name: string } => typeof d === "object" && d !== null && "name" in d)
        .map((d) => d.name)
        .join(", ");
      return { error: `unknown driver slot: ${target}. Known: [${known}]` };
    }
    // Primary backend name. Tolerate the legacy `urls`/`url` shapes in
    // case the orchestrator config predates the item-2 migration.
    const list = Array.isArray(slot.backends)
      ? slot.backends
      : Array.isArray(slot.urls)
        ? slot.urls
        : typeof slot.url === "string"
          ? [slot.url]
          : [];
    const primary = typeof list[0] === "string" ? (list[0] as string) : "";
    if (!primary) {
      return { error: `driver slot '${target}' has no backends` };
    }
    // A URL-shaped backend (legacy/migrated) is used directly; otherwise
    // it's a topology entry name resolved via the watchdog.
    if (/^https?:\/\//.test(primary)) {
      return { url: primary };
    }
    const url = await fetchTopologyUrlByName("hemisphere-driver", primary, authHeader);
    if (!url) {
      return {
        error: `driver backend '${primary}' (slot '${target}') not found in watchdog topology`,
      };
    }
    return { url };
  } catch (e) {
    return {
      error: `failed to resolve driver '${target}': ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** Validity check used by the route handler to short-circuit obvious garbage. */
export function isValidTargetName(value: string): boolean {
  // Driver names are operator-supplied strings; orchestrator config
  // validates non-emptiness. The proxy only needs a basic sanity gate
  // to reject path-traversal-shaped input.
  return value.length > 0 && !value.includes("/") && !value.includes("..");
}
