"use client";

import { JumpToBottomButton } from "@/components/JumpToBottomButton";
import { useAutoScroll } from "@/lib/useAutoScroll";
import {
  NT_KEYS,
  type ConsciousnessEvent,
  type GateDecision,
  type Message,
  type NTState,
  type PassRecord,
  type ToolInvocationRecord,
} from "@/lib/types";
import type { ConnectionStatus } from "@/lib/stream";

/**
 * Right-side panel: Eugene's live stream of consciousness. Under the M2
 * continuous-runtime contract this is no longer a per-turn snapshot — it's
 * the running feed of everything the loop publishes on
 * `GET /v1/stream/consciousness`, rendered in arrival order:
 *
 *   - thought       → ThoughtCard (the bicameral pair, the old M0.5 rail)
 *   - gate_decision → GateCard (the action the gate elected)
 *   - tool_call     → a channel-colored tool chip (afferent/efferent/internal)
 *   - nt_update / focus_switch / phase_change / speech → slim timeline markers
 *
 * A pinned header shows the current NT levels, wake/sleep phase, and the
 * SSE connection status — the persistent state behind the scrolling feed.
 */

// A feed entry: the parsed SSE event plus a monotonic sequence number the
// page assigns on arrival, used as a stable React key (events carry no id).
export interface FeedItem {
  seq: number;
  event: ConsciousnessEvent;
}

export function ConsciousnessStream({
  items,
  ntState,
  phase,
  focus,
  connection,
}: {
  items: FeedItem[];
  ntState: NTState | null;
  phase: "awake" | "asleep";
  focus: string | null;
  connection: ConnectionStatus;
}) {
  // Sticky-bottom (not force): follow the live feed when already at the
  // bottom, but don't yank the operator back down if they've scrolled up to
  // re-read an earlier thought while events keep arriving. JumpToBottom
  // covers the manual return.
  const { scrollRef, isAtBottom, scrollToBottom } = useAutoScroll(items.length);

  return (
    <div className="relative flex h-full flex-col">
      <StreamHeader ntState={ntState} phase={phase} focus={focus} connection={connection} />
      <div className="relative min-h-0 flex-1">
        {items.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-[color:var(--muted)]">
            Eugene&rsquo;s thoughts, decisions, and tool use will stream here as the loop runs.
          </div>
        ) : (
          <div ref={scrollRef} className="flex h-full flex-col gap-2 overflow-y-auto p-3">
            {items.map((item) => (
              <FeedRow key={item.seq} event={item.event} />
            ))}
          </div>
        )}
        {!isAtBottom && items.length > 0 && <JumpToBottomButton onClick={scrollToBottom} />}
      </div>
    </div>
  );
}

// --- header: NT bar + phase + connection ----------------------------------

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  connecting: "connecting",
  open: "live",
  reconnecting: "reconnecting",
  closed: "offline",
};

const CONNECTION_CLASS: Record<ConnectionStatus, string> = {
  connecting: "status-warn",
  open: "status-success",
  reconnecting: "status-warn",
  closed: "status-error",
};

function StreamHeader({
  ntState,
  phase,
  focus,
  connection,
}: {
  ntState: NTState | null;
  phase: "awake" | "asleep";
  focus: string | null;
  connection: ConnectionStatus;
}) {
  return (
    <div className="border-b border-[color:var(--border)] bg-[color:var(--panel)] px-3 py-2">
      <div className="mb-2 flex items-center justify-between font-mono text-[10px] tracking-wider uppercase">
        <span
          className={`rounded-[var(--radius)] px-1.5 py-0.5 ${
            phase === "awake" ? "text-[color:var(--muted)]" : "status-warn"
          }`}
          title={phase === "awake" ? "Eugene is awake" : "Eugene is asleep (consolidating)"}
        >
          {phase === "awake" ? "◍ awake" : "☾ asleep"}
        </span>
        <span
          className={`rounded-[var(--radius)] px-1.5 py-0.5 ${CONNECTION_CLASS[connection]}`}
          title="Consciousness stream connection"
        >
          {CONNECTION_LABEL[connection]}
        </span>
      </div>
      <NTBar ntState={ntState} />
      {focus && (
        <div
          className="mt-1.5 truncate font-mono text-[10px] text-[color:var(--muted)]"
          title={`current focus: ${focus}`}
        >
          focus · {focus.length > 14 ? `${focus.slice(0, 8)}…` : focus}
        </div>
      )}
    </div>
  );
}

const NT_ABBR: Record<string, string> = {
  dopamine: "DA",
  serotonin: "5HT",
  norepinephrine: "NE",
  acetylcholine: "ACh",
  gaba: "GABA",
  cortisol: "CORT",
};

