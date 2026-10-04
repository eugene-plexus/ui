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
 * Nothing here imports React. `canContinue` and `chosenFolders` are the
 * rules a footer button asks about, and they are pure functions of the
 * draft, which is the property that makes them checkable one screen at a
 * time.
 */

import type { Component } from "@/lib/types";

export const DRAFT_KEY = "eugene-wizard-draft";

/**
 * Two screens since S2 of the hobbyist UX plan (2026-09-15), down from
 * five, down from eight.
 *
 * The five-screen wizard asked four questions of a person who had just
 * installed the thing: a passphrase, where their model files already
 * were, which external backend to add, and then showed a summary before
 * one Start wrote everything. The design's §0.4 measured the second as
 * the one question a new user cannot answer (they have no files) and the
 * third as a task, not a setup step. What is left:
 *
 *   1. Choose a passphrase   - and whether Eugene starts on its own after
 *                              a reboot. Continue COMMITS: the install is
 *                              initialized and this machine enrolled.
 *   2. Where should models    - a folder Eugene proposes to make, or the
 *      live?                    folders the person already has.
 *
 * The Backend screen became `/backends/add`, reachable from Home and
 * Inference once the install exists.
 */
export const TOTAL_SCREENS = 2;

/**
 * `passphrase_file` is never a choice on screen: the agent reports it
 * (`passphraseFile`) when it runs under its own account on the Linux system
 * install, and the wizard follows. So a restored draft never carries it -
 * `restoreDraft` accepts only the two a person can pick.
 */
export type SecurityMode = "prompt_on_startup" | "os_keyring" | "passphrase_file";

/**
 * What `GET /v1/auth/status` answers before the wizard has a token. The two
 * optional fields arrived with S0 of the hobbyist UX plan; an agent that
 * predates them leaves both absent, and the wizard then keeps the
 * passphrase prompt rather than guessing.
 */
export interface AuthStatusView {
  initialized: boolean;
  unlocked?: boolean | null;
  keyringAvailable?: boolean | null;
  /** True when the agent unlocks itself from a passphrase file only its own
   * account can read (2026-09-24). Absent from an older agent. */
  passphraseFile?: boolean | null;
}

export interface InitializeResponse {
  sessionToken: string;
  expiresAt: string;
  operatorName?: string | null;
}

/** An external backend the agent does NOT supervise: Ollama, LM Studio, a
 * cloud subscription, any OpenAI-compatible URL. Unlike an engine runtime,
 * nothing declares a driver for one automatically - there is no runtime for
 * it to be the companion of. `provider: ""` means "none chosen yet".
 *
 * No longer part of the wizard's draft: the form that fills one lives at
 * `/backends/add` since S2. The type stays here beside the helpers in
 * `start.ts` that turn it into a driver. */
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

/** Screen 2's two radio buttons. */
export type FolderChoice = "make" | "own";

export interface WizardDraft {
  securityMode: SecurityMode;
  folderChoice: FolderChoice;
  /**
   * The proposed folder after the person pressed "change" and edited it;
   * `null` means "use the proposal as the library's home implies it".
   * Kept separately from the proposal so a tab refresh keeps the edit and
   * a re-fetched proposal does not overwrite it.
   */
  customFolder: string | null;
  /** The folders under "I already have models", one per row. */
  modelRoots: string[];
}

export function blankDraft(): WizardDraft {
  return {
    securityMode: "prompt_on_startup",
    folderChoice: "make",
    customFolder: null,
    modelRoots: [],
  };
}

/**
 * A saved draft, read back by its known keys only.
 *
 * Drafts from earlier wizards carry a `backend` object (or a `drivers`
 * tuple, older still) and a `screen`; merging one wholesale produced a
 * half-shaped draft that rendered undefined fields. `modelRoots` being a
 * list is the shape check - every draft since 2026-09-11 has it - and
 * everything else is taken field by field with the blank as the fallback.
 * The screen is NOT restored from here since S2: which screen a visit
 * opens on is decided by whether the install is initialized (§10 trap 8),
 * not by where a tab was closed.
 */
export function restoreDraft(raw: unknown): WizardDraft | null {
  if (typeof raw !== "object" || raw === null) return null;
  const saved = raw as Record<string, unknown>;
  if (!Array.isArray(saved.modelRoots)) return null;
  const blank = blankDraft();
  return {
    securityMode:
      saved.securityMode === "os_keyring" || saved.securityMode === "prompt_on_startup"
        ? saved.securityMode
        : blank.securityMode,
    folderChoice: saved.folderChoice === "own" ? "own" : "make",
    customFolder: typeof saved.customFolder === "string" ? saved.customFolder : null,
    modelRoots: saved.modelRoots.filter((r): r is string => typeof r === "string"),
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

/**
 * The folders Finish will write, from the choice and the proposal.
 *
 * "Make a folder for me" is one folder: the person's edit if they made
 * one, else the proposal; nothing when neither exists (the library could
 * not be asked for its home). "I already have models" is every non-blank
 * row. Trimmed, because a trailing space in a path is a folder the
 * library will report missing and nobody will see why.
 */
export function chosenFolders(draft: WizardDraft, proposedFolder: string | null): string[] {
  if (draft.folderChoice === "make") {
    const folder = (draft.customFolder ?? proposedFolder ?? "").trim();
    return folder ? [folder] : [];
  }
  return draft.modelRoots.map((r) => r.trim()).filter(Boolean);
}

/**
 * The shortest passphrase a new install takes.
 *
 * The same number the agent and the control root enforce at
 * `POST /v1/auth/initialize`, which refuse anything shorter. It guards
 * everything the install seals (provider keys, the install's signing
 * key) against an offline guess, and a passphrase is typed rarely enough
 * that a longer one costs little. Checked here as well so the refusal is
 * a sentence on this screen, before Continue, rather than an error after
 * it. **Not applied at sign-in:** installs made before the minimum may
 * hold a shorter passphrase, and must still be able to open.
 */
export const MIN_PASSPHRASE_LENGTH = 12;

/**
 * A passphrase's length in characters as a person counts them.
 *
 * Code points, not `.length`: an emoji is one character to the person
 * typing it and to the agent (Python's `len` counts code points), but two
 * UTF-16 units to JavaScript, so `.length` would let Continue through for
 * a passphrase the server then refuses.
 */
export function passphraseLength(passphrase: string): number {
  return Array.from(passphrase).length;
}

export function canContinue(
  screen: number,
  draft: WizardDraft,
  passphrase: string,
  passphraseConfirm: string,
  proposedFolder: string | null = null,
): boolean {
  // Screen 1 is the passphrase: long enough, AND the confirmation
  // matches. Initialize refuses a short one too; this only moves the
  // refusal to before the click.
  if (screen === 1) {
    return (
      passphraseLength(passphrase) >= MIN_PASSPHRASE_LENGTH && passphrase === passphraseConfirm
    );
  }
  // Screen 2 needs one folder. The old Models screen let none through
  // because "directories can be added later from Config"; the design's
  // trap 8 is what that produced — an initialized install with no models
  // folder, and a Discover that had nowhere to download to.
  return chosenFolders(draft, proposedFolder).length > 0;
}
