/**
 * Friendlier aliases over the auto-generated openapi-typescript types.
 *
 * The generated `components["schemas"]["X"]` form is precise but unwieldy
 * at call sites. Pull the handful we use into named exports here.
 */

import type { components as OrchComponents } from "@/generated/orchestrator";

export type Role = OrchComponents["schemas"]["Role"];
// Decision isn't a top-level schema — it's inline on CallosumState.decision —
// so derive it from there. TODO(specs): consider lifting it to a $ref so
// codegen produces a named type.
export type Decision = OrchComponents["schemas"]["CallosumState"]["decision"];
export type Message = OrchComponents["schemas"]["Message"];
export type Conversation = OrchComponents["schemas"]["Conversation"];
export type CallosumState = OrchComponents["schemas"]["CallosumState"];
export type PassRecord = OrchComponents["schemas"]["PassRecord"];
export type ToolInvocationRecord = OrchComponents["schemas"]["ToolInvocationRecord"];
export type DriversInfo = OrchComponents["schemas"]["DriversInfo"];
export type DriverHealth = OrchComponents["schemas"]["DriverHealth"];

// --- M2 continuous-runtime wire shapes ------------------------------------
//
// The v0.2 request-response surface (ChatRequest / ChatResponse / POST
// /v1/chat) is gone. The UI now speaks the continuous-loop contract:
//   - send  → POST /v1/events with an AfferentEvent (fire-and-forget, 202)
//   - render ← GET /v1/stream/consciousness (SSE), the live stream of
//              Eugene's inner activity. Replies arrive as `speech` events.
export type AfferentEvent = OrchComponents["schemas"]["AfferentEvent"];
export type IncomingMessage = OrchComponents["schemas"]["IncomingMessage"];
export type MessageSource = OrchComponents["schemas"]["MessageSource"];
export type PresenceEvent = OrchComponents["schemas"]["PresenceEvent"];
export type GateDecision = OrchComponents["schemas"]["GateDecision"];

// `EfferentSpeechAct` lives in common.yaml but the orchestrator spec only
// references it in prose (the SSE event descriptions), never via a $ref
// from a schema/response — so openapi-typescript doesn't emit a named
// type for it (same situation as `DriverEntry` below). Hand-typed to
// mirror common.yaml#/components/schemas/EfferentSpeechAct.
export interface EfferentSpeechAct {
  destination: MessageSource;
  content: string;
  /** AfferentEvent.eventId this reacts to; absent for self-initiated speech. */
  inResponseTo?: string;
  conversationId?: string;
  timestamp: string;
}

// The two SSE event types whose `data` is an inline object in the spec
// (documented in the /v1/stream/consciousness description, not as named
// schemas). Hand-typed to match what the loop publishes.
export interface FocusSwitch {
  from: string | null;
  to: string | null;
}
export interface PhaseChange {
  phase: "awake" | "asleep";
}

// Discriminated union of everything that arrives on the consciousness
// stream. `event:` field → `type`; `data:` JSON → `data`. Unknown event
// types fall through to the `unknown` arm (the spec says treat them as
// informational), so a forward-compatible orchestrator can add events
// without breaking the UI.
export type ConsciousnessEvent =
  | { type: "thought"; data: PassRecord }
  | { type: "nt_update"; data: NTState }
  | { type: "gate_decision"; data: GateDecision }
  | { type: "tool_call"; data: ToolInvocationRecord }
  | { type: "speech"; data: EfferentSpeechAct }
  | { type: "focus_switch"; data: FocusSwitch }
  | { type: "phase_change"; data: PhaseChange }
  | { type: string; data: unknown };

// `DriverEntry` is defined in common.yaml but openapi-typescript only
// inlines schemas reachable via $ref from the per-component spec file,
// and orchestrator.yaml doesn't reference it directly. The shape is
// trivial so we type it by hand here. If a future spec change adds a
// $ref, drop this in favor of OrchComponents["schemas"]["DriverEntry"].
//
// A slot's `backends` is an ordered priority list of watchdog-topology
// hemisphere-driver entry NAMES (v0.2.1 item 2). The orchestrator
// resolves each name to a URL at startup and cascades through them on
// transport error / 5xx / timeout. Backend URLs live only in the
// watchdog topology, not duplicated here. Stock installs have one
// backend per slot.
export interface DriverEntry {
  name: string;
  backends: string[];
}
export type NTState = OrchComponents["schemas"]["NTState"];
export type NTLevel = OrchComponents["schemas"]["NTLevel"];
export type Problem = OrchComponents["schemas"]["Problem"];

// The six v0.2 neurotransmitters, in display order (energizing → calming →
// stress). The NTState schema has one NTLevel field per NT; this list lets
// the UI iterate without hardcoding the order at each call site.
export const NT_KEYS = [
  "dopamine",
  "serotonin",
  "norepinephrine",
  "acetylcholine",
  "gaba",
  "cortisol",
] as const;
export type NTKey = (typeof NT_KEYS)[number];

export type ConfigField = OrchComponents["schemas"]["ConfigField"];
export type ComponentKind = OrchComponents["schemas"]["ComponentKind"];

// Watchdog topology entry — the shape returned by `GET /v1/components`.
// We type just the fields the UI consumes (name, kind, url); the full
// schema has many more (status, pid, lastRestart, lastError, spawn)
// that are out of scope here. Watchdog spec lives in a different
// codegen target, so we describe the shape locally.
export interface TopologyComponent {
  name: string;
  kind: ComponentKind;
  url: string;
}
export interface TopologyListResponse {
  components: TopologyComponent[];
}
export type ConfigSchema = OrchComponents["schemas"]["ConfigSchema"];
export type ConfigDocument = OrchComponents["schemas"]["ConfigDocument"];
export type ConfigUpdateRequest = OrchComponents["schemas"]["ConfigUpdateRequest"];
export type ConfigUpdateResult = OrchComponents["schemas"]["ConfigUpdateResult"];
export type ConfigFieldError = OrchComponents["schemas"]["ConfigFieldError"];
export type ConfigFieldShowWhen = OrchComponents["schemas"]["ConfigFieldShowWhen"];
export type ConfigTestRequest = OrchComponents["schemas"]["ConfigTestRequest"];
export type ConfigTestResult = OrchComponents["schemas"]["ConfigTestResult"];
export type ConfigValueType = OrchComponents["schemas"]["ConfigValueType"];
export type RestartResult = OrchComponents["schemas"]["RestartResult"];
