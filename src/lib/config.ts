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
 * components (`memory`, `identity`, `connector`). Anything else is
 * interpreted as a driver name and resolved at request time by fetching
 * the orchestrator's `/v1/config` and looking up the operator-supplied
 * driver name in its `drivers` list. The orchestrator is the source of
 * truth for driver topology; the watchdog is the source of truth for
 * body-component topology. Env var overrides exist as the bootstrap
 * escape hatch (so the proxy can reach the watchdog in the first place).
 */

export type ProxyTarget = string;

const FIXED_TARGETS = new Set(["orchestrator", "watchdog", "memory", "identity", "connector"]);

const DEFAULT_ORCHESTRATOR = "http://127.0.0.1:8080";
const DEFAULT_WATCHDOG = "http://127.0.0.1:8079";
const DEFAULT_MEMORY = "http://127.0.0.1:8083";
const DEFAULT_IDENTITY = "http://127.0.0.1:8084";
const DEFAULT_CONNECTOR = "http://127.0.0.1:8085";

interface DriverEntry {
  name: string;
  // v0.2.1: a slot is a priority list of backends. The proxy resolves a
  // driver name to its *primary* URL (`urls[0]`); per-turn failover to
  // the rest happens server-side in the orchestrator, not here.
  urls: string[];
}

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
  // Anything else is interpreted as a driver name. Look it up in the
  // orchestrator's `drivers` config — that's the single source of truth
  // for driver topology. v0.1 fetches on every request; the volume is
  // small (config-page edits only) so a cache is premature.
  //
  // v0.2: orchestrator's /v1/config is bearer-auth-protected. Forward
  // the incoming Authorization header so the lookup succeeds for
  // logged-in operators.
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
    const entry = drivers.find(
      (d): d is DriverEntry =>
        typeof d === "object" &&
        d !== null &&
        typeof (d as DriverEntry).name === "string" &&
        Array.isArray((d as DriverEntry).urls) &&
        (d as DriverEntry).urls.length > 0 &&
        (d as DriverEntry).name === target,
    );
    if (!entry) {
      const known = drivers
        .filter((d): d is DriverEntry => typeof d === "object" && d !== null && "name" in d)
        .map((d) => d.name)
        .join(", ");
      return {
        error: `unknown driver: ${target}. Known: [${known}]`,
      };
    }
    // Resolve to the slot's primary backend; failover is server-side.
    return { url: entry.urls[0]! };
  } catch (e) {
    return {
      error: `failed to reach orchestrator at ${orchestratorUrl()}: ${
        e instanceof Error ? e.message : String(e)
      }`,
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
