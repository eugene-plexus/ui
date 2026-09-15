"use client";

/**
 * Wizard screen 1: the passphrase, and whether Eugene starts on its own
 * after a reboot.
 *
 * One screen per module since M9. A screen renders the draft and reports
 * edits upwards; the write happens in `page.tsx`, when the footer's button
 * is pressed. Since S2 that press is this screen's Continue, which
 * initializes the install and enrolls this machine — so the sentence at
 * the top does the Welcome screen's old job in one line, because the next
 * click is the one that commits.
 *
 * S0 of the hobbyist UX plan (2026-09-15) replaced two radio buttons and
 * two paragraphs with one checkbox and one line. The old copy described
 * the keyring option as "best for AI hobbyists" and defaulted to the
 * other one; now the default follows what the agent measured about this
 * host (`keyringAvailable`), and where there is no keyring the screen
 * says what will happen instead of offering a choice that cannot work.
 */

import type { SecurityMode } from "../draft";
import { Checkbox, Field, SecretInput } from "../fields";

export function ScreenPassphrase({
  passphrase,
  passphraseConfirm,
  securityMode,
  keyringAvailable,
  onPassphrase,
  onPassphraseConfirm,
  onSecurityMode,
}: {
  passphrase: string;
  passphraseConfirm: string;
  securityMode: SecurityMode;
  /** What the agent measured about this host's OS keyring; `null` while
   * unknown (still loading, or an agent that predates the field). */
  keyringAvailable: boolean | null;
  onPassphrase: (v: string) => void;
  onPassphraseConfirm: (v: string) => void;
  onSecurityMode: (v: SecurityMode) => void;
}) {
  const mismatch = passphraseConfirm.length > 0 && passphrase !== passphraseConfirm;
  const noKeyring = keyringAvailable === false;
  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Choose a passphrase</h2>
      <p className="mb-6 text-sm leading-relaxed text-[color:var(--muted)]">
        It protects the keys and settings Eugene stores on this machine. You will also use it to
        sign in. Pick something you can remember: Eugene cannot reset it.
      </p>
      <Field
        label="Passphrase"
        description="Anything non-empty works; a longer phrase is stronger."
      >
        <SecretInput
          value={passphrase}
          onChange={onPassphrase}
          placeholder="A line of poetry, a sentence, a long phrase…"
        />
      </Field>
      <Field label="Confirm passphrase" description="Same again, to guard against typos.">
        <SecretInput
          value={passphraseConfirm}
          onChange={onPassphraseConfirm}
          placeholder="(repeat the passphrase)"
        />
      </Field>
      {mismatch && (
        <p className="text-status-error -mt-2 mb-4 text-xs">Passphrases don&rsquo;t match yet.</p>
      )}
      <hr className="my-6 border-[color:var(--border)]" />
      <h3 className="font-ui mb-3 text-sm font-semibold">After a reboot</h3>
      {noKeyring ? (
        <p
          className="mb-4 text-xs leading-relaxed text-[color:var(--muted)]"
          data-testid="no-keyring-note"
        >
          This machine has no password manager Eugene can use, so Eugene will ask for the passphrase
          after every restart before it can open its stored secrets. A server or a container can
          read the passphrase from a file instead: Config &rarr; Control root &rarr; Security, once
          setup is done.
        </p>
      ) : null}
      <Checkbox
        checked={!noKeyring && securityMode === "os_keyring"}
        disabled={noKeyring}
        onChange={(checked) => onSecurityMode(checked ? "os_keyring" : "prompt_on_startup")}
        label="Start Eugene on its own after a reboot"
        description={
          "Eugene keeps its key in your OS's password manager (Windows Credential Manager, " +
          "macOS Keychain or Linux Secret Service) so it comes back working without you. " +
          "Untick to be asked for the passphrase every time it starts. Anyone who can sign " +
          "in to this user account could otherwise start Eugene. You can change this later " +
          "under Config."
        }
      />
    </section>
  );
}
