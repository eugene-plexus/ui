/**
 * Server-side runtime config.
 *
 * Read by the proxy route handler when a request lands. We deliberately
 * don't expose these URLs to the browser — every API call from the UI
 * goes through `/api/proxy/...`, which forwards server-side. This keeps
 * the UI origin-restricted (no CORS dance on the components) and lets us
 * keep the orchestrator on a private network without poking holes.
 */

export type ProxyTarget = "orchestrator" | "left" | "right";

export interface ProxyEndpoints {
  orchestrator: string;
  left: string | null;
  right: string | null;
}

const DEFAULT_ORCHESTRATOR = "http://127.0.0.1:8080";

export function readProxyEndpoints(): ProxyEndpoints {
  const orchestrator = process.env.ORCHESTRATOR_URL?.trim() || DEFAULT_ORCHESTRATOR;
  const left = process.env.LEFT_DRIVER_URL?.trim() || null;
  const right = process.env.RIGHT_DRIVER_URL?.trim() || null;
  return { orchestrator, left, right };
}

export function resolveTarget(
  target: ProxyTarget,
  endpoints: ProxyEndpoints,
): { url: string } | { error: string } {
  switch (target) {
    case "orchestrator":
      return { url: endpoints.orchestrator };
    case "left":
      if (!endpoints.left) return { error: "LEFT_DRIVER_URL not configured" };
      return { url: endpoints.left };
    case "right":
      if (!endpoints.right) return { error: "RIGHT_DRIVER_URL not configured" };
      return { url: endpoints.right };
    default:
      return { error: `unknown target: ${target}` };
  }
}

export const KNOWN_TARGETS: readonly ProxyTarget[] = ["orchestrator", "left", "right"] as const;

export function isProxyTarget(value: string): value is ProxyTarget {
  return (KNOWN_TARGETS as readonly string[]).includes(value);
}
