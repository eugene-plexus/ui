"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { ConfigEditor } from "@/components/ConfigEditor";
import { ConnectorPanel } from "@/components/ConnectorPanel";
import { IdentityPanel } from "@/components/IdentityPanel";
import { UIPreferences } from "@/components/UIPreferences";
import { ApiError, api } from "@/lib/api";
import type { DriversInfo } from "@/lib/types";

interface DynamicTab {
  value: string;
  label: string;
}

// v0.2 body components (memory, identity, connector) are surfaced as
// fixed tabs alongside UI + Orchestrator. Drivers stay dynamic since
// their names are operator-supplied.
const STATIC_TABS: DynamicTab[] = [
  { value: "ui", label: "UI" },
  { value: "orchestrator", label: "Orchestrator" },
  { value: "memory", label: "Memory" },
  { value: "identity", label: "Identity" },
  { value: "connector", label: "Connector" },
];

const CONNECTOR_TAB = "connector";
const IDENTITY_TAB = "identity";

export default function ConfigPage() {
  const [drivers, setDrivers] = useState<DynamicTab[]>([]);
  const [driversError, setDriversError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("ui");

  // Pull the driver topology from the orchestrator so the tab bar mirrors
  // whatever drivers the operator has configured. v0.1 ships with two
  // ("left", "right") but the UI no longer hardcodes that.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const info = await api.get<DriversInfo>("orchestrator", "/v1/admin/drivers");
        if (cancelled) return;
        setDrivers(
          info.drivers.map((d) => ({
            value: d.name,
            label: d.name.charAt(0).toUpperCase() + d.name.slice(1),
          })),
        );
      } catch (e) {
        if (cancelled) return;
        // 503 from /v1/admin/drivers means all drivers are unreachable.
        // Fall back to reading the saved config so the tabs still appear
        // and the user can edit them.
        if (e instanceof ApiError && e.status === 503) {
          try {
            const config = await api.get<Record<string, unknown>>(
              "orchestrator",
              "/v1/config",
            );
            const list = config.drivers;
            if (Array.isArray(list)) {
              setDrivers(
                list
                  .filter(
                    (d): d is { name: string } =>
                      typeof d === "object" &&
                      d !== null &&
                      typeof (d as { name?: unknown }).name === "string",
                  )
                  .map((d) => ({
                    value: d.name,
                    label: d.name.charAt(0).toUpperCase() + d.name.slice(1),
                  })),
              );
              setDriversError(null);
              return;
            }
          } catch {
            // Fall through to the original error.
          }
        }
        setDriversError(e instanceof Error ? e.message : String(e));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const tabs: DynamicTab[] = useMemo(() => [...STATIC_TABS, ...drivers], [drivers]);

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="font-ui text-xs text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
          >
            ← Back to chat
          </Link>
          <h1 className="font-ui text-sm font-semibold tracking-wide">Config</h1>
        </div>
        <nav className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={`font-ui rounded px-3 py-1 text-xs transition-colors ${
                tab === t.value
                  ? "bg-[color:var(--accent-left)] text-[color:var(--on-accent-left)] hover:brightness-110"
                  : "border border-[color:var(--border)] text-[color:var(--foreground)] hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)]"
              }`}
            >
              {t.label}
            </button>
          ))}
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
        ) : tab === CONNECTOR_TAB ? (
          <ConnectorPanel />
        ) : tab === IDENTITY_TAB ? (
          <IdentityPanel />
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
