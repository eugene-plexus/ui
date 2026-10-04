"use client";

/**
 * An app's own settings, edited through its machine's agent.
 *
 * The agent serves the app's config trio at `/v1/apps/{id}/config`,
 * calling the app with an admin token it generated for that run, so this
 * console never hands the app a credential of its own
 * (`specs/docs/design/apps-and-spokes.md` §11.2). The generic editor
 * renders it like any component's settings; `endpoints` is what stops it
 * restarting the agent when the app asks for a restart.
 */

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ConfigEditor, type ConfigEndpoints } from "@/components/ConfigEditor";
import { api, describeError } from "@/lib/api";
import { agentTarget } from "@/lib/apps";
import { parseSelection } from "@/lib/resourceTree";
import type { App, NodeIdentity } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

export default function AppSettingsPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const searchParams = useSearchParams();
  const selection = parseSelection(searchParams.get("sel"));
  const appId = selection?.type === "app" ? selection.name : null;
  const node = selection?.type === "app" ? selection.node : null;
  const [localNode, setLocalNode] = useState<string | null | undefined>(undefined);
  const [app, setApp] = useState<App | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    let here = localNode;
    if (here === undefined) {
      const identity = await api.get<NodeIdentity>("agent", "/v1/node").catch(() => null);
      here = identity?.name ?? null;
      setLocalNode(here);
    }
    if (!appId) return;
    try {
      setApp(await api.get<App>(agentTarget(node, here), `/v1/apps/${appId}`));
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }, [appId, node, localNode]);
  // Once: the editor owns the page after that, and a poll would re-render
  // it under someone typing.
  usePolling(load, 60_000, app === null);

  const target = localNode === undefined ? null : agentTarget(node, localNode);
  const endpoints = useMemo<ConfigEndpoints | null>(() => {
    if (!target || !appId) return null;
    return {
      config: `/v1/apps/${appId}/config`,
      restart: async () => {
        await api.post<App>(target, `/v1/apps/${appId}/restart`, {});
        return "Restarting it…";
      },
      waitUntilBack: async (timeoutMs) => {
        const deadline = Date.now() + timeoutMs;
        await new Promise((r) => setTimeout(r, 750));
        while (Date.now() < deadline) {
          const now = await api.get<App>(target, `/v1/apps/${appId}`).catch(() => null);
          if (now?.status === "running") return true;
          await new Promise((r) => setTimeout(r, 500));
        }
        return false;
      },
      canTest: false,
    };
  }, [target, appId]);

  return (
    <AppShell>
      <main className="relative z-10 min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8">
          {error && <p className="status-error mb-4 text-sm">{error}</p>}
          {app && !app.configTrio && (
            <p className="text-sm text-[color:var(--muted)]" data-testid="app-no-settings">
              {app.name} does not publish settings this console can edit. Anything it needs to be
              told, it reads from its own files.
            </p>
          )}
          {app && app.configTrio && app.status !== "running" && (
            <p className="text-sm text-[color:var(--muted)]" data-testid="app-settings-not-running">
              {app.name} is not running, so its settings cannot be read. Start it from its Overview
              page.
            </p>
          )}
          {app && app.configTrio && app.status === "running" && target && endpoints && (
            <ConfigEditor target={target} label={app.name} endpoints={endpoints} />
          )}
        </div>
      </main>
    </AppShell>
  );
}
