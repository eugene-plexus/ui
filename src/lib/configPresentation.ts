import type { ConfigField } from "./types";

/** Presentation only. Unknown/new fields stay visible; the API owns all defaults and validation. */
const MORE: Record<string, readonly string[]> = {
  agent: ["vllmBinary", "engineBinaryRoots", "allowUnrestrictedEngineLaunch", "firstRunComplete"],
  control: [
    "standbyUrls",
    "joinTokenTtlSeconds",
    "nodePollIntervalSeconds",
    "nodeRequestTimeoutSeconds",
    "logLevel",
    "firstRunComplete",
  ],
  gateway: [
    "profileCacheSeconds",
    "profileMaxStaleSeconds",
    "routingRefreshSeconds",
    "idleCheckSeconds",
    "controlUrl",
    "logLevel",
  ],
  library: ["scanOnStartup", "catalogueBaseUrl", "starterModelsFile", "logLevel"],
  "inference-driver": ["logLevel"],
};

// Common tasks first. Within a category the schema retains its field order.
const ORDER: Record<string, readonly string[]> = {
  agent: ["storage", "modelStorage", "node", "security", "engines", "ui", "setup"],
  control: ["security", "replication", "topology", "ui", "logging", "setup"],
  gateway: ["generation", "lifecycle", "clients", "routing", "metrics", "logging"],
  library: ["library", "catalogue", "downloads", "guidance", "scanning", "logging"],
  "inference-driver": ["adapter", "network", "logging"],
};

export function configGroups(component: string, fields: ConfigField[]) {
  const candidates = new Set(MORE[component] ?? []);
  const more = fields.filter((field) => candidates.has(field.key));
  // A disclosure for one or two fields costs more than it saves.
  const hidden = more.length >= 3 ? candidates : new Set<string>();
  const order = ORDER[component] ?? [];
  const rank = (field: ConfigField) => {
    const index = order.indexOf(field.category ?? "general");
    return index < 0 ? order.length : index;
  };
  const sorted = [...fields].sort((a, b) => rank(a) - rank(b));
  return {
    common: sorted.filter((field) => !hidden.has(field.key)),
    more: sorted.filter((field) => hidden.has(field.key)),
  };
}
