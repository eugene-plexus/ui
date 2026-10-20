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

import { MIN_PASSPHRASE_LENGTH, type SecurityMode, passphraseLength } from "../draft";
import { Checkbox, Field, FieldInput, SecretInput } from "../fields";

export function ScreenPassphrase({
  passphrase,
  passphraseConfirm,
  securityMode,
  keyringAvailable,
  passphraseFile = false,
  machineName = "",
  onMachineName = () => {},
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
  /** The agent runs under its own account and unlocks itself from a file
   * only that account can read (the Linux system install, 2026-09-24).
   * Then there is nothing to choose, and the screen says what happens. */
  passphraseFile?: boolean;
  /** What every screen calls this machine (node-labels.md); empty uses
   * its network name, which on a container is its ID. */
  machineName?: string;
  onMachineName?: (v: string) => void;
  onPassphrase: (v: string) => void;
  onPassphraseConfirm: (v: string) => void;
  onSecurityMode: (v: SecurityMode) => void;
}) {
  const mismatch = passphraseConfirm.length > 0 && passphrase !== passphraseConfirm;
  // Said while typing, not after Continue: Continue stays off until the
  // passphrase is long enough, and a disabled button with no reason on
  // screen is a puzzle. Nothing is flagged before the first character.
  const typed = passphraseLength(passphrase);
  const tooShort = typed > 0 && typed < MIN_PASSPHRASE_LENGTH;
  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Choose a passphrase</h2>
      <p className="mb-6 text-sm leading-relaxed text-[color:var(--muted)]">
        It protects the keys and settings Eugene stores on this machine. You will also use it to
        sign in. Pick something you can remember: Eugene cannot reset it.
      </p>
      <Field
        label="Passphrase"
        description={`At least ${MIN_PASSPHRASE_LENGTH} characters. A short sentence works well.`}
      >
        {/* `new-password`, so a password manager offers to save it, and
            the line saying what is wrong is read with the box it is
            about. */}
        <SecretInput
          value={passphrase}
          onChange={onPassphrase}
          placeholder="A line of poetry, a sentence, a long phrase…"
          autoComplete="new-password"
          errorId={tooShort ? "passphrase-too-short" : undefined}
        />
      </Field>
      {tooShort && (
        <p
          id="passphrase-too-short"
          data-testid="passphrase-too-short"
          className="text-status-error -mt-2 mb-4 text-sm"
        >
          Use at least {MIN_PASSPHRASE_LENGTH} characters. This one has {typed}.
        </p>
      )}
      <Field label="Confirm passphrase" description="Same again, to guard against typos.">
        <SecretInput
          value={passphraseConfirm}
          onChange={onPassphraseConfirm}
          placeholder="(repeat the passphrase)"
          autoComplete="new-password"
          errorId={mismatch ? "passphrase-mismatch" : undefined}
        />
      </Field>
      {mismatch && (
        <p id="passphrase-mismatch" className="text-status-error -mt-2 mb-4 text-sm">
          Passphrases don&rsquo;t match yet.
        </p>
      )}
      <hr className="my-6 border-[color:var(--border)]" />
      <MachineNameField machineName={machineName} onMachineName={onMachineName} />
      <hr className="my-6 border-[color:var(--border)]" />
      <RestartChoice
        securityMode={securityMode}
        keyringAvailable={keyringAvailable}
        passphraseFile={passphraseFile}
        onSecurityMode={onSecurityMode}
      />
    </section>
  );
}

/** What every screen calls this machine (node-labels.md); shared with the
 * resume form, which shows it only while enrollment is left. */
export function MachineNameField({
  machineName,
  onMachineName,
}: {
  machineName: string;
  onMachineName: (v: string) => void;
}) {
  return (
    <Field
      label="This machine's name"
      description="What Eugene shows for this machine. Leave it empty to use its network name. You can change it later on Machines."
    >
      <FieldInput
        value={machineName}
        onChange={(e) => onMachineName(e.target.value)}
        placeholder="Home server, Studio PC…"
        maxLength={64}
        autoComplete="off"
        data-testid="machine-name"
        className="font-ui w-full rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--panel-soft)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent-left)]"
      />
    </Field>
  );
}

/** Whether Eugene comes back unlocked after a restart; shared with the
 * resume form. */
export function RestartChoice({
  securityMode,
  keyringAvailable,
  passphraseFile,
  onSecurityMode,
}: {
  securityMode: SecurityMode;
  keyringAvailable: boolean | null;
  passphraseFile: boolean;
  onSecurityMode: (v: SecurityMode) => void;
}) {
  const noKeyring = keyringAvailable === false;
  return (
    <>
      <h3 className="font-ui mb-3 text-sm font-semibold">After a reboot</h3>
      {passphraseFile ? (
        <p
          className="mb-4 text-sm leading-relaxed text-[color:var(--muted)]"
          data-testid="passphrase-file-note"
        >
          Eugene runs under its own account and keeps your passphrase in a file only that account
          can read, so it unlocks itself after a restart. Your programs and AI agents cannot read
          it.
        </p>
      ) : noKeyring ? (
        <p
          className="mb-4 text-sm leading-relaxed text-[color:var(--muted)]"
          data-testid="no-keyring-note"
        >
          This machine has no password manager Eugene can use, so after each restart Eugene will ask
          for the passphrase. A server or container can read it from a file instead: Settings &rarr;
          Access &amp; security, after setup.
        </p>
      ) : null}
      {/* **The label said "Start", and after R2.6 that is the wrong
          verb.** Eugene now starts on its own after a reboot because it
          is a Windows service, whatever this box says; what the box
          decides is whether it comes back UNLOCKED or waits for the
          passphrase. Conflating the two is how somebody unticks this and
          is surprised that the install still runs -- or ticks it and
          believes it fixed an autostart it never touched.

          Rewritten because the mechanism changed, not to make a weaker
          sentence true: see the roadmap's decision 4. */}
      {!passphraseFile && (
        <>
          <Checkbox
            checked={!noKeyring && securityMode === "os_keyring"}
            disabled={noKeyring}
            onChange={(checked) => onSecurityMode(checked ? "os_keyring" : "prompt_on_startup")}
            label="Unlock Eugene on its own after a restart"
            description="Eugene stores its key with the operating system and comes back ready to answer."
          />
          <p className="mt-2 text-sm leading-relaxed text-[color:var(--muted)]">
            Untick to be asked for the passphrase every time Eugene starts.
          </p>
        </>
      )}
      <p className="mt-2 text-sm leading-relaxed text-[color:var(--muted)]">
        Eugene itself starts when this machine does, before anyone signs in. You can change any of
        this later under Settings.
      </p>
    </>
  );
}
