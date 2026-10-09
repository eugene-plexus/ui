"use client";

/**
 * Web search order (GS7): which search account a web search tries first.
 *
 * Reads the gateway's routing view (`search_accounts`, in the order in
 * effect) and saves the gateway's `webSearchOrder`. Reordering is move up /
 * move down buttons, as the priority lists above it. After Save the page
 * re-reads the routing view, so what is shown is what the gateway reports,
 * not what was sent. The search accounts page links here and this links back.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { api, describeError } from "@/lib/api";
import {
  accountWords,
  applyOrder,
  DEFAULT_RULE,
  effectiveOrderWords,
  moveKey,
  orderChanged,
  orderKey,
  orderPatch,
  placedByOrder,
} from "@/lib/searchOrder";
import type { ConfigUpdateResult, RoutingTableView } from "@/lib/types";

const smallButtonClass =
  "action-button font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40";

export function WebSearchOrder({
  routing,
  onReload,
}: {
  /** The gateway's routing view; null when it could not be read. */
  routing: RoutingTableView | null;
  /** Re-read the routing view from the gateway. */
  onReload: () => Promise<void>;
}) {
  const accounts = routing?.search_accounts ?? [];
  // null: untouched, so the gateway's own order is shown.
  const [draft, setDraft] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const shown = applyOrder(accounts, draft);
  const changed = orderChanged(accounts, draft);
  const named = placedByOrder(accounts);

  // Focus follows the account that moved, as it does in the lists above.
  const list = useRef<HTMLOListElement | null>(null);
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const selector = focusNext.current;
    if (!selector) return;
    focusNext.current = null;
    list.current?.querySelector<HTMLElement>(selector)?.focus();
  });

  function move(index: number, delta: -1 | 1) {
    const to = index + delta;
    const edge = (delta < 0 && to === 0) || (delta > 0 && to === shown.length - 1);
    const arrow = edge ? (delta < 0 ? "down" : "up") : delta < 0 ? "up" : "down";
    focusNext.current = `[data-move="${arrow}"][data-row="${to}"]`;
    setSaved(null);
    setDraft(moveKey(shown.map(orderKey), index, delta));
  }

  async function write(keys: string[], done: string) {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const result = await api.patch<ConfigUpdateResult>("gateway", "/v1/config", orderPatch(keys));
      const rejected = (result.rejected ?? []) as { message?: string }[];
      if (rejected.length > 0) {
        setError(rejected.map((r) => r.message ?? "rejected").join(" "));
        return;
      }
      // Never trust local state: read what the gateway now reports.
      await onReload();
      setDraft(null);
      setSaved(done);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      id="web-search-order"
      data-testid="web-search-order"
      className="section-panel mt-8 scroll-mt-4"
    >
      <h2 className="section-heading font-ui text-base font-semibold">Web search order</h2>
      <p className="mb-3 text-sm text-[color:var(--muted)]">
        When a model searches the web, Eugene tries these search accounts from the top, and the next
        one when an account fails. Add or change accounts on{" "}
        <Link href="/backends/search?sel=backends" className="underline">
          the search accounts page
        </Link>
        .
      </p>

      {!routing && (
        <p className="text-sm text-[color:var(--muted)]" data-testid="search-order-unavailable">
          The search accounts could not be read, because the routing view is missing.
        </p>
      )}

      {routing && accounts.length === 0 && (
        <p className="text-sm text-[color:var(--muted)]" data-testid="search-order-empty">
          No search accounts yet.{" "}
          <Link href="/backends/search?sel=backends" className="underline">
            Add one
          </Link>{" "}
          to let your models search the web.
        </p>
      )}

      {accounts.length > 0 && (
        <>
          <p className="mb-3 text-sm" data-testid="search-order-in-effect" role="status">
            {changed
              ? "You have moved accounts. Nothing changes until you press Save order."
              : effectiveOrderWords(accounts)}
          </p>
          <ol ref={list} className="space-y-2" aria-label="Web search order">
            {shown.map((account, i) => {
              const w = accountWords(account);
              return (
                <li
                  key={orderKey(account)}
                  data-testid="search-order-row"
                  className="routing-step flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2"
                >
                  <span className="routing-step-number font-ui" aria-hidden>
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-medium">{w.title}</span>{" "}
                    <span className="font-mono text-xs text-[color:var(--muted)]">
                      {account.name}
                    </span>
                    {w.where && <span className="text-[color:var(--muted)]"> {w.where}</span>}
                    {w.billing && <span className="text-[color:var(--muted)]"> · {w.billing}</span>}
                    {w.notSetUp && (
                      <span className="text-[color:var(--status-warn-fg)]"> · not set up</span>
                    )}
                    {!changed && (
                      <span className="text-xs text-[color:var(--muted)]">
                        {" "}
                        · {account.placed_by === "order" ? "your order" : "default order"}
                      </span>
                    )}
                  </span>
                  <span className="flex gap-1">
                    <button
                      type="button"
                      data-move="up"
                      data-row={i}
                      onClick={() => move(i, -1)}
                      disabled={busy || i === 0}
                      aria-label={`Search ${w.title} (${account.name}) earlier`}
                      className={smallButtonClass}
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      data-move="down"
                      data-row={i}
                      onClick={() => move(i, 1)}
                      disabled={busy || i === shown.length - 1}
                      aria-label={`Search ${w.title} (${account.name}) later`}
                      className={smallButtonClass}
                    >
                      Move down
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() =>
                void write(
                  shown.map(orderKey),
                  "Saved. The order above is the one the gateway reports.",
                )
              }
              disabled={busy || !changed}
              data-testid="search-order-save"
              className="font-ui rounded-[var(--radius)] border border-[color:var(--accent-left)] px-4 py-1.5 text-sm font-semibold transition-colors hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save order"}
            </button>
            <button
              type="button"
              onClick={() => void write([], `Back to the default order: ${DEFAULT_RULE}.`)}
              disabled={busy || (named === 0 && !changed)}
              data-testid="search-order-reset"
              className={smallButtonClass}
            >
              Use the default order
            </button>
            {changed && (
              <button
                type="button"
                onClick={() => setDraft(null)}
                disabled={busy}
                className={smallButtonClass}
              >
                Revert
              </button>
            )}
          </div>
        </>
      )}

      {error && (
        <p className="status-error mt-3 text-sm" data-testid="search-order-error">
          Not saved: {error}
        </p>
      )}
      {saved && (
        <p className="mt-3 text-sm text-[color:var(--muted)]" data-testid="search-order-saved">
          {saved}
        </p>
      )}
    </section>
  );
}
