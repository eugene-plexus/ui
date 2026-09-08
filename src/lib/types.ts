/**
 * Friendlier aliases over the auto-generated openapi-typescript types.
 *
 * The generated `components["schemas"]["X"]` form is precise but unwieldy
 * at call sites. Pull the handful we use into named exports here.
 *
 * Three generated modules now, one per component the UI talks to. The
 * config-editor shapes (`ConfigSchema` and friends) live in
 * `components/common.yaml` and are therefore identical in all three; we
 * source them from the gateway arbitrarily, because the editor is
 * deliberately component-agnostic.
 */

import type { components as DriverComponents } from "@/generated/inference-driver";
import type { components as GatewayComponents } from "@/generated/gateway";
import type { components as WatchdogComponents } from "@/generated/watchdog";

// --- Shared -----------------------------------------------------------

// `Role` / `Message` are the house chat shapes, which only the driver's
// surface still uses — the gateway's own wire format is OpenAI's, and
// `ChatCompletionMessage` is deliberately a separate schema so a house
// field can't leak into a payload a client parses.
export type Role = DriverComponents["schemas"]["Role"];
export type Message = DriverComponents["schemas"]["Message"];
export type Problem = GatewayComponents["schemas"]["Problem"];
export type BackendKind = GatewayComponents["schemas"]["BackendKind"];
export type ComponentKind = GatewayComponents["schemas"]["ComponentKind"];
export type RestartResult = GatewayComponents["schemas"]["RestartResult"];

// --- The config trio, rendered generically by ConfigEditor ------------

export type ConfigField = GatewayComponents["schemas"]["ConfigField"];
export type ConfigSchema = GatewayComponents["schemas"]["ConfigSchema"];
export type ConfigDocument = GatewayComponents["schemas"]["ConfigDocument"];
export type ConfigUpdateRequest = GatewayComponents["schemas"]["ConfigUpdateRequest"];
export type ConfigUpdateResult = GatewayComponents["schemas"]["ConfigUpdateResult"];
export type ConfigFieldError = GatewayComponents["schemas"]["ConfigFieldError"];
export type ConfigFieldShowWhen = GatewayComponents["schemas"]["ConfigFieldShowWhen"];
export type ConfigTestRequest = GatewayComponents["schemas"]["ConfigTestRequest"];
export type ConfigTestResult = GatewayComponents["schemas"]["ConfigTestResult"];
export type ConfigValueType = GatewayComponents["schemas"]["ConfigValueType"];

// --- Gateway: the OpenAI-compatible surface ---------------------------
//
// snake_case on purpose. This is the one contract in Eugene Plexus we
// don't own the shape of, and "OpenAI-compatible" is worth nothing if a
// field name differs. Don't camelCase these on the way through.

export type ModelList = GatewayComponents["schemas"]["ModelList"];
export type Model = GatewayComponents["schemas"]["Model"];
export type ModelRoutingInfo = GatewayComponents["schemas"]["ModelRoutingInfo"];
export type ChatCompletionRequest = GatewayComponents["schemas"]["ChatCompletionRequest"];
export type ChatCompletionResponse = GatewayComponents["schemas"]["ChatCompletionResponse"];
export type ChatCompletionMessage = GatewayComponents["schemas"]["ChatCompletionMessage"];
export type CompletionUsage = GatewayComponents["schemas"]["CompletionUsage"];
export type CompletionRoutingInfo = GatewayComponents["schemas"]["CompletionRoutingInfo"];

// The OpenAI error envelope, which the gateway returns instead of RFC
// 7807 on `/v1/chat/completions` and `/v1/models` — SDKs parse this
// shape to build their exception types.
export type OpenAIErrorResponse = GatewayComponents["schemas"]["OpenAIErrorResponse"];

// --- Gateway: admin view over the derived routing table ---------------

export type DriversInfo = GatewayComponents["schemas"]["DriversInfo"];
export type DriverHealth = GatewayComponents["schemas"]["DriverHealth"];

// --- Watchdog: topology + engine runtimes -----------------------------

export type Component = WatchdogComponents["schemas"]["Component"];
export type ComponentEntry = WatchdogComponents["schemas"]["ComponentEntry"];
export type ComponentList = WatchdogComponents["schemas"]["ComponentList"];
export type ComponentStatus = WatchdogComponents["schemas"]["ComponentStatus"];

export type Runtime = WatchdogComponents["schemas"]["Runtime"];
export type RuntimeSpec = WatchdogComponents["schemas"]["RuntimeSpec"];
export type RuntimeList = WatchdogComponents["schemas"]["RuntimeList"];
export type RuntimeStatus = WatchdogComponents["schemas"]["RuntimeStatus"];
export type RuntimeCapabilities = WatchdogComponents["schemas"]["RuntimeCapabilities"];
export type EngineKind = WatchdogComponents["schemas"]["EngineKind"];
export type EngineList = WatchdogComponents["schemas"]["EngineList"];
export type EngineDescriptor = WatchdogComponents["schemas"]["EngineDescriptor"];

// --- Watchdog: engine acquisition (M1) --------------------------------

export type ManagedEngine = WatchdogComponents["schemas"]["ManagedEngine"];
export type EngineAcquisition = WatchdogComponents["schemas"]["EngineAcquisition"];
export type HostAccelerator = WatchdogComponents["schemas"]["HostAccelerator"];
export type EngineInstall = WatchdogComponents["schemas"]["EngineInstall"];
export type EngineInstallRequest = WatchdogComponents["schemas"]["EngineInstallRequest"];
