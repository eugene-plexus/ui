"use client";

import Link from "next/link";
import { useState } from "react";

import { ConfigEditor } from "@/components/ConfigEditor";
import type { ProxyTarget } from "@/lib/config";

const TARGETS: { value: ProxyTarget; label: string }[] = [
  { value: "orchestrator", label: "Orchestrator" },
  { value: "left", label: "Left Hemisphere" },
  { value: "right", label: "Right Hemisphere" },
];

export default function ConfigPage() {
  const [target, setTarget] = useState<ProxyTarget>("orchestrator");

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-xs text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
          >
            ← Back to chat
          </Link>
          <h1 className="text-sm font-semibold tracking-wide">Config</h1>
        </div>
        <nav className="flex gap-1">
          {TARGETS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTarget(t.value)}
              className={`rounded px-3 py-1 text-xs ${
                target === t.value
                  ? "bg-[color:var(--accent-left)] text-black"
                  : "border border-[color:var(--border)] text-[color:var(--foreground)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <div className="flex-1 overflow-hidden">
        <ConfigEditor
          key={target}
          target={target}
          label={TARGETS.find((t) => t.value === target)!.label}
        />
      </div>
    </main>
  );
}
