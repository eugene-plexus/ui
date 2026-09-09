"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { ConfigEditor } from "@/components/ConfigEditor";
import { UIPreferences } from "@/components/UIPreferences";
import { ApiError, api } from "@/lib/api";
import type { ComponentList } from "@/lib/types";

interface Tab {
  value: string;
  label: string;
}

const STATIC_TABS: Tab[] = [
  { value: "ui", label: "UI" },
  { value: "agent", label: "Agent" },
  { value: "gateway", label: "Gateway" },
];

export default function ConfigPage() {
  const [drivers, setDrivers] = useState<Tab[]>([]);
  // Rendered only when the topology actually has one. A tab for a
  // component nobody spawned would open an editor that 503s.
  const [hasLibrary, setHasLibrary] = useState(false);
  const [driversError, setDriversError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("ui");

  // Driver tabs come from the agent topology, which is where a
  // driver's URL is written down and therefore the only list that can't
  // disagree with what the proxy will resolve. The gateway's
  // /v1/admin/drivers is a live-health view of the same set and 503s
  // when nothing is reachable — the wrong source for a tab bar whose
  // whole job is to let an operator fix an unreachable driver.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await api.get<ComponentList>("agent", "/v1/components");
        if (cancelled) return;
        const components = list.components ?? [];
        setDrivers(
          components
            .filter((c) => c.kind === "inference-driver")
            .map((c) => ({ value: c.name, label: c.name })),
        );
        // The proxy resolves `library` by kind rather than by name —
        // there is exactly one — so the tab value is the literal target.
        setHasLibrary(components.some((c) => c.kind === "library"));
        setDriversError(null);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) return;
        setDriversError(e instanceof Error ? e.message : String(e));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const tabs: Tab[] = useMemo(
    () => [
      ...STATIC_TABS,
      ...(hasLibrary ? [{ value: "library", label: "Library" }] : []),
      ...drivers,
    ],
    [drivers, hasLibrary],
  );

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="font-ui text-xs text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
          >
            ← Back to playground
          </Link>
          <h1 className="font-ui text-sm font-semibold tracking-wide">Config</h1>
        </div>
        <nav className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={`font-ui rounded-[var(--radius)] px-3 py-1 text-xs transition-colors ${
                tab === t.value
                  ? "bg-[color:var(--accent-left)] text-[color:var(--on-accent-left)] hover:brightness-110"
                  : "border border-[color:var(--border)] text-[color:var(--foreground)] hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
              }`}
            >
              {t.label}
            </button>
          ))}
          <Link
            href="/runtimes"
            className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-xs transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
          >
            Runtimes →
          </Link>
        </nav>
      </header>
      {driversError && (
        <div className="status-error border-b px-4 py-2 text-xs">
          Driver list could not be loaded — {driversError}. Driver tabs may be missing or stale.
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        {tab === "ui" ? (
          <UIPreferences />
        ) : (
          <ConfigEditor
            key={tab}
            target={tab}
            label={tabs.find((t) => t.value === tab)?.label ?? tab}
          />
        )}
      </div>
    </main>
  );
}
