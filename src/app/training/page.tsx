"use client";

import Link from "next/link";

import { TrainingPanel } from "@/components/TrainingPanel";

/**
 * Training surface for the local-LLM-training platform: build, run, and watch
 * pipelines (data prep → tokenizer → training → eval → serve) via the
 * coordinator. A sibling of /config; reached from the chat header.
 */
export default function TrainingPage() {
  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-[color:var(--border)] bg-[color:var(--panel)] px-4 py-3">
        <Link
          href="/"
          className="font-ui text-xs text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
        >
          ← Back to chat
        </Link>
        <h1 className="font-ui text-sm font-semibold tracking-wide">Training</h1>
      </header>
      <div className="flex-1 overflow-hidden">
        <TrainingPanel />
      </div>
    </main>
  );
}
