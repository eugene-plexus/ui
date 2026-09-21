"use client";

import type { SamplingDraft } from "@/lib/sampling";

/**
 * The request's own knobs: a system prompt and the sampling fields the
 * contract carries (`temperature`, `max_tokens`, `top_p`, `seed`,
 * `stop`).
 *
 * Every field is empty by default and an empty field is NOT SENT: the
 * model's settings profile and the gateway's defaults decide, which is
 * the standing rule (the gateway owns every output-affecting
 * parameter). The panel exists because a harness sets these and the
 * playground could not -- `top_p` and `seed` were carried by the
 * contract since 2026-09-19 with no way to send them from here.
 */
export function SamplingPanel({
  draft,
  onDraft,
  error,
}: {
  draft: SamplingDraft;
  onDraft: (draft: SamplingDraft) => void;
  /** Why the draft cannot be sent, or null. Parsed by the page so the
   * send path and this panel cannot disagree about validity. */
  error: string | null;
}) {
  const set = (key: keyof SamplingDraft) => (value: string) => onDraft({ ...draft, [key]: value });

  return (
    <section
      className="flex min-w-0 flex-1 flex-col gap-2 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel)] p-3"
      aria-label="Request settings"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-ui text-xs font-semibold">Request settings</h2>
        <p className="font-ui text-[0.6875rem] text-[color:var(--muted)]">
          Empty fields are not sent; the model&apos;s own settings decide.
        </p>
      </header>

      <label className="font-ui flex flex-col gap-1 text-[0.6875rem] text-[color:var(--muted)]">
        <span>System prompt — sent ahead of the conversation, kept out of the transcript</span>
        <textarea
          data-testid="system-prompt"
          value={draft.system}
          onChange={(e) => set("system")(e.target.value)}
          rows={2}
          spellCheck={false}
          placeholder="You are a helpful assistant…"
          className="w-full resize-y rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 font-mono text-xs text-[color:var(--foreground)] outline-none hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)]"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <NumberField
          label="temperature"
          testId="sampling-temperature"
          value={draft.temperature}
          onChange={set("temperature")}
          placeholder="0.7"
          title="Sampling temperature, sent as temperature. 0 is a real value and is sent as 0."
        />
        <NumberField
          label="max_tokens"
          testId="sampling-max-tokens"
          value={draft.maxTokens}
          onChange={set("maxTokens")}
          placeholder="1024"
          title="Generation limit, sent as max_tokens. A reply that hits it finishes with length and the bar above says so."
        />
        <NumberField
          label="top_p"
          testId="sampling-top-p"
          value={draft.topP}
          onChange={set("topP")}
          placeholder="0.9"
          title="Nucleus sampling cutoff, sent as top_p. Backends that cannot carry it say which field was dropped, once."
        />
        <NumberField
          label="seed"
          testId="sampling-seed"
          value={draft.seed}
          onChange={set("seed")}
          placeholder="42"
          title="Deterministic sampling where the backend supports it, sent as seed. 0 is a real seed and is sent as 0."
        />
      </div>

      <label className="font-ui flex flex-col gap-1 text-[0.6875rem] text-[color:var(--muted)]">
        <span>Stop sequences — one per line, up to 4; generation ends when one appears</span>
        <textarea
          data-testid="sampling-stop"
          value={draft.stop}
          onChange={(e) => set("stop")(e.target.value)}
          rows={2}
          spellCheck={false}
          className="w-full resize-y rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 font-mono text-xs text-[color:var(--foreground)] outline-none hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)]"
        />
      </label>

      {error && (
        <p className="status-error rounded-[var(--radius)] px-2 py-1 text-[0.6875rem]">{error}</p>
      )}
    </section>
  );
}

function NumberField({
  label,
  testId,
  value,
  onChange,
  placeholder,
  title,
}: {
  label: string;
  testId: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  title: string;
}) {
  return (
    <label
      className="font-ui flex min-w-0 flex-col gap-1 text-[0.6875rem] text-[color:var(--muted)]"
      title={title}
    >
      <span className="font-mono">{label}</span>
      <input
        data-testid={testId}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="w-24 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-2 py-1 font-mono text-xs text-[color:var(--foreground)] outline-none hover:border-[color:var(--border-hover)] focus:border-[color:var(--accent-left)]"
      />
    </label>
  );
}