function NTBar({ ntState }: { ntState: NTState | null }) {
  if (!ntState) {
    return (
      <div className="font-mono text-[10px] text-[color:var(--muted)]">
        nt · awaiting first tick
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {NT_KEYS.map((key) => {
        const lvl = ntState[key];
        const level = lvl?.level ?? 0;
        const baseline = lvl?.baseline ?? 0;
        // cortisol is the stress signal — flag it with the right accent;
        // everything else uses the left accent (the bicameral color
        // language, reused so no new theme tokens are needed).
        const color = key === "cortisol" ? "var(--accent-right)" : "var(--accent-left)";
        return (
          <div key={key} className="flex items-center gap-2" title={`${key}: ${level.toFixed(2)}`}>
            <span className="w-9 shrink-0 font-mono text-[9px] tracking-wide text-[color:var(--muted)]">
              {NT_ABBR[key] ?? key}
            </span>
            <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[color:var(--panel-soft)]">
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${Math.max(0, Math.min(1, level)) * 100}%`,
                  backgroundColor: color,
                }}
              />
              {/* baseline tick — where this NT rests */}
              <div
                className="absolute inset-y-0 w-px bg-[color:var(--foreground)] opacity-40"
                style={{ left: `${Math.max(0, Math.min(1, baseline)) * 100}%` }}
              />
            </div>
            <span className="w-7 shrink-0 text-right font-mono text-[9px] text-[color:var(--muted)]">
              {level.toFixed(2)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// --- feed rows ------------------------------------------------------------

function FeedRow({ event }: { event: ConsciousnessEvent }) {
  switch (event.type) {
    case "thought":
      return <ThoughtCard pass={event.data as PassRecord} />;
    case "gate_decision":
      return <GateCard decision={event.data as GateDecision} />;
    case "tool_call":
      return <ToolRow invocation={event.data as ToolInvocationRecord} />;
    case "nt_update":
      return <Marker glyph="≈" label="nt updated" tone="muted" />;
    case "focus_switch": {
      const d = event.data as { from: string | null; to: string | null };
      return <Marker glyph="⊙" label={`focus → ${d.to ? shorten(d.to) : "(none)"}`} tone="muted" />;
    }
    case "phase_change": {
      const d = event.data as { phase: "awake" | "asleep" };
      return <Marker glyph={d.phase === "asleep" ? "☾" : "◍"} label={d.phase} tone="warn" />;
    }
    case "speech":
      return <Marker glyph="↪" label="spoke" tone="success" />;
    default:
      return <Marker glyph="·" label={event.type} tone="muted" />;
  }
}

function shorten(s: string): string {
  return s.length > 12 ? `${s.slice(0, 8)}…` : s;
}

// Slim one-line timeline marker for low-detail events.
function Marker({
  glyph,
  label,
  tone,
}: {
  glyph: string;
  label: string;
  tone: "muted" | "success" | "warn";
}) {
  const toneClass =
    tone === "success"
      ? "text-[color:var(--accent-left)]"
      : tone === "warn"
        ? "text-[color:var(--accent-right)]"
        : "text-[color:var(--muted)]";
  return (
    <div className={`flex items-center gap-2 px-1 font-mono text-[10px] ${toneClass}`}>
      <span aria-hidden className="w-3 text-center">
        {glyph}
      </span>
      <span className="tracking-wide">{label}</span>
    </div>
  );
}

function GateCard({ decision }: { decision: GateDecision }) {
  const v = decision.anticipatedValence;
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius)] border border-dashed border-[color:var(--border)] px-2.5 py-1.5 font-mono text-[10px]">
      <span className="tracking-wider text-[color:var(--muted)] uppercase">gate</span>
      <span className="rounded-[var(--radius)] bg-[color:var(--panel-soft)] px-1.5 py-0.5 text-[color:var(--foreground)] uppercase">
        {decision.action}
      </span>
      {v != null && (
        <span className="text-[color:var(--muted)]" title="anticipated net NT valence">
          valence {v.toFixed(2)}
        </span>
      )}
    </div>
  );
}

// Afferent / efferent / internal reuse the bicameral accent tokens for
// distinct, theme-aware channel coloring (no new theme vars).
const CHANNEL_COLOR: Record<string, string> = {
  afferent: "var(--accent-left)",
  efferent: "var(--accent-right)",
  internal: "var(--muted)",
};

function ToolRow({ invocation }: { invocation: ToolInvocationRecord }) {
  const color = CHANNEL_COLOR[invocation.channel] ?? "var(--muted)";
  const title = [
    invocation.channel,
    invocation.effect,
    invocation.summary,
    invocation.latencyMs != null ? `${invocation.latencyMs}ms` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="px-1">
      <span
        className="inline-flex items-center gap-1 rounded-[var(--radius)] border px-2 py-0.5 font-mono text-[10px]"
        style={{ borderColor: color, color }}
        title={title}
      >
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        {invocation.name}
        {invocation.summary ? (
          <span className="text-[color:var(--muted)]">· {invocation.summary}</span>
        ) : null}
      </span>
    </div>
  );
}

// --- ThoughtCard (the bicameral pair; was PassCard in the M0.5 rail) ------

function ThoughtCard({ pass }: { pass: PassRecord }) {
  const callosum = pass.callosum;
  const deliberative = pass.hemispheres.length > 1;
  return (
    <div className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)]">
      <div className="flex items-center justify-between border-b border-[color:var(--border)] px-3 py-2 text-xs">
        <span className="font-mono text-[color:var(--muted)]">
          {deliberative ? "thought" : "thought (single)"} · pass {pass.passIndex}
        </span>
        {deliberative && (
          <DecisionBadge decision={callosum.decision} agreement={callosum.agreement} />
        )}
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
  // Indices >= 2 (more than two drivers per pass) → neutral, left-aligned.
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
