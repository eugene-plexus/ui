"use client";

/**
 * Ask for a spoken reply (P2b): `modalities: ["text", "audio"]` with a
 * voice. The playground streams, and a streamed spoken reply is `pcm16`
 * only, so that is what is asked; the reply's player puts a WAV header
 * in front of it.
 *
 * Only an explicit `audio_output: false` warns, as the image note does:
 * an absent flag is a gateway with no opinion. The request is sent
 * anyway, because the gateway's refusal is the diagnostic.
 */

const panelClass =
  "flex w-full flex-col gap-2 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] p-3 text-sm";

export function SpokenReplyPanel({
  enabled,
  onEnabled,
  voice,
  onVoice,
  modelAudioOutput,
}: {
  enabled: boolean;
  onEnabled: (on: boolean) => void;
  voice: string;
  onVoice: (voice: string) => void;
  modelAudioOutput: boolean | undefined;
}) {
  return (
    <section data-testid="spoken-panel" className={panelClass}>
      <h3 className="font-ui text-sm font-medium">Spoken reply</h3>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          data-testid="spoken-toggle"
          checked={enabled}
          onChange={(e) => onEnabled(e.target.checked)}
        />
        Answer out loud, as well as in text
      </label>
      <label className="flex items-center gap-2">
        <span className="text-[color:var(--muted)]">Voice</span>
        <input
          data-testid="spoken-voice"
          value={voice}
          onChange={(e) => onVoice(e.target.value)}
          placeholder="alloy"
          disabled={!enabled}
          className="rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 font-mono text-sm disabled:opacity-50"
          title="The provider's own voice name, passed through as written"
        />
      </label>
      {enabled && modelAudioOutput === false && (
        <p
          data-testid="spoken-model-note"
          className="status-warn rounded-[var(--radius)] px-2 py-1"
        >
          The selected model cannot answer out loud. The gateway will refuse the request rather than
          answer in text only.
        </p>
      )}
    </section>
  );
}
