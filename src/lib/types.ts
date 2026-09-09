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
import type { components as LibraryComponents } from "@/generated/library";
import type { components as AgentComponents } from "@/generated/agent";

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

// --- Agent: topology + engine runtimes -----------------------------

export type Component = AgentComponents["schemas"]["Component"];
export type ComponentEntry = AgentComponents["schemas"]["ComponentEntry"];
export type ComponentList = AgentComponents["schemas"]["ComponentList"];
export type ComponentStatus = AgentComponents["schemas"]["ComponentStatus"];

export type Runtime = AgentComponents["schemas"]["Runtime"];
export type RuntimeSpec = AgentComponents["schemas"]["RuntimeSpec"];
export type RuntimeList = AgentComponents["schemas"]["RuntimeList"];
export type RuntimeStatus = AgentComponents["schemas"]["RuntimeStatus"];
export type RuntimeCapabilities = AgentComponents["schemas"]["RuntimeCapabilities"];
export type EngineKind = AgentComponents["schemas"]["EngineKind"];
export type EngineList = AgentComponents["schemas"]["EngineList"];
export type EngineDescriptor = AgentComponents["schemas"]["EngineDescriptor"];

// --- Library: the operator's own model directories (M2) ---------------
//
// The library holds what is on disk; the agent holds what is running.
// `EngineDescriptor.modelFormats` is the join between them — it says
// which of these formats an engine can actually load, which is how a
// safetensors model gets a greyed-out launch button naming the missing
// engine rather than one that fails.

export type LibraryModel = LibraryComponents["schemas"]["LibraryModel"];
export type LibraryModelList = LibraryComponents["schemas"]["LibraryModelList"];
export type ModelStatus = LibraryComponents["schemas"]["ModelStatus"];
export type ModelFormat = LibraryComponents["schemas"]["ModelFormat"];
export type ModelCapabilities = LibraryComponents["schemas"]["ModelCapabilities"];
export type ModelFile = LibraryComponents["schemas"]["ModelFile"];
export type GgufDetail = LibraryComponents["schemas"]["GgufDetail"];
export type SafetensorsDetail = LibraryComponents["schemas"]["SafetensorsDetail"];
export type ModelProfile = LibraryComponents["schemas"]["ModelProfile"];
export type ModelProfileSpec = LibraryComponents["schemas"]["ModelProfileSpec"];
export type ModelProfileList = LibraryComponents["schemas"]["ModelProfileList"];
export type Scan = LibraryComponents["schemas"]["Scan"];
export type ScanState = LibraryComponents["schemas"]["ScanState"];
export type ScanRoot = LibraryComponents["schemas"]["ScanRoot"];
export type SkippedPath = LibraryComponents["schemas"]["SkippedPath"];
export type SkipReason = LibraryComponents["schemas"]["SkipReason"];

// --- Library: the catalogue, downloads and guidance (M3) --------------
//
// The library's remote half. Two shapes carry most of the weight:
//
// `CatalogueCandidate` is one launchable *choice*, not one file — shards
// are already summed, and the projectors and calibration files are
// pulled out into their own lists. One real repo holds 30 `.gguf` files
// and 25 candidates.
//
// `Fit` is the same computation in three places (a candidate, a local
// model, a preflight), and `Fit.basis` is the field a UI should care
// about: `estimate` means the KV term came from the file size alone,
// `metadata` means the model's own declared shape produced it. That is
// the difference between arithmetic and a guess with a number on it,
// and it is what the Check button on a candidate exists to change.

export type CatalogueSearchPage = LibraryComponents["schemas"]["CatalogueSearchPage"];
export type CatalogueSearchResult = LibraryComponents["schemas"]["CatalogueSearchResult"];
export type CatalogueSort = LibraryComponents["schemas"]["CatalogueSort"];
export type CatalogueModel = LibraryComponents["schemas"]["CatalogueModel"];
export type CatalogueCandidate = LibraryComponents["schemas"]["CatalogueCandidate"];
export type CatalogueFile = LibraryComponents["schemas"]["CatalogueFile"];
export type CatalogueRecommendation = LibraryComponents["schemas"]["CatalogueRecommendation"];
export type CatalogueCard = LibraryComponents["schemas"]["CatalogueCard"];
export type CataloguePreflight = LibraryComponents["schemas"]["CataloguePreflight"];
export type AlreadyOwned = LibraryComponents["schemas"]["AlreadyOwned"];
export type GateKind = LibraryComponents["schemas"]["GateKind"];
export type ModelFileRole = LibraryComponents["schemas"]["ModelFileRole"];

export type Fit = LibraryComponents["schemas"]["Fit"];
export type FitVerdict = LibraryComponents["schemas"]["FitVerdict"];
export type ModelFit = LibraryComponents["schemas"]["ModelFit"];
export type MemoryBudget = LibraryComponents["schemas"]["MemoryBudget"];
export type KvCacheType = LibraryComponents["schemas"]["KvCacheType"];
export type HostHardware = LibraryComponents["schemas"]["HostHardware"];
export type Gpu = LibraryComponents["schemas"]["Gpu"];
export type QuantTable = LibraryComponents["schemas"]["QuantTable"];
export type QuantTier = LibraryComponents["schemas"]["QuantTier"];

export type Download = LibraryComponents["schemas"]["Download"];
export type DownloadList = LibraryComponents["schemas"]["DownloadList"];
export type DownloadSpec = LibraryComponents["schemas"]["DownloadSpec"];
export type DownloadFile = LibraryComponents["schemas"]["DownloadFile"];
export type DownloadState = LibraryComponents["schemas"]["DownloadState"];

// --- Agent: engine acquisition (M1) --------------------------------

export type ManagedEngine = AgentComponents["schemas"]["ManagedEngine"];
export type EngineAcquisition = AgentComponents["schemas"]["EngineAcquisition"];
export type HostAccelerator = AgentComponents["schemas"]["HostAccelerator"];
export type EngineInstall = AgentComponents["schemas"]["EngineInstall"];
export type EngineInstallRequest = AgentComponents["schemas"]["EngineInstallRequest"];
