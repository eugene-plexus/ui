/**
 * Server-side runtime config.
 *
 * Read by the proxy route handler when a request lands. We deliberately
 * don't expose these URLs to the browser — every API call from the UI
 * goes through `/api/proxy/...`, which forwards server-side. This keeps
 * the UI origin-restricted (no CORS dance on the components) and lets us
 * keep the orchestrator on a private network without poking holes.
 *
 * v0.1 fixed-target set: `orchestrator`. Driver targets (any other
 * name) are resolved at request time by fetching the orchestrator's
 * `/v1/config` and looking up the operator-supplied driver name in
 * its `drivers` list. The orchestrator is the source of truth for
 * topology — env var overrides exist only as the bootstrap escape
 * hatch (so the proxy can reach the orchestrator in the first place).
 */

export type ProxyTarget = string;

const FIXED_TARGETS = new Set(["orchestrator", "watchdog"]);

const DEFAULT_ORCHESTRATOR = "http://127.0.0.1:8080";
const DEFAULT_WATCHDOG = "http://127.0.0.1:8079";

interface DriverEntry {
  name: string;
  url: string;
}

export function orchestratorUrl(): string {
  return process.env.ORCHESTRATOR_URL?.trim() || DEFAULT_ORCHESTRATOR;
}

export function watchdogUrl(): string {
  return process.env.WATCHDOG_URL?.trim() || DEFAULT_WATCHDOG;
}

export async function resolveTarget(
  target: ProxyTarget,
): Promise<{ url: string } | { error: string }> {
  if (target === "orchestrator") {
    return { url: orchestratorUrl() };
  }
  if (target === "watchdog") {
    return { url: watchdogUrl() };
  }
  // Anything else is interpreted as a driver name. Look it up in the
  // orchestrator's `drivers` config — that's the single source of truth
  // for topology. v0.1 fetches on every request; the volume is small
  // (config-page edits only) so a cache is premature.
  if (FIXED_TARGETS.has(target)) {
    return { error: `unsupported fixed target: ${target}` };
  }
  try {
    const response = await fetch(`${orchestratorUrl()}/v1/config`);
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
        typeof (d as DriverEntry).url === "string" &&
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
    return { url: entry.url };
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
