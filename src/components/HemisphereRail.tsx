"use client";

import { JumpToBottomButton } from "@/components/JumpToBottomButton";
import { useAutoScroll } from "@/lib/useAutoScroll";
import type { PassRecord } from "@/lib/types";

/**
 * Right-side panel showing every bicameral pass: each pass's two
 * hemisphere outputs stacked vertically — left-aligned for the left
 * hemisphere, right-aligned for the right — plus the corpus-callosum
 * agreement and decision.
 *
 * Force-pins to the bottom on every update — when a new turn lands, the
 * latest pass is what the operator wants to see. The jump-to-bottom
 * button still appears for manual scrollback.
 */
export function HemisphereRail({ passes }: { passes: PassRecord[] }) {
  const { scrollRef, isAtBottom, scrollToBottom } = useAutoScroll(passes, {
    forceOnUpdate: true,
  });

  if (passes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-[color:var(--muted)]">
        Hemisphere outputs from each bicameral pass will appear here.
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <div ref={scrollRef} className="flex h-full flex-col gap-4 overflow-y-auto p-4">
        {passes.map((p) => (
          <PassCard key={p.passIndex} pass={p} />
        ))}
      </div>
      {!isAtBottom && <JumpToBottomButton onClick={scrollToBottom} />}
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
      <div className="flex flex-col gap-3 p-3">
        <HemisphereOutput
          color="var(--accent-left)"
          label="left"
          align="left"
          content={left?.content ?? ""}
        />
        <HemisphereOutput
          color="var(--accent-right)"
          label="right"
          align="right"
          content={right?.content ?? ""}
        />
      </div>
    </div>
  );
}

function HemisphereOutput({
  color,
  label,
  align,
  content,
}: {
  color: string;
  label: string;
  align: "left" | "right";
  content: string;
}) {
  const sideClass =
    align === "left" ? "self-start border-l-2 pl-3" : "self-end border-r-2 pr-3";
  return (
    <div
      className={`max-w-[92%] py-1 ${sideClass}`}
      style={{ borderColor: color }}
    >
      <div className="mb-1 font-mono text-[10px] tracking-wider uppercase" style={{ color }}>
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
