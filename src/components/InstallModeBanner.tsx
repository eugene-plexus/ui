"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { api } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";

/**
 * Dev mode, said on every page (J13, J18; remote-nodes.md §3.3).
 *
 * In dev mode Eugene's owner sees every tool result, job sites' included, and
 * may give themselves a job site's folders; every Workbench user is told so.
 * The owner is told here, on every page, that the install is in that mode.
 * Production mode says nothing: it is the default and restricts the owner.
 * A root that cannot be read says nothing either, rather than guess.
 */
export function InstallModeBanner() {
  const [dev, setDev] = useState(false);
  const load = useCallback(async () => {
    try {
      const config = await api.get<{ installMode?: string }>("control", "/v1/config");
      setDev(config.installMode === "dev");
    } catch {
      setDev(false);
    }
  }, []);
  usePolling(load, 60000);
  if (!dev) return null;
  return (
    <div
      role="status"
      data-testid="install-mode-banner"
      className="status-warn border-b px-4 py-2 text-sm"
    >
      Dev mode: you can see every tool result, job sites&apos; included, and give yourself their
      folders. Every Workbench user is told.{" "}
      <Link href="/config" className="underline">
        Change it in Settings
      </Link>
    </div>
  );
}
