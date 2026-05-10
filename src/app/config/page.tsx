"use client";

import Link from "next/link";
import { useState } from "react";

import { ConfigEditor } from "@/components/ConfigEditor";
import { UIPreferences } from "@/components/UIPreferences";
import type { ProxyTarget } from "@/lib/config";

type Tab = "ui" | ProxyTarget;

const TABS: { value: Tab; label: string }[] = [
  { value: "ui", label: "UI" },
  { value: "orchestrator", label: "Orchestrator" },
  { value: "left", label: "Left Hemisphere" },
  { value: "right", label: "Right Hemisphere" },
];

export default function ConfigPage() {
  const [tab, setTab] = useState<Tab>("ui");

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
          {TABS.map((t) => (
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
      <div className="flex-1 overflow-hidden">
        {tab === "ui" ? (
          <UIPreferences />
        ) : (
          <ConfigEditor
            key={tab}
            target={tab}
            label={TABS.find((t) => t.value === tab)!.label}
          />
        )}
      </div>
    </main>
  );
}
