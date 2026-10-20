/**
 * Connect apps and the Access page, said for TLS (LT2b,
 * `docs/design/tls-for-clients.md` §6): which gateway address to show, which
 * trust steps apply, and the "Other names" field.
 */

import type { ClientTls } from "@/lib/clientDoors";

export type TlsFacts = Pick<ClientTls, "state" | "plainAllowed" | "source"> | null | undefined;

export interface GatewayUrls {
  /** The address to show and put in recipes. */
  primary: string | null;
  /** The http address, only while plain is allowed and https is the primary. */
  plain: string | null;
  /** What this page can actually reach to check the gateway: a device that
   * does not trust the CA cannot fetch https, and the check must not say the
   * gateway is down because of it. */
  check: string | null;
}

/** https first when this machine holds a certificate; http only while plain is allowed. */
export function gatewayUrls(guess: string | null, tls: TlsFacts): GatewayUrls {
  if (!guess) return { primary: null, plain: null, check: null };
  if (tls?.state !== "issued" || !guess.startsWith("http://")) {
    return { primary: guess, plain: null, check: guess };
  }
  const secure = `https://${guess.slice("http://".length)}`;
  return { primary: secure, plain: tls.plainAllowed ? guess : null, check: guess };
}

/** The trust steps and the bundle: only for the install's own CA. An owner's
 * own certificate is trusted by devices already. */
export function showTrustSteps(tls: TlsFacts): boolean {
  return tls?.state === "issued" && tls.source !== "supplied";
}

export const BUNDLE_HREF = "/v1/trust/ca?format=bundle";

/** What a machine's doors present, from its certificate names. */
export function certificateLine(
  tls: Pick<ClientTls, "state" | "names" | "source"> | null | undefined,
): string | null {
  if (!tls || tls.state !== "issued" || !tls.names || tls.names.length === 0) return null;
  const names = tls.names.join(", ");
  return tls.source === "supplied"
    ? `Your own certificate for ${names}`
    : `Install certificate for ${names}`;
}

export interface ParsedNames {
  names: string[];
  /** Entries that cannot be a name at all (a URL or a path). The root decides the rest. */
  invalid: string[];
}

/** A comma- or space-separated field into a clean, de-duplicated list. */
export function parseNames(input: string): ParsedNames {
  const seen = new Set<string>();
  const names: string[] = [];
  const invalid: string[] = [];
  for (const raw of input.split(/[\s,]+/)) {
    const name = raw.trim().toLowerCase().replace(/\.$/, "");
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (/[/\\@?#]/.test(name) || name.includes("://")) invalid.push(raw.trim());
    else names.push(name);
  }
  return { names, invalid };
}

/** Whether the field differs from what the root holds. */
export function namesChanged(input: string, saved: string[] | undefined): boolean {
  const now = parseNames(input).names;
  const was = (saved ?? []).map((n) => n.toLowerCase());
  return now.length !== was.length || now.some((n, i) => n !== was[i]);
}

export const NAMES_HELP =
  "Names this machine is also reached by, ending .local, .lan, .internal or .home.arpa. " +
  "For other names, use your own certificate (Settings).";
