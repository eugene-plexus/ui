"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { clientKeyTarget } from "@/lib/clientKeys";
import { CONNECT_APPS_HREF, savedAddressOverride } from "@/lib/connectApps";
import type { ClientKeyList, ComponentPlacementList } from "@/lib/types";

/**
 * Home's line about connecting apps (CX5): the address an app would use,
 * how many keys are live, and the way to the page that manages them.
 *
 * Always shown. The whole card moved to `/connect`, where it renders with or
 * without a model; Home used to show it only while a chat model was served.
 */
export function ConnectAppsSummary({
  gatewayPortUrl,
  placement,
  localNode,
}: {
  gatewayPortUrl: string | null;
  placement: ComponentPlacementList | null;
  localNode: string | null;
}) {
  const [override, setOverride] = useState<string | null>(null);
  const [liveKeys, setLiveKeys] = useState<number | null>(null);
  const where = useMemo(() => clientKeyTarget(placement, localNode), [placement, localNode]);

  useEffect(() => {
    setOverride(savedAddressOverride());
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ClientKeyList>(where.target, "/v1/auth/client-keys")
      .then((list) => {
        if (!cancelled) setLiveKeys((list.keys ?? []).filter((k) => !k.revokedAt).length);
      })
      // Unknown, not none: the count is left out rather than read as zero.
      .catch(() => {
        if (!cancelled) setLiveKeys(null);
      });
    return () => {
      cancelled = true;
    };
  }, [where.target]);

  const base = (override ?? gatewayPortUrl ?? "").replace(/\/+$/, "");
  return (
    <section data-testid="home-connect-apps" className="section-panel">
      <h2 className="section-heading font-ui text-sm font-semibold">Use it from your apps</h2>
      <p className="font-ui mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
        <code data-testid="home-connect-address" className="font-mono text-xs break-all">
          {base ? `${base}/v1` : "address not known yet"}
        </code>
        {liveKeys !== null && (
          <span data-testid="home-connect-keys" className="text-[color:var(--muted)]">
            {liveKeys === 0 ? "no keys yet" : `${liveKeys} key${liveKeys === 1 ? "" : "s"} in use`}
          </span>
        )}
        <Link href={CONNECT_APPS_HREF} className="ml-auto underline">
          Connect apps →
        </Link>
      </p>
    </section>
  );
}
