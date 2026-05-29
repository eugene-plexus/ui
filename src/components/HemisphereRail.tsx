"use client";

import { JumpToBottomButton } from "@/components/JumpToBottomButton";
import { useAutoScroll } from "@/lib/useAutoScroll";
import type { Message, PassRecord } from "@/lib/types";

/**
 * Right-side panel showing every bicameral pass: each pass's hemisphere
 * outputs stacked vertically, labelled by the operator-supplied driver
 * name (`message.driverName`), plus the corpus-callosum agreement and
 * decision.
 *
 * The first driver in each pass is drawn left-aligned with the "left"
 * accent, the second right-aligned with the "right" accent — preserving
 * the visual bicameral metaphor without hardcoding the names. Additional
 * drivers (when v0.2+ adds them) wrap with a neutral accent and stack
 * left-aligned.
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
  const callosum = pass.callosum;

  return (
    <div className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)]">
      <div className="flex items-center justify-between border-b border-[color:var(--border)] px-3 py-2 text-xs">
        <span className="font-mono text-[color:var(--muted)]">pass {pass.passIndex}</span>
        <DecisionBadge decision={callosum.decision} agreement={callosum.agreement} />
      </div>
      <div className="flex flex-col gap-3 p-3">
        {pass.hemispheres.map((m, i) => (
          <HemisphereOutput
            key={`${pass.passIndex}-${m.driverName ?? i}`}
            message={m}
            position={i}
          />
        ))}
      </div>
    </div>
  );
}

function HemisphereOutput({ message, position }: { message: Message; position: number }) {
  // Index 0 → left accent + left-aligned. Index 1 → right accent + right-aligned.
  // Indices >= 2 (future: more than two drivers per pass) → neutral, left-aligned.
  const isFirst = position === 0;
  const isSecond = position === 1;
  const align = isSecond ? "right" : "left";
  const color = isFirst ? "var(--accent-left)" : isSecond ? "var(--accent-right)" : "var(--muted)";
  const sideClass = align === "left" ? "self-start border-l-2 pl-3" : "self-end border-r-2 pr-3";
  const label = message.driverName ?? `driver-${position}`;
  return (
    <div className={`max-w-[92%] py-1 ${sideClass}`} style={{ borderColor: color }}>
      <div className="mb-1 font-mono text-[10px] tracking-wider uppercase" style={{ color }}>
        {label}
      </div>
      <div className="text-sm leading-relaxed whitespace-pre-wrap">
        {message.content || <span className="text-[color:var(--muted)]">(empty)</span>}
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
      ? "status-success"
      : decision === "another_pass"
        ? "status-warn"
        : "status-error";
  return (
    <span
      className={`rounded-[var(--radius)] px-2 py-0.5 font-mono text-[10px] uppercase ${accent}`}
      title={`agreement: ${agreement.toFixed(2)}`}
    >
      {label} · {agreement.toFixed(2)}
    </span>
  );
}
