import type { components } from "@/generated/agent";
import { api } from "./api";
import type { ProxyTarget } from "./config";
import type { ControlNode } from "./types";

export type ServingMeasurement = components["schemas"]["ServingMeasurement"];
export type ServingMeasurementRequest = components["schemas"]["ServingMeasurementRequest"];
export type ServingMeasurementPreflight = components["schemas"]["ServingMeasurementPreflight"];
export type ServingKnee = components["schemas"]["ServingKnee"];
export type ServingWorkload = components["schemas"]["ServingWorkload"];
export type ServingLevel = components["schemas"]["ServingLevel"];
export type ServingMeasurementList = components["schemas"]["ServingMeasurementList"];

export const measurementTarget = (node: string | null): ProxyTarget =>
  node ? `node:${node}` : "agent";

/** The final key is retried even if the browser that started the run closed. */
export async function revokeFinishedKey(
  job: ServingMeasurement,
  target: ProxyTarget,
): Promise<ServingMeasurement> {
  return job.state !== "running" && job.keyLive
    ? api
        .post<ServingMeasurement>(
          target,
          `/v1/serving-measurements/${encodeURIComponent(job.id)}/cancel`,
          {},
        )
        .catch((e: unknown) => ({
          ...job,
          detail: `${job.detail} Key revocation could not be confirmed: ${String(e)}`,
        }))
    : job;
}

export async function readServingMeasurements(): Promise<ServingMeasurement[]> {
  const [local, roster] = await Promise.all([
    api.get<ServingMeasurementList>("agent", "/v1/serving-measurements").catch(() => null),
    api.get<{ nodes?: ControlNode[] }>("control", "/v1/nodes").catch(() => null),
  ]);
  const lists = await Promise.all(
    (roster?.nodes ?? []).map((n) =>
      api
        .get<ServingMeasurementList>(`node:${n.name}`, "/v1/serving-measurements")
        .catch(() => null),
    ),
  );
  const unique = new Map<string, ServingMeasurement>();
  const localIds = new Set((local?.measurements ?? []).map((j) => `${j.node}/${j.id}`));
  for (const list of [local, ...lists])
    for (const job of list?.measurements ?? []) unique.set(`${job.node}/${job.id}`, job);
  return Promise.all(
    [...unique.values()].map((job) =>
      revokeFinishedKey(
        job,
        localIds.has(`${job.node}/${job.id}`) ? "agent" : measurementTarget(job.node),
      ),
    ),
  );
}
