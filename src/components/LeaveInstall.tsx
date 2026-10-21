"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ConfirmButton } from "@/components/ConfirmButton";
import type { components } from "@/generated/agent";
import { api, describeError } from "@/lib/api";
import { leaveWithSession, leftMessage } from "@/lib/leaveInstall";
import { clearSessionToken } from "@/lib/session";

type NodeIdentity = components["schemas"]["NodeIdentity"];

/**
 * "Leave the install" for the machine this console runs on (ui#20).
 *
 * Shown while it is enrolled, and never on the root's own machine: leaving
 * there would take the install's root off its own authority. To take
 * another machine out, use Remove from install on its row; a running
 * machine that is removed leaves by itself within a minute (agent#21).
 */
export function LeaveInstall({ rootName }: { rootName?: string }) {
  const [identity, setIdentity] = useState<NodeIdentity | null>(null);
  const [left, setLeft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .get<NodeIdentity>("agent", "/v1/node")
      .then((got) => {
        if (live) setIdentity(got);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (left) {
    return (
      <section className="mt-8" data-testid="leave-install">
        <p role="status" className="status-warn rounded-[var(--radius)] border px-3 py-2 text-sm">
          {left}{" "}
          <Link href="/login/" className="underline">
            Sign in again
          </Link>
        </p>
      </section>
    );
  }
  if (!identity?.enrolled || (rootName !== undefined && identity.name === rootName)) return null;

  const leave = async () => {
    setError(null);
    try {
      const result = await leaveWithSession();
      // The session was the install's; this machine no longer trusts it.
      clearSessionToken();
      setLeft(leftMessage(result));
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <section className="mt-8" data-testid="leave-install">
      <h2 className="font-ui text-sm font-semibold">This machine</h2>
      <p className="mt-1 text-sm text-[color:var(--muted)]">
        {identity.name ? `${identity.name} is` : "It is"} joined to the install
        {identity.controlUrl ? ` at ${identity.controlUrl}` : ""}.
      </p>
      <div className="mt-2">
        <ConfirmButton
          label="Leave the install"
          confirmLabel="Leave and work on its own"
          testId="leave-install-button"
          prompt={
            <span data-testid="leave-install-prompt">
              This machine stops trusting the install and works on its own. Sessions on it end: sign
              in again with this machine&apos;s passphrase. To come back, join again with a new
              token.
            </span>
          }
          onConfirm={leave}
          className="rounded border border-[color:var(--border)] px-2 py-0.5 text-sm"
          confirmClassName="text-status-error"
        />
      </div>
      {error && (
        <p role="alert" className="text-status-error mt-2 max-w-md text-sm">
          {error}
        </p>
      )}
    </section>
  );
}
