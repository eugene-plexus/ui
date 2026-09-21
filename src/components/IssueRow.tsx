"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { unlockControlRoot } from "@/lib/controlUnlock";
import type { Issue } from "@/lib/issues";
import { getSessionToken } from "@/lib/session";

/**
 * One issue, as it reads in the header list and on Home.
 *
 * Shared by `IssuesBadge` and `NeedsAttentionCard` rather than written
 * twice, because the second copy would be a second chance to get the
 * unlock wrong -- and the unlock is the one place in this UI where a
 * person types a secret into a form that is not the sign-in page.
 *
 * **Every issue links to the screen that owns its fix, except one.** A
 * one-click remedy for something with consequences belongs beside the
 * words that explain them, so the remedy lives on the screen that can
 * explain it. The sealed control root is the exception, and the reason
 * is not convenience: a locked root is the state in which every other
 * screen is already useless -- the gateway cannot read the topology,
 * `/v1/models` is empty, and `/nodes` is exactly as unreachable as
 * everything else -- so a link there is a door that is shut.
 */
export function IssueRow({
  issue,
  onFollow,
  onFixed,
}: {
  issue: Issue;
  /** Close whatever disclosure this row sits in, if it sits in one. */
  onFollow?: () => void;
  onFixed: () => Promise<void>;
}) {
  const toneClass = issue.severity === "blocking" ? "text-status-error" : "text-status-warn";
  return (
    <div
      data-testid="issue-row"
      data-issue-kind={issue.kind}
      data-issue-severity={issue.severity}
      className="rounded-[var(--radius)] px-2 py-1.5"
    >
      <p className={`font-ui text-xs font-semibold ${toneClass}`}>{issue.title}</p>
      {/* Never truncated. This is the sentence that says what to do, and
          it is read by somebody who is already unhappy. */}
      <p className="mt-0.5 text-[0.6875rem] text-[color:var(--muted)]">{issue.detail}</p>
      {issue.action === "unlock-control-root" ? (
        <UnlockForm onFixed={onFixed} />
      ) : (
        <Link
          href={issue.href}
          onClick={() => onFollow?.()}
          className="font-ui mt-1 inline-block text-[0.6875rem] underline underline-offset-2 hover:text-[color:var(--foreground)]"
        >
          Go and fix it
        </Link>
      )}
    </div>
  );
}

/**
 * The passphrase, typed where the problem is reported.
 *
 * A sealed root holds the install's signing key shut; it is not a
 * password prompt for this browser, and the session is already good, so
 * a failure here means the root holds a *different* passphrase — which
 * is a real and confusing state (a re-initialized side) and is named as
 * such rather than as "wrong password".
 */
function UnlockForm({ onFixed }: { onFixed: () => Promise<void> }) {
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fieldId = useId();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || passphrase === "") return;
    setBusy(true);
    setProblem(null);
    const token = getSessionToken();
    // Patient, unlike the sign-in path: this form has a spinner and a
    // person watching it, and Argon2id on the root's own host decides
    // how long a correct passphrase takes. The live report this fixes
    // was "I always have to enter the passphrase twice" — the first
    // attempt succeeded after an 8 s client timeout had already called
    // it a failure.
    const outcome = token
      ? await unlockControlRoot(passphrase, token, { timeoutMs: 30_000, confirmAttempts: 4 })
      : ("unavailable" as const);
    if (outcome === "unlocked") {
      setPassphrase("");
      // The issue disappears when the next read finds the root open, and
      // that read is pulled forward rather than waited for.
      await onFixed();
    } else if (outcome === "mismatch") {
      setProblem(
        "That is not the passphrase this control root holds. It is the one that was set when " +
          "this install was created, which is not always the one you sign in with.",
      );
    } else {
      setProblem("The control root did not answer. Check that the machine holding it is running.");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-1.5 flex flex-col gap-1">
      <label htmlFor={fieldId} className="sr-only">
        Passphrase for the control root
      </label>
      <div className="flex items-center gap-1">
        <input
          id={fieldId}
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoComplete="off"
          placeholder="Passphrase"
          data-testid="issues-unlock-passphrase"
          className="font-ui min-w-0 flex-1 rounded-[var(--radius)] border border-[color:var(--border)] bg-[color:var(--background)] px-2 py-1 text-xs"
        />
        <button
          type="submit"
          disabled={busy || passphrase === ""}
          data-testid="issues-unlock-submit"
          className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-2 py-1 text-xs transition-colors hover:bg-[color:var(--panel-hover)] disabled:opacity-50"
        >
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </div>
      {problem && (
        <p data-testid="issues-unlock-problem" className="text-status-error text-[0.6875rem]">
          {problem}
        </p>
      )}
    </form>
  );
}
