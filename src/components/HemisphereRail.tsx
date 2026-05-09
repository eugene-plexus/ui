"use client";

import type { PassRecord } from "@/lib/types";

/**
 * Right-side panel showing every bicameral pass: each pass's two
 * hemisphere outputs side-by-side, plus the corpus-callosum agreement
 * and decision.
 *
 * This is the load-bearing debugging surface in v0.1 — when the bicameral
 * loop produces an unexpected response, this rail tells you which
 * hemisphere said what and why the orchestrator decided the way it did.
 */
export function HemisphereRail({ passes }: { passes: PassRecord[] }) {
  if (passes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-[color:var(--muted)]">
        Hemisphere outputs from each bicameral pass will appear here.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      {passes.map((p) => (
        <PassCard key={p.passIndex} pass={p} />
      ))}
    </div>
  );
}

function PassCard({ pass }: { pass: PassRecord }) {
  const left = pass.hemispheres.find((m) => m.hemisphere === "left");
  const right = pass.hemispheres.find((m) => m.hemisphere === "right");
  const callosum = pass.callosum;

  return (
    <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--panel)]">
      <div className="flex items-center justify-between border-b border-[color:var(--border)] px-3 py-2 text-xs">
        <span className="font-mono text-[color:var(--muted)]">pass {pass.passIndex}</span>
        <DecisionBadge decision={callosum.decision} agreement={callosum.agreement} />
      </div>
      <div className="grid grid-cols-2 divide-x divide-[color:var(--border)]">
        <HemisphereOutput color="var(--accent-left)" label="left" content={left?.content ?? ""} />
        <HemisphereOutput
          color="var(--accent-right)"
          label="right"
          content={right?.content ?? ""}
        />
      </div>
    </div>
  );
}

function HemisphereOutput({
  color,
  label,
  content,
}: {
  color: string;
  label: string;
  content: string;
}) {
  return (
    <div className="p-3">
      <div className="mb-2 font-mono text-[10px] tracking-wider uppercase" style={{ color }}>
        {label}
      </div>
      <div className="text-sm leading-relaxed whitespace-pre-wrap">
        {content || <span className="text-[color:var(--muted)]">(empty)</span>}
      </div>
    </div>
  );
}

function DecisionBadge({
  decision,
  agreement,
}: {
  decision: PassRecord["callosum"]["decision"];
  agreement: number;
}) {
  const label = decision.replaceAll("_", " ");
  const accent =
    decision === "terminate"
      ? "bg-emerald-900/40 text-emerald-300"
      : decision === "another_pass"
        ? "bg-amber-900/40 text-amber-300"
        : "bg-rose-900/40 text-rose-300";
  return (
    <span
      className={`rounded px-2 py-0.5 font-mono text-[10px] uppercase ${accent}`}
      title={`agreement: ${agreement.toFixed(2)}`}
    >
      {label} · {agreement.toFixed(2)}
    </span>
  );
}
