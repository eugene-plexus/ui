/**
 * The wizard's draft: its shape, its defaults, and what makes a screen
 * finished.
 *
 * Extracted at M9. It was inside a 1548-line `page.tsx` with eight
 * screens (now five), the backend-creation logic, port allocation, topology
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

/**
 * Five screens since 2026-09-11, down from eight.
 *
 * The three that went were not merely low-value, they were **inert**:
 * `deployment` and `gatewayHost`/`gatewayPort` were collected, shown back
 * on the summary as if they were configuration, and then never sent
 * anywhere by Start. An operator who set the gateway to `0.0.0.0:9000`
 * got an install listening on `127.0.0.1:8080` and a Ready screen that
 * said otherwise. Look & feel wrote only `localStorage` and is on
 * `/config` already (`UIPreferences`), which is where the summary always
 * said to change it.
 *
 * What is left is what cannot be defaulted or derived: who you are
 * (passphrase), where your model files are, and optionally one backend
 * the agent does not supervise.
 */
export const TOTAL_SCREENS = 5;

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
  modelRoots: string[];
  backend: BackendDraft;
  securityMode: SecurityMode;
}

export function blankDraft(): WizardDraft {
  return {
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
  // Screen 3 is model directories, and none is a valid answer: directories
  // can be added later from Config, and Discover downloads into one. Nothing
  // on this screen should be able to block a first run.
  //
  // Screen 4 is an external backend, and "none" is a valid answer too — but a
  // chosen one has to carry the credentials its provider needs. The model id
  // is deliberately NOT required here: a driver has to exist before it can be
  // asked what it serves, and it cannot exist before Start, so the last screen
  // asks from a real list.
  if (screen === 4 && draft.backend.provider) {
    const b = draft.backend;
    const credentials = WIZARD_PROVIDERS.find((p) => p.key === b.provider)?.credentials ?? [];
    if (credentials.includes("api_key") && !b.apiKey.trim()) return false;
    if (credentials.includes("base_url") && !b.baseUrl.trim()) return false;
  }
  return true;
}
