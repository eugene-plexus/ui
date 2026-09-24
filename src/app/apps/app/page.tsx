"use client";

/**
 * One installed app: its state, its key, and what can be done with it.
 *
 * Selected by the tree as `?sel=app:<id>@<node>`; every call goes to
 * that machine's agent (`agentTarget`). Uninstalling revokes the app's
 * key before anything is removed, and if the key cannot be revoked
 * nothing is -- the agent's rule, which this page reports rather than
 * works around.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ApiError, api, describeError } from "@/lib/api";
import {
  agentTarget,
  describeApp,
  describeInstall,
  installFinished,
  openTarget,
  updateAvailable,
} from "@/lib/apps";
import { parseSelection } from "@/lib/resourceTree";
import type { App, AppCatalogue, AppInstall, NodeIdentity } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

const buttonClass =
  "font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-1 text-sm transition-colors hover:border-[color:var(--border-hover)] hover:bg-[color:var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40";

export default function AppOverviewPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const selection = parseSelection(searchParams.get("sel"));
  const appId = selection?.type === "app" ? selection.name : null;
  const node = selection?.type === "app" ? selection.node : null;

  const [localNode, setLocalNode] = useState<string | null | undefined>(undefined);
  const [app, setApp] = useState<App | null>(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [purge, setPurge] = useState(false);
  const [catalogueVersion, setCatalogueVersion] = useState<string | null>(null);
  const [install, setInstall] = useState<AppInstall | null>(null);

  const target = localNode === undefined ? null : agentTarget(node, localNode);

  const load = useCallback(async () => {
    let here = localNode;
    if (here === undefined) {
      const identity = await api.get<NodeIdentity>("agent", "/v1/node").catch(() => null);
      here = identity?.name ?? null;
      setLocalNode(here);
    }
    if (!appId) return;
    const t = agentTarget(node, here);
    try {
      setApp(await api.get<App>(t, `/v1/apps/${appId}`));
      setGone(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setGone(true);
      else setError(describeError(e));
    }
    const catalogue = await api.get<AppCatalogue>(t, "/v1/app-catalogue").catch(() => null);
    const entry = catalogue?.apps.find((a) => a.manifest.id === appId);
    setCatalogueVersion(entry && updateAvailable(entry) ? entry.manifest.version : null);
  }, [appId, node, localNode]);
  usePolling(load, 3000);

  async function act(path: string) {
    if (!target || !appId) return;
    setBusy(true);
    setError(null);
    try {
      setApp(await api.post<App>(target, `/v1/apps/${appId}/${path}`, {}));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function update() {
    if (!target || !appId) return;
    setError(null);
    try {
      setInstall(await api.post<AppInstall>(target, `/v1/apps/${appId}/install`, {}));
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        const snapshot = await api.get<AppInstall>(target, `/v1/apps/${appId}/install`);
        setInstall(snapshot);
        if (installFinished(snapshot)) break;
      }
      await load();
    } catch (e) {
      setError(describeError(e));
    }
  }

  async function uninstall() {
    if (!target || !appId) return;
    setError(null);
    try {
      await api.delete<void>(target, `/v1/apps/${appId}${purge ? "?purge=true" : ""}`);
      router.push("/apps");
    } catch (e) {
      setError(describeError(e));
    }
  }

  const pageHost = typeof window === "undefined" ? "localhost" : window.location.hostname;

  return (
    <AppShell>
      <main className="relative z-10 min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-8">
          {!appId && <p className="text-sm text-[color:var(--muted)]">Pick an app in the tree.</p>}
          {gone && (
            <p className="text-sm text-[color:var(--muted)]" data-testid="app-gone">
              This app is not installed on {node ?? "this machine"} any more.{" "}
              <Link href="/apps" className="underline">
                See the apps
              </Link>
              .
            </p>
          )}
          {error && (
            <p className="status-error text-sm" data-testid="app-error">
              {error}
            </p>
          )}
          {app && !gone && (
            <Overview
              app={app}
              busy={busy}
              pageHost={pageHost}
              catalogueVersion={catalogueVersion}
              install={install}
              purge={purge}
              onPurge={setPurge}
              onStart={() => act("start")}
              onStop={() => act("stop")}
              onRestart={() => act("restart")}
              onUpdate={update}
              onUninstall={uninstall}
            />
          )}
        </div>
      </main>
    </AppShell>
  );
}

function Overview({
  app,
  busy,
  pageHost,
  catalogueVersion,
  install,
  purge,
  onPurge,
  onStart,
  onStop,
  onRestart,
  onUpdate,
  onUninstall,
}: {
  app: App;
  busy: boolean;
  pageHost: string;
  catalogueVersion: string | null;
  install: AppInstall | null;
  purge: boolean;
  onPurge: (v: boolean) => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onUpdate: () => void;
  onUninstall: () => void;
}) {
  const state = describeApp(app);
  const open = openTarget(app, pageHost);
  const updating = install !== null && !installFinished(install);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-ui text-lg font-semibold">{app.name}</h2>
        <span className="font-ui text-sm" data-testid="app-status">
          {state.text}
        </span>
        {open.href && app.enabled && (
          <a
            href={open.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonClass} ml-auto`}
            data-testid="app-open"
          >
            Open ↗
          </a>
        )}
      </div>
      {open.note && (
        <p className="status-warn rounded-[var(--radius)] px-2 py-1 text-sm">{open.note}</p>
      )}
      {app.lastError && (
        <p
          className="status-error rounded-[var(--radius)] px-2 py-1 text-sm"
          data-testid="app-last-error"
        >
          {app.lastError}
        </p>
      )}
      {app.detail && (
        <p
          className="status-warn rounded-[var(--radius)] px-2 py-1 text-sm"
          data-testid="app-detail"
        >
          {app.detail}
        </p>
      )}

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-[color:var(--muted)]">Machine</dt>
        <dd>{app.node ?? "this machine"}</dd>
        <dt className="text-[color:var(--muted)]">Version</dt>
        <dd className="font-mono">
          {app.version}
          {app.previousVersion && (
            <span className="text-[color:var(--muted)]"> (kept: {app.previousVersion})</span>
          )}
        </dd>
        <dt className="text-[color:var(--muted)]">Port</dt>
        <dd className="font-mono">{app.port}</dd>
        {app.keyName && (
          <>
            <dt className="text-[color:var(--muted)]">Its key</dt>
            <dd>
              <span className="font-mono">{app.keyName}</span>
              <span className="text-[color:var(--muted)]">
                {" "}
                — listed with your other keys on{" "}
                <Link href="/" className="underline">
                  Home
                </Link>
                . Turning it off there cuts this app off.
              </span>
            </dd>
          </>
        )}
        {app.gatewayUrl && (
          <>
            <dt className="text-[color:var(--muted)]">Talks to</dt>
            <dd className="font-mono break-all">{app.gatewayUrl}</dd>
          </>
        )}
      </dl>

      <div className="flex flex-wrap gap-2">
        {app.enabled ? (
          <>
            <button type="button" className={buttonClass} disabled={busy} onClick={onStop}>
              Stop
            </button>
            <button type="button" className={buttonClass} disabled={busy} onClick={onRestart}>
              Restart
            </button>
          </>
        ) : (
          <button type="button" className={buttonClass} disabled={busy} onClick={onStart}>
            Start
          </button>
        )}
        {catalogueVersion && (
          <button
            type="button"
            className={buttonClass}
            disabled={updating}
            onClick={onUpdate}
            data-testid="app-update"
          >
            {updating ? "Updating…" : `Update to ${catalogueVersion}`}
          </button>
        )}
      </div>
      {install && (
        <p
          className={
            install.state === "failed"
              ? "status-error text-sm"
              : "text-sm text-[color:var(--muted)]"
          }
        >
          {describeInstall(install)} {install.state === "failed" ? install.error : ""}
        </p>
      )}

      <section className="flex flex-col gap-2 border-t border-[color:var(--border)] pt-4">
        <h3 className="font-ui text-sm font-semibold">Uninstall</h3>
        <p className="text-sm text-[color:var(--muted)]">
          Stops it, turns its key off, and removes what was installed. Its saved data stays unless
          you tick the box, so installing it again picks up where it left off.
        </p>
        <label className="font-ui flex items-center gap-2 text-sm">
          <input type="checkbox" checked={purge} onChange={(e) => onPurge(e.target.checked)} />
          Also delete its saved data
        </label>
        <div>
          <ConfirmButton
            label="Uninstall"
            confirmLabel={purge ? "Uninstall and delete its data" : "Uninstall"}
            prompt={`Uninstall ${app.name}? Its key stops working at once.`}
            onConfirm={onUninstall}
            className={buttonClass}
            testId="app-uninstall"
          />
        </div>
      </section>
    </>
  );
}
