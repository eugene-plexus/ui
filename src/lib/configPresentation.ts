import { effectiveValue, formatValue, readValue, unsetSentence } from "./configValue";
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
    "pathMappings",
    "modelCopyMinFreeGb",
    "shareCredentials",
  ],
  control: [
    "joinTokenTtlSeconds",
    "nodePollIntervalSeconds",
    "nodeRequestTimeoutSeconds",
    "logLevel",
    "siteJoinUrl",
    "oidcIssuer",
  ],
  gateway: [
    "profileCacheSeconds",
    "profileMaxStaleSeconds",
    "routingRefreshSeconds",
    "idleCheckSeconds",
    "controlUrl",
    "logLevel",
    "requestTimeoutSeconds",
    "swapWaitSeconds",
    "decisionMaxQuestions",
    "maxImagesPerRequest",
    "metricsRetentionDays",
    "metricsRollupEnabled",
  ],
  library: [
    "scanOnStartup",
    "starterModelsFile",
    "logLevel",
    "followSymlinks",
    "downloadLayout",
    "maxConcurrentDownloads",
    "guidanceContextLength",
  ],
  "inference-driver": ["logLevel"],
  workbench: [
    "memoryMaxNotes",
    "documentsMaxFileMB",
    "documentsWholeUpToTokens",
    "documentsMaxPassagesPerPerson",
    "documentsEmbeddingModel",
    "documentsEmbedRequestsPerMinute",
    "documentsSortModel",
    "documentsSortSeconds",
    "documentsFolderSyncMinutes",
    "documentsFolderMaxFiles",
    "documentsFolderMaxMB",
    "documentsFolderMaxDepth",
  ],
};

/** A disclosure is presentation only. Important state must remain outside it. */
export function needsAttention(field: ConfigField, value: unknown): boolean {
  const reading = readValue(field, value);
  return Boolean(
    field.pendingRestart ||
    field.status?.level === "warning" ||
    reading.kind === "unrepresentable" ||
    (reading.kind === "value" && reading.warning),
  );
}

export function isCustomized(field: ConfigField, value: unknown): boolean {
  return (
    value !== undefined && value !== null && JSON.stringify(value) !== JSON.stringify(field.default)
  );
}

/** Summaries never serialize structured credentials or reveal a secret. */
export function settingSummary(field: ConfigField, value: unknown): string {
  if (field.sensitive || field.valueType === "secret") return value ? "Set" : "Not set";
  if (value === undefined || value === null) return unsetSentence(field);
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? "entry" : "entries"}`;
  if (typeof value === "object" || field.valueType === "url") return "Configured";
  if (value === "auto") return "Automatic";
  if (value === "off") return "Off";
  const text = formatValue(field, value);
  return text.length > 100 ? `${text.slice(0, 97)}...` : text;
}

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
 * The keys the editor folds under *Customize* for this set of fields.
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
export function isFieldVisible(
  field: ConfigField,
  values: Record<string, unknown>,
  fields?: readonly ConfigField[],
): boolean {
  if (!field.showWhen) return true;
  // The referenced field's EFFECTIVE value: a document that leaves it out
  // still runs on its default, and the fields that depend on the default
  // must not vanish while it applies (settings never lie, 2026-09-30).
  const target = JSON.stringify(effectiveValue(field.showWhen.key, values, fields));
  const equals = field.showWhen.equals as unknown;
  if (Array.isArray(equals)) {
    return equals.some((e) => JSON.stringify(e) === target);
  }
  return JSON.stringify(equals) === target;
}
