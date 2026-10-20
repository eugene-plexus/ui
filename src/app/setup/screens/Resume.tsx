"use client";

/**
 * Wizard screen 1 again, for an install whose passphrase is already set
 * (CX2).
 *
 * Continue on screen 1 makes several writes, and only the first cannot be
 * redone. When a later one failed, the next visit used to open screen 2
 * and the rest never ran. This form carries on instead, in two shapes:
 *
 * - **Nothing known yet** (no session in this tab): one passphrase box, to
 *   sign in. Continue signs in and then reads what is left, and this form
 *   shows it before anything runs.
 * - **What is left, in words**, with only the inputs those steps take: the
 *   machine's name while it has not joined, the restart choice, and the
 *   passphrase while the control root still needs it.
 *
 * The passphrase is typed once, not twice: a mistyped one is refused by
 * the agent before it goes anywhere (`verifyPassphrase`).
 */

import type { SecurityMode } from "../draft";
import { Field, SecretInput } from "../fields";
import { MachineNameField, RestartChoice } from "./Passphrase";

export function ScreenResume({
  stepsLeft,
  askPassphrase,
  askName,
  passphrase,
  onPassphrase,
  machineName,
  onMachineName,
  securityMode,
  keyringAvailable,
  passphraseFile,
  onSecurityMode,
}: {
  /** `null` until the install has been read, which takes a session. */
  stepsLeft: string[] | null;
  askPassphrase: boolean;
  askName: boolean;
  passphrase: string;
  onPassphrase: (v: string) => void;
  machineName: string;
  onMachineName: (v: string) => void;
  securityMode: SecurityMode;
  keyringAvailable: boolean | null;
  passphraseFile: boolean;
  onSecurityMode: (v: SecurityMode) => void;
}) {
  return (
    <section>
      <h2 className="font-ui mb-2 text-xl font-semibold">Finish setting up this install</h2>
      <p className="mb-6 text-sm leading-relaxed text-[color:var(--muted)]">
        {stepsLeft === null
          ? "Your passphrase is set. Type it to carry on setting up."
          : "Your passphrase is set. Setup stopped before it finished; Continue carries on from where it stopped."}
      </p>
      {stepsLeft !== null && stepsLeft.length > 0 && (
        <div className="mb-6">
          <h3 className="font-ui mb-2 text-sm font-semibold">Still to do</h3>
          <ul data-testid="steps-left" className="list-disc pl-5 text-sm leading-relaxed">
            {stepsLeft.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>
      )}
      {askPassphrase && (
        <Field label="Passphrase" description="The one you chose for this install.">
          <SecretInput
            value={passphrase}
            onChange={onPassphrase}
            placeholder="Your passphrase"
            autoComplete="current-password"
          />
        </Field>
      )}
      {stepsLeft !== null && askName && (
        <>
          <hr className="my-6 border-[color:var(--border)]" />
          <MachineNameField machineName={machineName} onMachineName={onMachineName} />
        </>
      )}
      {stepsLeft !== null && (
        <>
          <hr className="my-6 border-[color:var(--border)]" />
          <RestartChoice
            securityMode={securityMode}
            keyringAvailable={keyringAvailable}
            passphraseFile={passphraseFile}
            onSecurityMode={onSecurityMode}
          />
        </>
      )}
    </section>
  );
}
