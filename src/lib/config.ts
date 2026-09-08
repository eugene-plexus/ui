/**
 * Server-side runtime config.
 *
 * Read by the proxy route handler when a request lands. We deliberately
 * don't expose these URLs to the browser — every API call from the UI
 * goes through `/api/proxy/...`, which forwards server-side. This keeps
 * the UI origin-restricted (no CORS dance on the components) and lets us
 * keep the gateway on a private network without poking holes.
 *
 * Two fixed targets: `gateway` and `watchdog`. Anything else is the NAME
 * of an `inference-driver` entry in the watchdog topology, resolved to a
 * URL there.
 *
 * That used to be a two-hop lookup — orchestrator config mapped a driver
 * SLOT to a backend name, then the watchdog mapped the name to a URL —
 * because the orchestrator kept its own list of drivers. The gateway
 * doesn't: it derives its routing table from the watchdog topology plus
 * each driver's `/v1/info`. So there is one hop now, and one place where
 * a driver's URL is written down.
 */

export type ProxyTarget = string;

const FIXED_TARGETS = new Set(["gateway", "watchdog"]);

const DEFAULT_GATEWAY = "http://127.0.0.1:8080";
const DEFAULT_WATCHDOG = "http://127.0.0.1:8079";

interface WatchdogComponentEntry {
  name: string;
  kind: string;
  url: string;
}

export function gatewayUrl(): string {
  return process.env.GATEWAY_URL?.trim() || DEFAULT_GATEWAY;
}

export function watchdogUrl(): string {
  return process.env.WATCHDOG_URL?.trim() || DEFAULT_WATCHDOG;
}

/**
 * Resolve one watchdog-topology entry's URL by (kind, name).
 *
 * Watchdog's `/v1/components` is bearer-auth-protected, so the caller
 * threads the incoming request's Authorization header through. Returns
 * null when the watchdog is unreachable or has no matching entry — the
 * caller turns that into a 503 with a message naming what it looked for,
 * which is more useful than a blind fallback URL that also fails.
 */
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
  if (target === "gateway") {
    return { url: gatewayUrl() };
  }
  if (target === "watchdog") {
    return { url: watchdogUrl() };
  }
  if (FIXED_TARGETS.has(target)) {
    return { error: `unsupported fixed target: ${target}` };
  }
  const url = await fetchTopologyUrlByName("inference-driver", target, authHeader);
  if (!url) {
    return {
      error:
        `no inference-driver named '${target}' in the watchdog topology ` +
        `(or the watchdog at ${watchdogUrl()} is unreachable)`,
    };
  }
  return { url };
}

/** Validity check used by the route handler to short-circuit obvious garbage. */
export function isValidTargetName(value: string): boolean {
  // Driver names are operator-supplied strings; the watchdog validates
  // non-emptiness. The proxy only needs a basic sanity gate to reject
  // path-traversal-shaped input.
  return value.length > 0 && !value.includes("/") && !value.includes("..");
}
