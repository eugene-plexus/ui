/**
 * Friendlier aliases over the auto-generated openapi-typescript types.
 *
 * The generated `components["schemas"]["X"]` form is precise but unwieldy
 * at call sites. Pull the handful we use into named exports here.
 */

import type { components as OrchComponents } from "@/generated/orchestrator";

export type Role = OrchComponents["schemas"]["Role"];
export type Hemisphere = OrchComponents["schemas"]["Hemisphere"];
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
export type HemispherePairInfo = OrchComponents["schemas"]["HemispherePairInfo"];
export type HemisphereInfo = OrchComponents["schemas"]["HemisphereInfo"];
export type NTState = OrchComponents["schemas"]["NTState"];
export type Problem = OrchComponents["schemas"]["Problem"];

export type ConfigField = OrchComponents["schemas"]["ConfigField"];
export type ConfigSchema = OrchComponents["schemas"]["ConfigSchema"];
export type ConfigDocument = OrchComponents["schemas"]["ConfigDocument"];
export type ConfigUpdateRequest = OrchComponents["schemas"]["ConfigUpdateRequest"];
export type ConfigUpdateResult = OrchComponents["schemas"]["ConfigUpdateResult"];
export type ConfigFieldError = OrchComponents["schemas"]["ConfigFieldError"];
export type ConfigValueType = OrchComponents["schemas"]["ConfigValueType"];
