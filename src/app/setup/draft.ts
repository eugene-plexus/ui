/**
 * The wizard's draft: its shape, its defaults, and what makes a screen
 * finished.
 *
 * Extracted at M9. It was inside a 1548-line `page.tsx` with eight
 * screens, the backend-creation logic, port allocation, topology
 * validation and seven leaf inputs, which is why nothing in it could be
 * tested without mounting the whole wizard - and why its test was 258
 * lines asserting a call sequence.
 *
 * Nothing here imports React. `canContinue` is the rule a footer button
 * asks about, and it is a pure function of the draft, which is the
 * property that makes it checkable one screen at a time.
 */

import { WIZARD_PROVIDERS } from "@/lib/agent";
import type { Component } from "@/lib/types";

export const DRAFT_KEY = "eugene-wizard-draft";
export const TOTAL_SCREENS = 8;

export type DeploymentMode = "local" | "networked";
export type SecurityMode = "prompt_on_startup" | "os_keyring";

export interface InitializeResponse {
  sessionToken: string;
  expiresAt: string;
  operatorName?: string | null;
}

/** An external backend the agent does NOT supervise: Ollama, LM Studio, a
 * cloud subscription, any OpenAI-compatible URL. Unlike an engine runtime,
 * nothing declares a driver for one automatically - there is no runtime for
 * it to be the companion of. `provider: ""` means "none, ask me later". */
export interface BackendDraft {
  provider: string;
  apiKey: string;
  baseUrl: string;
  claudeCodeCliPath: string;
  codexCliPath: string;
  modelId: string;
}

export function blankBackend(): BackendDraft {
  return {
    provider: "",
    apiKey: "",
    baseUrl: "",
    claudeCodeCliPath: "claude",
    codexCliPath: "codex",
    modelId: "",
  };
}

export interface WizardDraft {
  deployment: DeploymentMode;
  gatewayHost: string;
  gatewayPort: number;
  modelRoots: string[];
  backend: BackendDraft;
  securityMode: SecurityMode;
}

export function blankDraft(): WizardDraft {
  return {
    deployment: "local",
    gatewayHost: "127.0.0.1",
    gatewayPort: 8080,
    modelRoots: [],
    backend: blankBackend(),
    securityMode: "prompt_on_startup",
  };
}

export const REQUIRED_KINDS = ["control", "gateway", "library"] as const;

/**
 * Which of the components every install must have are absent.
 *
 * Only meaningful against a list that was actually read. An unauthenticated
 * `GET /v1/components` 401s on an install with no passphrase yet, and
 * treating that empty result as an answer told an operator with a perfectly
 * good three-component install that all three were missing.
 */
export function requiredKindsMissing(components: Component[]): string[] {
  return REQUIRED_KINDS.filter((kind) => !components.some((c) => c.kind === kind));
}

export function canContinue(
  screen: number,
  draft: WizardDraft,
  passphrase: string,
  passphraseConfirm: string,
): boolean {
  // Screen 2 is Security — passphrase non-empty AND confirmation
  // matches. Length validation lives server-side (Argon2 will accept
  // anything non-empty); we only block the obvious typo.
  if (screen === 2) {
    return passphrase.length > 0 && passphrase === passphraseConfirm;
  }
  // Screen 6 is model directories, and none is a valid answer: directories
  // can be added later from Config, and Discover downloads into one. Nothing
  // on this screen should be able to block a first run.
  //
  // Screen 7 is an external backend, and "none" is also a valid answer - but
  // a chosen one has to be complete. A driver with no model id advertises no
  // model, so the gateway lists nothing and the backend is silently inert:
  // exactly the shape of failure this wizard keeps being fixed for.
  // Screen 7 is an external backend, and "none" is a valid answer. The model
  // is deliberately NOT asked here: a driver has to exist before it can list
  // what it serves, and it cannot exist before Start. The last screen asks,
  // from a real list.
  if (screen === 7 && draft.backend.provider) {
    const b = draft.backend;
    const credentials = WIZARD_PROVIDERS.find((p) => p.key === b.provider)?.credentials ?? [];
    if (credentials.includes("api_key") && !b.apiKey.trim()) return false;
    if (credentials.includes("base_url") && !b.baseUrl.trim()) return false;
  }
  return true;
}
