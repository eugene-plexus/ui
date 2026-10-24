"use client";

import { useCallback, useState } from "react";

import { GatewayLibraryState, type LibraryState } from "@/components/LibraryFailure";
import { api, describeError } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";

interface Service {
  name: string;
  kind: string;
  status: string;
  lastError?: string | null;
}

export function LibraryServices({ target }: { target: string }) {
  const [services, setServices] = useState<Service[]>([]);
  const [library, setLibrary] = useState<LibraryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const load = useCallback(async () => {
    const answer = await api
      .get<{ components: Service[] }>(target, "/v1/components")
      .catch(() => null);
    if (!answer?.components) return;
    setServices(answer.components.filter((c) => ["library", "gateway"].includes(c.kind)));
    if (answer.components.some((c) => c.kind === "gateway")) {
      const info = await api
        .get<{ library: LibraryState }>(target, "/api/proxy/gateway/v1/info")
        .catch(() => null);
      setLibrary(info?.library ?? null);
    }
  }, [target]);
  usePolling(load, 10000);

  async function restart(name: string) {
    setRestarting(true);
    setError(null);
    try {
      await api.post(target, `/v1/components/${encodeURIComponent(name)}/restart`, {});
      await load();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setRestarting(false);
    }
  }

  return (
    <span className="block space-y-1 text-sm">
      {services.map((service) => (
        <span className="block" key={service.name}>
          {service.kind === "gateway" ? (
            library && <GatewayLibraryState library={library} />
          ) : (
            <>
              <span>
                {service.status === "running"
                  ? "The Library is answering."
                  : service.status === "safe_mode"
                    ? "The Library is in safe mode. Machines keep their saved folder lists."
                    : `The Library is not answering (${service.lastError || service.status}).`}
              </span>{" "}
              <button
                type="button"
                className="underline"
                disabled={restarting}
                onClick={() => void restart(service.name)}
              >
                {restarting ? "Restarting Library…" : "Restart Library"}
              </button>
            </>
          )}
        </span>
      ))}
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
