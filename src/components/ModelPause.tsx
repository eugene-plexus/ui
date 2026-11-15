"use client";

import { useState } from "react";

import { ConfirmButton } from "@/components/ConfirmButton";
import { api, describeError } from "@/lib/api";
import {
  pauseLine,
  pausePrompt,
  pauseSentence,
  resumeSentence,
  trayChannelLine,
  type NodePause,
  type PauseResult,
} from "@/lib/modelPause";
import { useNodeLabels } from "@/lib/nodeLabels";

/**
 * Pause and Resume for one machine's models, on its card (row 35).
 *
 * The same action as the tray icon's, on every OS: it goes to that
 * machine's agent through the console's proxy, with this session. Shown
 * only where the machine reports `pause`; an older agent cannot pause, and
 * offering a button that would 404 is worse than offering none.
 */
export function ModelPause({
  name,
  target,
  pause,
  onChanged,
}: {
  name: string;
  /** The proxy target that reaches this machine's agent. */
  target: string;
  pause: NodePause | null | undefined;
  onChanged: () => void | Promise<void>;
}) {
  const shown = useNodeLabels()(name) ?? name;
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; ok: boolean } | null>(null);
  if (!pause) return null;
  const line = pauseLine(pause);
  const channel = trayChannelLine(pause);

  async function act(path: "/v1/node/pause" | "/v1/node/resume") {
    setBusy(true);
    setSaid(null);
    try {
      const result = await api.post<PauseResult>(target, path, {});
      const results = result.results ?? [];
      if (path === "/v1/node/resume") {
        setSaid({ text: resumeSentence(results), ok: results.every((r) => r.state === "started") });
      } else {
        setSaid({
          text: pauseSentence(results),
          ok: results.every((r) => r.state !== "failed"),
        });
      }
      await onChanged();
    } catch (e) {
      setSaid({ text: describeError(e), ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1 max-w-md text-sm" data-testid={`model-pause-${name}`}>
      {line ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-status-warn" data-testid="model-pause-line">
            {line}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act("/v1/node/resume")}
            className="rounded border border-[color:var(--border)] px-2 py-0.5 text-sm"
            aria-label={`Resume models on ${shown}`}
            data-testid="model-resume"
          >
            {busy ? "Resuming…" : "Resume"}
          </button>
        </div>
      ) : (
        <ConfirmButton
          label={busy ? "Pausing…" : "Pause models"}
          confirmLabel="Pause models"
          ariaLabel={`Pause models on ${shown}`}
          prompt={<span data-testid="model-pause-prompt">{pausePrompt(shown)}</span>}
          onConfirm={() => act("/v1/node/pause")}
          disabled={busy}
          className="text-[0.6875rem] text-[color:var(--muted)] underline"
          testId="model-pause"
        />
      )}
      {channel && (
        <p className="text-[color:var(--muted)]" data-testid="model-pause-channel">
          {channel}
        </p>
      )}
      {said && (
        <p
          role={said.ok ? "status" : "alert"}
          className={said.ok ? "text-[color:var(--muted)]" : "text-status-error"}
          data-testid="model-pause-said"
        >
          {said.text}
        </p>
      )}
    </div>
  );
}
