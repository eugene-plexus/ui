"use client";

/**
 * Connect apps: the address, keys and model an app needs, on a page of its
 * own under Gateway (CX5).
 *
 * The card lived on Home, and only while a chat model was served. So the
 * one place to turn off a leaked key vanished whenever the models were
 * stopped, Settings linked to `/#use-from-apps` and found nothing there, and
 * Apps said "listed on Home" about a list that was not. Here the card always
 * renders. With nothing served, the model row says so and the recipes carry
 * a placeholder, but the address, its check and every key action work.
 */

import { useCallback, useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { ConnectTls } from "@/components/ConnectTls";
import { UseFromAppsCard } from "@/components/home/UseFromAppsCard";
import { api } from "@/lib/api";
import { PROXY, listModels } from "@/lib/completions";
import { gatewayAddressGuess } from "@/lib/connectApps";
import { gatewayUrls } from "@/lib/connectTls";
import type { ClientTls } from "@/lib/clientDoors";
import { chatModels } from "@/lib/home";
import { pageTitle, useDocumentTitle } from "@/lib/pageTitle";
import type { ComponentList, ComponentPlacementList, ModelList, NodeIdentity } from "@/lib/types";
import { usePolling } from "@/lib/usePolling";

const POLL_MS = 15000;

export default function ConnectAppsPage() {
  useDocumentTitle(pageTitle({ page: "Connect apps", node: null, machines: 1 }));
  const [node, setNode] = useState<NodeIdentity | null>(null);
  const [components, setComponents] = useState<ComponentList | null>(null);
  const [models, setModels] = useState<ModelList | null>(null);
  const [gatewayFailed, setGatewayFailed] = useState(false);
  const [placement, setPlacement] = useState<ComponentPlacementList | null>(null);

  const load = useCallback(async () => {
    const [nodeResult, componentsResult, modelsResult, placementResult] = await Promise.all([
      api.get<NodeIdentity>("agent", "/v1/node").catch(() => null),
      api.get<ComponentList>("agent", "/v1/components").catch(() => null),
      listModels(PROXY).catch(() => null),
      api
        .get<ComponentPlacementList>("control", "/v1/components", { timeoutMs: 5000 })
        .catch(() => null),
    ]);
    // One missed poll keeps the last good reading, as Home does.
    if (nodeResult !== null) setNode(nodeResult);
    if (componentsResult !== null) setComponents(componentsResult);
    if (modelsResult !== null) setModels(modelsResult);
    setGatewayFailed(modelsResult === null);
    if (placementResult !== null) setPlacement(placementResult);
  }, []);
  usePolling(load, POLL_MS);

  const chat = useMemo(() => chatModels(models), [models]);
  const gatewayGuess = useMemo(() => gatewayAddressGuess(node, components), [node, components]);
  const tls = (node as { clientTls?: ClientTls } | null)?.clientTls ?? null;
  const urls = useMemo(() => gatewayUrls(gatewayGuess, tls), [gatewayGuess, tls]);

  return (
    <AppShell>
      <main data-testid="connect-apps" className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
          <div>
            <h1 className="font-ui text-lg font-semibold">Connect apps</h1>
            <p className="font-ui mt-1 text-sm text-[color:var(--muted)]">
              The address, keys and model names your apps use to reach this install, whether or not
              a model is running.
            </p>
          </div>
          {models !== null && chat.length === 0 && (
            <p
              data-testid="connect-no-model"
              className="font-ui rounded-[var(--radius)] border border-[color:var(--border)] px-3 py-2 text-sm text-[color:var(--muted)]"
            >
              No chat model is running, so there is no model name to give an app yet. The address
              and your keys work all the same.
            </p>
          )}
          {gatewayFailed && models === null && (
            <p data-testid="connect-gateway-silent" className="status-warn font-ui text-sm">
              The gateway did not answer, so the models it serves are not known. Keys can still be
              made and turned off.
            </p>
          )}
          <UseFromAppsCard
            models={chat}
            gatewayPortUrl={urls.primary}
            verifyUrl={urls.check}
            placement={placement}
            localNode={node?.name ?? null}
            boundAddresses={node?.reach?.boundAddresses ?? null}
          />
          <ConnectTls urls={urls} tls={tls} />
        </div>
      </main>
    </AppShell>
  );
}
