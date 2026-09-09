/**
 * Agent-specific helpers.
 *
 * The wire shapes that used to be hand-typed here are generated now —
 * `openapi/agent.yaml` joined `scripts/codegen.mjs` with the runtime
 * dashboard, which is what the old TODO in this file asked for. Import
 * `Component`, `ComponentList`, `Runtime`, `EngineDescriptor` and the
 * rest from `@/lib/types`.
 *
 * What is left is the one thing codegen cannot give us: a provider list
 * the wizard can render before any driver process exists to ask.
 */

export interface AgentConfigDocument extends Record<string, unknown> {
  firstRunComplete?: boolean;
  uiTheme?: "light" | "dark" | "auto";
  uiFontSize?: "small" | "medium" | "large";
}

/**
 * Hardcoded provider catalog mirroring
 * `inference-driver/src/eugene_plexus_inference_driver/providers.py`.
 *
 * The first-run wizard duplicates the keys / labels here so the provider
 * dropdown can render before any driver process exists. The full
 * provider schema (extra fields, default base URLs) stays server-side —
 * the wizard only needs key + label + which credential field to ask
 * for. Operators who want anything fancier go through the post-setup
 * Config tab against the live driver's schema.
 *
 * Keep these keys in lockstep with the driver registry — a mismatch
 * means the wizard writes a `provider:` value the driver rejects on
 * load. If this list grows past ~12 entries or we add provider-specific
 * extra fields, move to fetching the schema from a wizard-spawned
 * driver instead.
 */
export type WizardCredential = "claude_cli" | "codex_cli" | "api_key" | "base_url" | "none";

export interface WizardProvider {
  key: string;
  label: string;
  /**
   * Which credential input(s) to render on the driver screen. `api_key`
   * + `base_url` can combine (e.g. custom OpenAI-compat); most providers
   * pick exactly one.
   */
  credentials: WizardCredential[];
}

export const WIZARD_PROVIDERS: WizardProvider[] = [
  // A local engine runtime the agent supervises is reached the same
  // way as any other OpenAI-compatible endpoint — the driver points its
  // `baseUrl` at the runtime's `url`. That is the whole integration:
  // fronting a runtime is configuration, not a distinct provider kind.
  {
    key: "openai_compat_custom",
    label: "Local engine runtime, or any OpenAI-compatible URL",
    credentials: ["base_url", "api_key"],
  },
  {
    key: "claude_subscription",
    label: "Claude (Pro/Max subscription via Claude Code CLI)",
    credentials: ["claude_cli"],
  },
  {
    key: "chatgpt_subscription",
    label: "ChatGPT (subscription via Codex CLI)",
    credentials: ["codex_cli"],
  },
  { key: "openai", label: "OpenAI API", credentials: ["api_key"] },
  { key: "xai", label: "xAI (Grok)", credentials: ["api_key"] },
  { key: "openrouter", label: "OpenRouter", credentials: ["api_key"] },
  { key: "minimax", label: "MiniMax", credentials: ["api_key"] },
  { key: "ollama_local", label: "Local — Ollama", credentials: ["none"] },
  { key: "lmstudio_local", label: "Local — LM Studio", credentials: ["none"] },
];

export function providerLabel(key: string): string {
  return WIZARD_PROVIDERS.find((p) => p.key === key)?.label ?? key;
}
