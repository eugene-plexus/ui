import type { ConfigField } from "./types";

/** Presentation only. Unknown/new fields stay visible; the API owns all defaults and validation. */
const MORE: Record<string, readonly string[]> = {
  agent: [
    "vllmBinary",
    "mlxBinary",
    "kevPython",
    "engineBinaryRoots",
    "allowUnrestrictedEngineLaunch",
    "uvBinary",
    "allowedHosts",
  ],
  control: [
    "standbyUrls",
    "joinTokenTtlSeconds",
    "nodePollIntervalSeconds",
    "nodeRequestTimeoutSeconds",
    "logLevel",
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
  const hidden = foldedKeys(component, fields);
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

/**
 * The keys the editor folds under *Show more* for this set of fields.
 * Decided on the WHOLE list a component serves, so a page showing a
 * subset of it (Settings by topic) folds the same fields the component's
 * own page does.
 */
export function foldedKeys(component: string, fields: ConfigField[]): ReadonlySet<string> {
  const candidates = new Set(MORE[component] ?? []);
  const more = fields.filter((field) => candidates.has(field.key));
  // A disclosure for one or two fields costs more than it saves.
  return more.length >= 3 ? candidates : new Set<string>();
}

/**
 * Honor `ConfigField.showWhen`: only render the field when another field's
 * current value matches the predicate. The spec supports two forms:
 *
 *   - scalar `equals`: literal equality against the referenced field's value
 *   - array  `equals`: set-membership — fires when the value matches any entry
 *
 * The array form is what lets a single `apiKey` field declare itself
 * applicable to several enum entries (`provider` ∈ {openai, xai, …}).
 */
export function isFieldVisible(field: ConfigField, values: Record<string, unknown>): boolean {
  if (!field.showWhen) return true;
  const target = JSON.stringify(values[field.showWhen.key]);
  const equals = field.showWhen.equals as unknown;
  if (Array.isArray(equals)) {
    return equals.some((e) => JSON.stringify(e) === target);
  }
  return JSON.stringify(equals) === target;
}
