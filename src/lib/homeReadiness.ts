import type { RoutingTableView } from "./types";

/** Use the selected slot (including replicas/fallbacks), never join by driver name. */
export function homeReadiness(model: string | null, routing: RoutingTableView | null) {
  if (!model) return { canSend: false, kind: "unavailable", message: "Choose a model to begin." };
  if (!routing)
    return {
      canSend: false,
      kind: "unavailable",
      message: "Cannot check this model right now. Your message stays here while we reconnect.",
    };
  const backends =
    routing.slots.find((slot) => slot.model === model)?.tiers.flatMap((tier) => tier.backends) ??
    [];
  if (backends.some((b) => b.eligible))
    return { canSend: true, kind: "ready", message: "Ready for your message." };
  if (backends.some((b) => b.runtime_status === "stopped" && b.start_on_demand))
    return {
      canSend: true,
      kind: "on-demand",
      message: "Send will start this model. The first answer may take a little longer.",
    };
  if (backends.some((b) => ["loading", "starting"].includes(b.runtime_status ?? "")))
    return {
      canSend: false,
      kind: "loading",
      message:
        "The model is loading. You can write your message now; Send becomes available when it is ready.",
    };
  if (backends.some((b) => b.runtime_status === "crashed"))
    return {
      canSend: false,
      kind: "failed",
      message:
        "The model failed to start. Check the model to see what went wrong; your message stays here.",
    };
  if (backends.some((b) => b.runtime_status === "stopped"))
    return {
      canSend: false,
      kind: "stopped",
      message: "This model is stopped. Start it from Check the model, then send your message.",
    };
  return {
    canSend: false,
    kind: "unavailable",
    message: "This model cannot answer right now. Check its connection; your message stays here.",
  };
}
