/**
 * Moving a console page from http:// to https:// by itself (LT2,
 * `specs/docs/design/tls-for-clients.md` §6). The decisions are pure and
 * live here; `TlsProbe.tsx` and the trust page only run them.
 *
 * The probe is a no-cors fetch of `https://<same host:port>/healthz`. An
 * opaque answer means the handshake succeeded, so this device trusts the
 * install CA; a rejection means it does not (or the node has no TLS door).
 */

export const PROBE_TIMEOUT_MS = 4000;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK.has(hostname.toLowerCase());
}

/** Only a plain page on a non-loopback host probes. Loopback stays plain on purpose. */
export function shouldProbe(protocol: string, hostname: string): boolean {
  return protocol === "http:" && !isLoopbackHost(hostname);
}

export interface PageLocation {
  protocol: string;
  hostname: string;
  host: string;
  pathname: string;
  search: string;
  hash: string;
}

/** The same page, over https on the same host and port. */
export function httpsTarget(loc: Pick<PageLocation, "host" | "pathname" | "search" | "hash">) {
  return `https://${loc.host}${loc.pathname}${loc.search}${loc.hash}`;
}

export type ProbeAction = "move" | "offer-trust" | "nothing";

/** What to do once both answers are known. */
export function decideAction(httpsReachable: boolean, caServed: boolean): ProbeAction {
  if (httpsReachable) return "move";
  return caServed ? "offer-trust" : "nothing";
}

type FetchLike = (input: string, init?: RequestInit) => Promise<{ ok: boolean; status: number }>;

/** True when the TLS handshake to this host succeeds and the device trusts it. */
export async function httpsTrusted(
  host: string,
  fetchFn: FetchLike = fetch,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetchFn(`https://${host}/healthz`, {
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** True when this node serves the install CA (200). 404 or any error: it has none. */
export async function caServed(fetchFn: FetchLike = fetch): Promise<boolean> {
  try {
    const response = await fetchFn("/v1/trust/ca", { cache: "no-store" });
    return response.status === 200;
  } catch {
    return false;
  }
}

/** The whole probe for the page at `loc`. */
export async function runProbe(
  loc: PageLocation,
  fetchFn: FetchLike = fetch,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<ProbeAction> {
  if (!shouldProbe(loc.protocol, loc.hostname)) return "nothing";
  if (await httpsTrusted(loc.host, fetchFn, timeoutMs)) return decideAction(true, false);
  return decideAction(false, await caServed(fetchFn));
}
