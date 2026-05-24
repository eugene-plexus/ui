"use client";

import { useState } from "react";

import type { Message, PassRecord } from "@/lib/types";

interface HemisphereInputSnapshot {
  driverName: string;
  messages: Message[];
}

interface VoicePassRecord {
  driverName: string;
  inputMessages: Message[];
  output: Message;
  latencyMs?: number;
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

/**
 * Copy the full bicameral trace of the most recent turn to the
 * clipboard as Markdown — every pass with its callosum decision and
 * agreement score, plus the final blended response Eugene sent back.
 *
 * Designed so a debug session can be pasted verbatim into a follow-up
 * chat with Claude (or a GitHub issue) and rendered correctly. The
 * format matches what Troy hand-typed during the first multi-pass
 * confusion bug report.
 */
export function CopyTraceButton({
  messages,
  passes,
  voicePass,
}: {
  messages: Message[];
  passes: PassRecord[];
  voicePass: VoicePassRecord | null;
}) {
  const [feedback, setFeedback] = useState<"idle" | "copied" | "error">("idle");

  const disabled = passes.length === 0;

  async function copy() {
    try {
      const trace = formatTrace(messages, passes, voicePass);
      await navigator.clipboard.writeText(trace);
      setFeedback("copied");
      setTimeout(() => setFeedback("idle"), 1500);
    } catch {
      setFeedback("error");
      setTimeout(() => setFeedback("idle"), 2000);
    }
  }

  const label =
    feedback === "copied" ? "copied" : feedback === "error" ? "failed" : "copy trace";

  return (
    <button
      type="button"
      onClick={() => void copy()}
      disabled={disabled}
      title={
        disabled
          ? "Send a chat turn first; the trace will appear here."
          : "Copy the most recent turn's bicameral trace as Markdown."
      }
      className="font-ui rounded border border-[color:var(--border)] px-2 py-0.5 font-mono text-[10px] tracking-wider uppercase transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[color:var(--border)] disabled:hover:bg-transparent"
    >
      {label}
    </button>
  );
}

function formatTrace(
  messages: Message[],
  passes: PassRecord[],
  voicePass: VoicePassRecord | null,
): string {
  const out: string[] = [];
  out.push("## Bicameral trace");
  out.push("");

  // Find the most recent user message — that's the prompt for this turn.
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  if (lastUserMessage) {
    out.push("### User prompt");
    out.push("");
    out.push(lastUserMessage.content);
    out.push("");
  }

  for (const p of passes) {
    const decision = p.callosum.decision.replaceAll("_", " ");
    const agreement = p.callosum.agreement.toFixed(2);
    out.push(`### Pass ${p.passIndex} — ${decision} · ${agreement}`);
    out.push("");

    // Per-hemisphere input snapshots. The orchestrator emits these in
    // `hemisphereInputs` parallel to `hemispheres`; show input + output
    // side by side so anyone reading the trace can see exactly what
    // the driver saw and what it replied. Skip the section silently if
    // we're talking to a pre-v0.2 orchestrator that doesn't emit it.
    const inputs = (p as { hemisphereInputs?: HemisphereInputSnapshot[] })
      .hemisphereInputs;
    if (inputs && inputs.length > 0) {
      for (const input of inputs) {
        out.push(`#### Pass ${p.passIndex} input → ${input.driverName}`);
        out.push("");
        for (const msg of input.messages) {
          const driverTag = msg.driverName ? ` (${msg.driverName})` : "";
          out.push(`- **${msg.role}${driverTag}:**`);
          out.push("");
          out.push(indent(msg.content || "_(empty)_", "  "));
          out.push("");
        }
      }
    }

    out.push(`#### Pass ${p.passIndex} output`);
    out.push("");
    for (const h of p.hemispheres) {
      const label = h.driverName ?? "(unknown)";
      out.push(`**${label}**`);
      out.push("");
      out.push(h.content || "_(empty)_");
      out.push("");
    }
  }

  // v0.2.x voice pass — the post-deliberation LLM call that converts
  // internal deliberation into Eugene's user-facing reply. Surface
  // its input + output so the operator can see exactly what got
  // synthesized into the response.
  if (voicePass) {
    const latency = voicePass.latencyMs != null ? ` · ${voicePass.latencyMs}ms` : "";
    out.push(`### Voice pass → ${voicePass.driverName}${latency}`);
    out.push("");
    out.push(`#### Voice pass input → ${voicePass.driverName}`);
    out.push("");
    for (const msg of voicePass.inputMessages) {
      const driverTag = msg.driverName ? ` (${msg.driverName})` : "";
      out.push(`- **${msg.role}${driverTag}:**`);
      out.push("");
      out.push(indent(msg.content || "_(empty)_", "  "));
      out.push("");
    }
    out.push(`#### Voice pass output`);
    out.push("");
    out.push(voicePass.output.content || "_(empty)_");
    out.push("");
  }

  // The final assistant message Eugene actually sent — what the user saw.
  const lastAssistantMessage = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  if (lastAssistantMessage) {
    out.push("### Final response (shared with user)");
    out.push("");
    out.push(lastAssistantMessage.content);
    out.push("");
  }

  return out.join("\n");
}
