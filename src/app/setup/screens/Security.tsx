"use client";

/**
 * Wizard screen: The passphrase, and whether the OS keyring holds the key.
 *
 * One screen per module since M9. Nothing here reads or writes the
 * install - a screen renders the draft and reports edits upwards, and
 * every write happens once, in `page.tsx`, when Start is pressed.
 */

import type { SecurityMode } from "../draft";
import { Field, Radio, SecretInput } from "../fields";

export function ScreenSecurity({
  passphrase,
  passphraseConfirm,
  securityMode,
  onPassphrase,
  onPassphraseConfirm,
  onSecurityMode,
}: {
  passphrase: string;
  passphraseConfirm: string;
  securityMode: SecurityMode;
  onPassphrase: (v: string) => void;
  onPassphraseConfirm: (v: string) => void;
  onSecurityMode: (v: SecurityMode) => void;
}) {
  const mismatch = passphraseConfirm.length > 0 && passphrase !== passphraseConfirm;
  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Security</h2>
      <p className="mb-6 text-sm leading-relaxed text-[color:var(--muted)]">
        Eugene Plexus protects sensitive config (like provider API keys) with an encryption key
        derived from a passphrase you set here. You&rsquo;ll use the same passphrase to sign in from
        a fresh browser tab. Pick something you can remember — Eugene can&rsquo;t reset it.
      </p>
      <Field
        label="Passphrase"
        description="Used to derive the encryption key. Anything non-empty works; a longer phrase is stronger."
      >
        <SecretInput
          value={passphrase}
          onChange={onPassphrase}
          placeholder="A line of poetry, a sentence, a long phrase…"
        />
      </Field>
      <Field label="Confirm passphrase" description="Same again — guard against typos.">
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
      <h3 className="font-ui mb-3 text-sm font-semibold">Auto-unlock</h3>
      <p className="mb-4 text-xs leading-relaxed text-[color:var(--muted)]">
        How Eugene should handle its encryption key between restarts. You can change this later from
        the Config page.
      </p>
      <Radio
        checked={securityMode === "os_keyring"}
        onChange={() => onSecurityMode("os_keyring")}
        label="OS keyring auto-unlock"
        description={
          "Best for: home / personal-use installs, AI hobbyists, anyone " +
          "who wants Eugene to auto-recover after a power outage. " +
          "Eugene's encryption key is stored in your OS's password " +
          "manager (Windows Credential Manager / macOS Keychain / Linux " +
          "Secret Service) and unlocked automatically when you log in. " +
          "Anyone with access to your user account can also start Eugene."
        }
      />
      <Radio
        checked={securityMode === "prompt_on_startup"}
        onChange={() => onSecurityMode("prompt_on_startup")}
        label="Prompt on startup"
        description={
          "Best for: shared environments, sensitive conversations, " +
          "security-conscious operators. Eugene's encryption key is " +
          "never written to disk. You'll type the passphrase by hand " +
          "every time the agent starts. A power outage means Eugene " +
          "stays offline until you re-enter the passphrase. Stronger " +
          "security; less convenience."
        }
      />
    </section>
  );
}
