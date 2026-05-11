/**
 * Type definitions and helpers for the watchdog API.
 *
 * Hand-typed in v0.1 — no codegen for the watchdog spec yet. The shapes
 * mirror `specs/openapi/watchdog.yaml` and the common-component config
 * schema. Drop these for generated types when watchdog gets added to
 * `scripts/codegen`.
 */

export type ComponentKind = "orchestrator" | "hemisphere-driver" | "memory";

export type ComponentStatus =
  | "starting"
  | "running"
  | "safe_mode"
  | "exited"
  | "crashed"
  | "unreachable";

export interface SpawnConfig {
  configFile: string;
  env?: Record<string, string>;
}

export interface ComponentEntry {
  name: string;
  kind: ComponentKind;
  url: string;
  spawn?: SpawnConfig;
  safeMode?: boolean;
}

export interface Component extends ComponentEntry {
  status: ComponentStatus;
  pid?: number;
  lastRestart?: string;
  lastError?: string;
}

export interface ComponentList {
  components: Component[];
}

export interface WatchdogConfigDocument extends Record<string, unknown> {
  firstRunComplete?: boolean;
  uiTheme?: "light" | "dark" | "auto";
  uiFontSize?: "small" | "medium" | "large";
}

/**
 * Hardcoded provider catalog mirroring
 * `hemisphere-driver/src/eugene_plexus_hemisphere_driver/providers.py`.
 *
 * v0.1 wizard duplicates the keys / labels here so the provider dropdown
 * can render before any driver process exists. The full provider schema
 * (extra fields, deny patterns, default base URLs) stays server-side —
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
  {
    key: "openai_compat_custom",
    label: "Custom OpenAI-compatible URL",
    credentials: ["base_url", "api_key"],
  },
];

export function providerLabel(key: string): string {
  return WIZARD_PROVIDERS.find((p) => p.key === key)?.label ?? key;
}
