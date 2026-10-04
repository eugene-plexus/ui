/**
 * Adding a search account (P8): the pure half, tested without a browser.
 *
 * A search account is a tool-driver the agent supervises, one per provider
 * account: a SearXNG instance, or a Brave Search subscription. Web search
 * then runs for any model that calls tools -- Codex's live search, Claude
 * Code's WebSearch, chat's `web_search_options` -- on this account.
 */

import type { Component } from "@/lib/types";

export type SearchProvider = "searxng" | "brave";

export interface SearchDraft {
  provider: SearchProvider;
  /** SearXNG: the instance's address. Unused for Brave. */
  address: string;
  /** Brave: the subscription token. Unused for SearXNG. */
  apiKey: string;
}

export function blankSearch(): SearchDraft {
  return { provider: "searxng", address: "", apiKey: "" };
}

export const SEARCH_PROVIDERS: ReadonlyArray<{
  id: SearchProvider;
  label: string;
  says: string;
}> = [
  {
    id: "searxng",
    label: "SearXNG",
    says: "Free. It runs on your own computer or server and asks other search engines for you.",
  },
  {
    id: "brave",
    label: "Brave Search",
    says: "A paid service with its own index. Brave counts every search against your plan.",
  },
];

/** Whether the form holds enough to try. An address must be a web address. */
export function searchDraftComplete(draft: SearchDraft): boolean {
  if (draft.provider === "brave") return draft.apiKey.trim().length > 0;
  return /^https?:\/\/[^\s/]+/.test(draft.address.trim());
}

/** The account's settings, as its config trio takes them. */
export function searchPatch(draft: SearchDraft): Record<string, unknown> {
  if (draft.provider === "brave") {
    return { provider: "brave", apiKey: draft.apiKey.trim() };
  }
  return { provider: "searxng", baseUrl: draft.address.trim().replace(/\/+$/, "") };
}

/** `searxng`, `searxng-2`, ... -- a name nothing else on the machine has. */
export function searchNameFor(provider: SearchProvider, existing: Component[]): string {
  const taken = new Set(existing.map((c) => c.name));
  if (!taken.has(provider)) return provider;
  for (let i = 2; ; i++) {
    if (!taken.has(`${provider}-${i}`)) return `${provider}-${i}`;
  }
}

/**
 * A port from 8190, the tool-driver's own range: above the companions'
 * 8090-8189 and the added drivers' 8081-8089, so a search account added
 * the same day as a backend cannot take its port.
 */
export function freeSearchPort(existing: Component[]): number {
  const taken = new Set(
    existing.map((c) => Number(new URL(c.url).port)).filter((n) => Number.isFinite(n)),
  );
  for (let port = 8190; port < 8200; port++) {
    if (!taken.has(port)) return port;
  }
  throw new Error(
    "No free port between 8190 and 8199 for another search account. Remove one first.",
  );
}

/**
 * What to tell the person when the Test search failed, beyond the account's
 * own sentence: the one change that fixes the commonest cause.
 */
export function remedyFor(provider: SearchProvider, error: string): string | null {
  if (provider === "searxng" && /search\.formats|403/.test(error)) {
    return 'In your SearXNG’s settings.yml, add json under search: formats: (so it reads "- html" and "- json"), then restart SearXNG and press Try again.';
  }
  if (provider === "searxng" && /could not be reached|did not answer/.test(error)) {
    return "Check the address, and that this machine can reach it. A SearXNG in a container must publish its port.";
  }
  if (provider === "brave" && /API key|401|403/.test(error)) {
    return "Copy the key again from api-dashboard.search.brave.com and press Try again.";
  }
  return null;
}
