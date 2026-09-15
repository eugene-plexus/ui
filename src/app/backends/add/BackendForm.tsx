"use client";

/**
 * Which app, and what it needs from you.
 *
 * The wizard's Backend screen until S2 of the hobbyist UX plan, when the
 * question left first-run setup: an app the person already runs is a task
 * for after the install exists, not a step before it, and the design's
 * §0.4 counted it among the questions a new user cannot answer on day one.
 * The form is the same; the heading and the words around it are the
 * page's, which is why this renders only the fields.
 *
 * An external backend is something already serving that Eugene does not
 * start - Ollama, LM Studio, a Claude or ChatGPT subscription, any
 * OpenAI-compatible URL. Engines Eugene starts get a driver automatically;
 * these do not, so the page that owns this form CREATES one.
 */

import { WIZARD_PROVIDERS, type WizardCredential } from "@/lib/agent";
import type { BackendDraft } from "@/app/setup/draft";

export function BackendForm({
  backend,
  disabled = false,
  onChange,
}: {
  backend: BackendDraft;
  /** While the app is being added: the choice is made and must not change
   * under the calls that act on it. */
  disabled?: boolean;
  onChange: (patch: Partial<BackendDraft>) => void;
}) {
  const credentials: WizardCredential[] =
    WIZARD_PROVIDERS.find((p) => p.key === backend.provider)?.credentials ?? [];

  return (
    <>
      <Field
        label="Which app?"
        description="Pick the one that is already running or already paid for."
      >
        <select
          value={backend.provider}
          disabled={disabled}
          onChange={(e) => onChange({ provider: e.target.value })}
          aria-label="Which app"
          className={input}
        >
          <option value="">Choose one…</option>
          {WIZARD_PROVIDERS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      {backend.provider !== "" && (
        <>
          <CredentialFields
            credentials={credentials}
            backend={backend}
            disabled={disabled}
            onChange={onChange}
          />
          <p className="text-xs leading-relaxed text-[color:var(--muted)]">
            You will pick the model next, from the list this app reports.
          </p>
        </>
      )}
    </>
  );
}

export function CredentialFields({
  credentials,
  backend,
  disabled = false,
  onChange,
}: {
  credentials: WizardCredential[];
  backend: BackendDraft;
  disabled?: boolean;
  onChange: (patch: Partial<BackendDraft>) => void;
}) {
  return (
    <>
      {credentials.includes("api_key") && (
        <Field label="API key" description="The key this provider gave you.">
          <SecretInput
            value={backend.apiKey}
            disabled={disabled}
            onChange={(v) => onChange({ apiKey: v })}
            placeholder="sk-…"
          />
        </Field>
      )}
      {credentials.includes("base_url") && (
        <Field
          label="Address"
          description="Where your OpenAI-compatible server answers. Eugene adds /v1/chat/completions itself."
        >
          <input
            type="url"
            value={backend.baseUrl}
            disabled={disabled}
            onChange={(e) => onChange({ baseUrl: e.target.value })}
            placeholder="https://my-server.example.com"
            className={input}
          />
        </Field>
      )}
      {credentials.includes("claude_cli") && (
        <Field
          label="Claude Code CLI path"
          description="Path to the `claude` program. Leave as “claude” if it is on PATH."
        >
          <input
            type="text"
            value={backend.claudeCodeCliPath}
            disabled={disabled}
            onChange={(e) => onChange({ claudeCodeCliPath: e.target.value })}
            className={input}
          />
        </Field>
      )}
      {credentials.includes("codex_cli") && (
        <Field
          label="Codex CLI path"
          description="Path to the `codex` program. Leave as “codex” if it is on PATH."
        >
          <input
            type="text"
            value={backend.codexCliPath}
            disabled={disabled}
            onChange={(e) => onChange({ codexCliPath: e.target.value })}
            className={input}
          />
        </Field>
      )}
      {credentials.includes("none") && (
        <p className="-mt-2 mb-4 text-xs text-[color:var(--muted)]">
          Nothing to enter: this app runs on this machine and needs no key.
        </p>
      )}
    </>
  );
}

/** The wizard's leaf inputs, restated here so this page does not reach
 * into `setup/fields.tsx` for two components and inherit its future. */
function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <label className="font-ui block text-sm font-medium">{label}</label>
      {description && (
        <p className="mt-1 mb-2 text-xs leading-relaxed text-[color:var(--muted)]">{description}</p>
      )}
      {children}
    </div>
  );
}

function SecretInput({
  value,
  disabled,
  onChange,
  placeholder,
}: {
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="password"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      className={input}
    />
  );
}

const input =
  "font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)] disabled:opacity-60";
