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
export type ChatRequest = OrchComponents["schemas"]["ChatRequest"];
export type ChatResponse = OrchComponents["schemas"]["ChatResponse"];
export type CallosumState = OrchComponents["schemas"]["CallosumState"];
export type PassRecord = OrchComponents["schemas"]["PassRecord"];
export type DriversInfo = OrchComponents["schemas"]["DriversInfo"];
export type DriverHealth = OrchComponents["schemas"]["DriverHealth"];

// `DriverEntry` is defined in common.yaml but openapi-typescript only
// inlines schemas reachable via $ref from the per-component spec file,
// and orchestrator.yaml doesn't reference it directly. The shape is
// trivial so we type it by hand here. If a future spec change adds a
// $ref, drop this in favor of OrchComponents["schemas"]["DriverEntry"].
export interface DriverEntry {
  name: string;
  url: string;
}
export type NTState = OrchComponents["schemas"]["NTState"];
export type Problem = OrchComponents["schemas"]["Problem"];

export type ConfigField = OrchComponents["schemas"]["ConfigField"];
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
