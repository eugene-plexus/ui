"use client";

/**
 * The key that signs app sign-ins, and changing it (row 5, 5a).
 *
 * The control root changes the key by itself every `signInKeyDays`
 * (Settings), and apps stay signed in. After a suspected leak, *End every
 * app sign-in now* retires the old key at once, and every app signs in
 * again.
 */

import { useCallback, useEffect, useState } from "react";
import { api, describeError } from "@/lib/api";
import type { components } from "@/generated/control";

type OidcKeyList = components["schemas"]["OidcKeyList"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `21 Oct`: the day, in the words a person reads (the control root's words). */
export function keyDay(iso: string): string {
  const moment = new Date(iso);
  return `${moment.getDate()} ${MONTHS[moment.getMonth()]}`;
}

/** One line: when the key was made, and when it changes. */
export function keyLine(keys: OidcKeyList): string {
  const signing = keys.keys.find((key) => key.signs);
  if (!signing) return "Sign-in key: made at the first app sign-in.";
  const made = `Sign-in key: made ${keyDay(signing.createdAt)}`;
  return keys.nextChangeAt
    ? `${made}; changes on ${keyDay(keys.nextChangeAt)}.`
    : `${made}; it does not change by itself.`;
}

export function SignInKey({ rowClass }: { rowClass: string }) {
  const [keys, setKeys] = useState<OidcKeyList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [endSignIns, setEndSignIns] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setKeys(await api.get<OidcKeyList>("control", "/v1/oidc/keys"));
      setLoadError(null);
    } catch (e) {
      setLoadError(describeError(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function change() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setKeys(await api.post<OidcKeyList>("control", "/v1/oidc/keys/change", { endSignIns }));
      setDone(
        endSignIns
          ? "Sign-in key changed. Every app signs in again."
          : "Sign-in key changed. Apps stay signed in.",
      );
      setEndSignIns(false);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={rowClass} data-testid="sign-in-key">
      <p className="text-sm" data-testid="sign-in-key-line">
        {keys ? keyLine(keys) : (loadError ?? "Sign-in key: loading.")}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={endSignIns}
          disabled={busy}
          onChange={(e) => setEndSignIns(e.target.checked)}
        />
        End every app sign-in now (the key may have leaked)
      </label>
      <button
        type="button"
        className="action-button font-ui self-start rounded-[var(--radius)] border border-[color:var(--border)] px-2.5 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        disabled={busy}
        onClick={() => void change()}
      >
        Change sign-in key
      </button>
      {error && (
        <p role="alert" className="status-error text-sm">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="status-success text-sm">
          {done}
        </p>
      )}
    </div>
  );
}
