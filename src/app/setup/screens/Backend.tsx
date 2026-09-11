"use client";

/**
 * Wizard screen: One external backend the agent does not supervise.
 *
 * One screen per module since M9. Nothing here reads or writes the
 * install - a screen renders the draft and reports edits upwards, and
 * every write happens once, in `page.tsx`, when Start is pressed.
 */

import { WIZARD_PROVIDERS, type WizardCredential } from "@/lib/agent";

import type { BackendDraft } from "../draft";
import { Field, SecretInput } from "../fields";

/**
 * An external backend: something already serving that the agent does not
 * supervise - Ollama, LM Studio, a Claude or ChatGPT subscription, any
 * OpenAI-compatible URL.
 *
 * This screen was briefly removed on the reasoning that the agent declares a
 * companion inference-driver per runtime, so there was nothing to configure.
 * That is true of engines the agent *starts*. It is false of everything here:
 * an already-running Ollama has no runtime, so it never gets a companion, and
 * without this screen there was no way to reach one from setup at all.
 *
 * The version before that could only PATCH a driver that already existed, and
 * on a fresh install none did - so it warned and did nothing. This one
 * creates the component.
 */
export function ScreenBackend({
  backend,
  onChange,
}: {
  backend: BackendDraft;
  onChange: (patch: Partial<BackendDraft>) => void;
}) {
  const credentials: WizardCredential[] =
    WIZARD_PROVIDERS.find((p) => p.key === backend.provider)?.credentials ?? [];

  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Add a backend</h2>
      <p className="mb-4 text-sm leading-relaxed text-[color:var(--muted)]">
        Something already running that this install should be able to route to. Models you launch
        here get their own driver automatically &mdash; this is for everything else.
      </p>
      <Field label="Backend" description="Skip if you only plan to run models from your own files.">
        <select
          value={backend.provider}
          onChange={(e) => onChange({ provider: e.target.value })}
          className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
        >
          <option value="">None for now</option>
          {WIZARD_PROVIDERS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      {backend.provider === "" ? (
        <p className="text-xs leading-relaxed text-[color:var(--muted)]">
          You can add backends later from Config. Nothing here is permanent.
        </p>
      ) : (
        <>
          <CredentialFields credentials={credentials} backend={backend} onChange={onChange} />
          <p className="text-xs leading-relaxed text-[color:var(--muted)]">
            You will pick the model on the next screen, from the list this backend reports.
          </p>
        </>
      )}
    </section>
  );
}

export function CredentialFields({
  credentials,
  backend,
  onChange,
}: {
  credentials: WizardCredential[];
  backend: BackendDraft;
  onChange: (patch: Partial<BackendDraft>) => void;
}) {
  return (
    <>
      {credentials.includes("api_key") && (
        <Field
          label="API key"
          description="The provider-issued key the driver uses to authenticate."
        >
          <SecretInput
            value={backend.apiKey}
            onChange={(v) => onChange({ apiKey: v })}
            placeholder="sk-…"
          />
        </Field>
      )}
      {credentials.includes("base_url") && (
        <Field
          label="Base URL"
          description="HTTP base of your OpenAI-compatible endpoint. The driver appends /v1/chat/completions automatically."
        >
          <input
            type="url"
            value={backend.baseUrl}
            onChange={(e) => onChange({ baseUrl: e.target.value })}
            placeholder="https://my-server.example.com"
            className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
          />
        </Field>
      )}
      {credentials.includes("claude_cli") && (
        <Field
          label="Claude Code CLI path"
          description="Path to the `claude` binary. Leave as “claude” if it's on PATH."
        >
          <input
            type="text"
            value={backend.claudeCodeCliPath}
            onChange={(e) => onChange({ claudeCodeCliPath: e.target.value })}
            className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
          />
        </Field>
      )}
      {credentials.includes("codex_cli") && (
        <Field
          label="Codex CLI path"
          description="Path to the `codex` binary. Leave as “codex” if it's on PATH."
        >
          <input
            type="text"
            value={backend.codexCliPath}
            onChange={(e) => onChange({ codexCliPath: e.target.value })}
            className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
          />
        </Field>
      )}
      {credentials.includes("none") && (
        <p className="-mt-2 mb-4 text-xs text-[color:var(--muted)]">
          No credentials needed — the driver talks to a local service.
        </p>
      )}
    </>
  );
}
