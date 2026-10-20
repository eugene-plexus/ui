/**
 * What the Connect apps page and Home's summary of it share (CX5).
 *
 * The card that hands an app its address, key and model lived on Home only,
 * and only while a chat model was served, so a leaked key could not be
 * turned off with the models stopped. It is a page of its own now, at
 * `/connect`, and the address it guesses is worked out here once for both.
 */

import { guessGatewayBaseUrl } from "@/lib/diagnostic";
import type { ComponentList, NodeIdentity } from "@/lib/types";

export const CONNECT_APPS_HREF = "/connect";

/** The address correction a person saved in this browser, by the card. */
export const BASE_URL_OVERRIDE = "eugene-gateway-base-url";

/**
 * The gateway's base URL as an app would use it: the install's published
 * entrypoint when there is one, else this page's host with the gateway's
 * port. A guess the card checks and lets a person correct.
 */
export function gatewayAddressGuess(
  node: NodeIdentity | null,
  components: ComponentList | null,
): string | null {
  if (node?.entrypoint) return node.entrypoint.inferenceUrl ?? null;
  if (typeof window === "undefined" || components === null) return null;
  return guessGatewayBaseUrl(
    (components.components ?? []).map((c) => ({
      kind: String(c.kind ?? ""),
      url: c.url ?? "",
      advertiseUrl: c.advertiseUrl ?? undefined,
    })),
    { protocol: window.location.protocol, hostname: window.location.hostname },
  );
}

/** The saved correction, or null; private mode reads as none. */
export function savedAddressOverride(): string | null {
  try {
    return localStorage.getItem(BASE_URL_OVERRIDE);
  } catch {
    return null;
  }
}
