import { api, describeError } from "./api";
import { parseModelSlots, type ModelSlot } from "./modelSlots";
import type {
  ConfigUpdateResult,
  Model,
  ModelList,
  ModelRole,
  ModelRoleDefinition,
  ModelRoleList,
} from "./types";

export interface RoleData {
  roles: ModelRoleDefinition[];
  slots: ModelSlot[];
  models: Model[];
  listingError: string | null;
}

function slotsOf(config: { modelSlots?: unknown }): ModelSlot[] {
  const parsed = parseModelSlots(config.modelSlots);
  if (parsed.error) throw new Error(`Cannot edit model roles: ${parsed.error}`);
  return parsed.slots;
}

export async function readRoles(): Promise<RoleData> {
  const [roles, config, listing] = await Promise.all([
    api.get<ModelRoleList>("gateway", "/v1/roles"),
    api.get<{ modelSlots?: unknown }>("gateway", "/v1/config"),
    api.get<ModelList>("gateway", "/v1/models").then(
      (value) => ({ models: value.data, error: null }),
      (error: unknown) => ({ models: [], error: describeError(error) }),
    ),
  ]);
  return {
    roles: roles.roles,
    slots: slotsOf(config),
    models: listing.models,
    listingError: listing.error,
  };
}

/** Read again before saving so edits to every other slot survive. */
export async function changeRole(
  role: ModelRole,
  edit: (models: string[]) => string[],
): Promise<void> {
  const slots = slotsOf(await api.get<{ modelSlots?: unknown }>("gateway", "/v1/config"));
  const name = `role:${role}`;
  const index = slots.findIndex((s) => s.model === name);
  const targets = edit(index < 0 ? [] : [...slots[index]!.targets]);
  const next = slots.filter((s) => s.model !== name);
  if (targets.length > 0) next.splice(index < 0 ? next.length : index, 0, { model: name, targets });
  const result = await api.patch<ConfigUpdateResult>("gateway", "/v1/config", { modelSlots: next });
  if (result.rejected?.length) throw new Error(result.rejected.map((r) => r.message).join(" "));
  if (!result.applied?.includes("modelSlots"))
    throw new Error("The gateway did not apply the model roles.");
}

export type Finding = "yes" | "no" | "unknown";

const ROLE_LABELS: Record<ModelRole, string> = {
  chat: "Chat",
  agentic: "Agentic",
  vision: "Sees images",
  "reads-pages": "Reads pages",
  image: "Makes images",
  "speech-to-text": "Hears speech",
  "text-to-speech": "Speaks",
  music: "Makes music",
  embeddings: "Embeddings",
  rerank: "Reranks",
  decision: "Decisions",
};

export function roleChoiceLabel(value: string): string | null {
  const role = value.startsWith("role:") ? value.slice(5) : "";
  return Object.hasOwn(ROLE_LABELS, role)
    ? `Use the install's ${ROLE_LABELS[role as ModelRole]} model (role)`
    : null;
}

export function candidateFinding(model: Model, role: ModelRoleDefinition): Finding {
  const assigned = role.models.find((m) => m.model === model.id);
  if (assigned) return assigned.capability;
  const info = model.x_eugene_plexus;
  const surfaces = info?.surfaces ?? [];
  if (!surfaces.length) return "unknown";
  const required = role.requiredCapability;
  if (required === "toolCalling" || required === "imageInput" || required === "audioOutput") {
    if (required !== "audioOutput" && !surfaces.includes("chat")) return "no";
    const supported =
      required === "toolCalling"
        ? info?.tool_calling
        : required === "imageInput"
          ? info?.image_input
          : info?.audio_output;
    // The models listing folds unreported inputs into false; only a yes is established here.
    return supported === true ? "yes" : "unknown";
  }
  return surfaces.some((s) => s === (required === "decision" ? "decisions" : required))
    ? "yes"
    : "no";
}
