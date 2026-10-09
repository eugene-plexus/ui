/**
 * Web search order (GS7): the pure half, tested without a browser.
 *
 * The gateway's `GET /v1/admin/routing` lists the search accounts in the
 * order a web search tries them. The person may set that order with the
 * gateway's `webSearchOrder` setting; unset, the default rule applies.
 */

import type { RoutingTableView } from "@/lib/types";

export type SearchAccountView = NonNullable<RoutingTableView["search_accounts"]>[number];

export const DEFAULT_RULE = "free accounts first, then this machine's before others";

/** The entry `webSearchOrder` takes: `name`, or `node:name` for an account on a machine. */
export function orderKey(account: Pick<SearchAccountView, "name" | "node">): string {
  return account.node ? `${account.node}:${account.name}` : account.name;
}

/**
 * The accounts in the person's draft order. `draft` null means untouched:
 * the gateway's own order. An account the draft does not name (added since)
 * keeps its place after the named ones; a name that is gone is dropped.
 */
export function applyOrder(
  accounts: readonly SearchAccountView[],
  draft: readonly string[] | null,
): SearchAccountView[] {
  if (!draft) return [...accounts];
  const byKey = new Map(accounts.map((a) => [orderKey(a), a]));
  const out: SearchAccountView[] = [];
  for (const key of draft) {
    const hit = byKey.get(key);
    if (hit) {
      out.push(hit);
      byKey.delete(key);
    }
  }
  return [...out, ...byKey.values()];
}

/** Swap an account with its neighbour. Out of range changes nothing. */
export function moveKey(keys: readonly string[], index: number, delta: -1 | 1): string[] {
  const to = index + delta;
  if (index < 0 || index >= keys.length || to < 0 || to >= keys.length) return [...keys];
  const next = [...keys];
  const [moved] = next.splice(index, 1);
  next.splice(to, 0, moved as string);
  return next;
}

/** The PATCH body that saves an order. An empty list means the default rule. */
export function orderPatch(keys: readonly string[]): { webSearchOrder: string[] } {
  return { webSearchOrder: [...keys] };
}

/** Whether a draft differs from what the gateway reports. */
export function orderChanged(
  accounts: readonly SearchAccountView[],
  draft: readonly string[] | null,
): boolean {
  if (!draft) return false;
  const shown = applyOrder(accounts, draft).map(orderKey);
  const current = accounts.map(orderKey);
  return shown.length !== current.length || shown.some((k, i) => k !== current[i]);
}

/** How many accounts the gateway places by the person's order. */
export function placedByOrder(accounts: readonly SearchAccountView[]): number {
  return accounts.filter((a) => a.placed_by === "order").length;
}

/** The sentence that says which order is in effect. Settings never lie. */
export function effectiveOrderWords(accounts: readonly SearchAccountView[]): string {
  const named = placedByOrder(accounts);
  if (accounts.length === 0) return "";
  if (named === 0) return `The default order is in effect: ${DEFAULT_RULE}.`;
  if (named === accounts.length) return "Your order is in effect.";
  return `Your order is in effect for the first ${named}. The rest follow the default order: ${DEFAULT_RULE}.`;
}

/** A row's words: what it is, where it runs, and how it is billed. */
export function accountWords(account: SearchAccountView): {
  title: string;
  where: string | null;
  billing: string | null;
  notSetUp: boolean;
} {
  return {
    title: account.label?.trim() || account.provider,
    where: account.node ? `on ${account.node}` : null,
    billing:
      account.billing === "free"
        ? "free"
        : account.billing === "per_search"
          ? "billed per search"
          : null,
    notSetUp: !account.runs,
  };
}
