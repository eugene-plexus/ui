"use client";

import { useEffect } from "react";

/**
 * What the browser tab says.
 *
 * It said **"Eugene Plexus"** on every screen of every install until
 * 2026-09-17, which is the one string a tab title must never be: a person
 * with Discover open on one box and Config on another had two identical
 * tabs, and the thing a title is for is telling them apart.
 *
 * Three fields, most specific first, because a tab is truncated from the
 * right and the discriminator has to survive it:
 *
 *     Discover · Amish_Station · Eugene Plexus
 *     Config · nas · Eugene Plexus
 *     Home · Eugene Plexus                        (one machine)
 *     Eugene Plexus                               (nothing known yet)
 *
 * **The machine is named only when there is more than one**, from the
 * same count the tree uses to decide whether to draw the machine level at
 * all (`machineCount`) — so a title claiming a host and a tree hiding
 * them cannot both be on screen. On the commonest install, one box, the
 * name is noise: it is the same on every tab and it costs the page name
 * its room.
 *
 * **Which machine** is the selected object's, when the selection names
 * one, and this console's own host otherwise. That ordering is the whole
 * value: two `/config` tabs differ *only* by the node they are addressing
 * (`agent:Amish_Station` vs `agent:nas`), so a title carrying the console
 * host would print the same name on both and answer nothing. For an
 * install-wide page — Home, Discover, Metrics — there is no object node,
 * and the useful answer becomes which box is serving this tab, which is
 * the other way two identical tabs arise on a multi-host install.
 *
 * The brand stays last and always present: it is what makes the tab
 * recognisable in a strip of twenty, and it is the pre-hydration title in
 * `layout.tsx`, so the export's first paint and this agree.
 */
export const BRAND = "Eugene Plexus";

/** The app's own separator, the one the page menu and breadcrumbs use. */
const SEPARATOR = " · ";

export function pageTitle({
  page,
  node,
  machines,
}: {
  /** This screen's name — "Discover", "Config", "Folders". */
  page: string | null | undefined;
  /** The machine the page is about, or this console's host. */
  node: string | null | undefined;
  /** How many machines the install has. The name is shown above one. */
  machines: number;
}): string {
  const parts: string[] = [];
  const name = page?.trim();
  if (name) parts.push(name);
  const where = node?.trim();
  // Above one machine only. `machines` is the tree's own count, so this
  // cannot disagree with whether the tree is showing machines at all.
  if (where && machines > 1) parts.push(where);
  parts.push(BRAND);
  return parts.join(SEPARATOR);
}

/**
 * Set `document.title`.
 *
 * An effect and not `export const metadata`, because every screen in this
 * app is a client component and `output: export` prerenders them: Next's
 * metadata is per-route and static, and the node in this title is neither
 * — it comes from a topology fetched after hydration. The static title in
 * `layout.tsx` is the first paint and the fallback, which is why it is
 * exactly `BRAND` and why this only ever extends it.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
