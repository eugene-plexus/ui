/**
 * A model plus a profile, as the runtime declaration the agent takes.
 *
 * Lifted out of `ProfileEditor` for S3 (hobbyist UX §7): one-click Run
 * composes exactly the spec the profile editor's Launch button does, so
 * the two cannot drift -- what the launch panel predicts for a profile is
 * what Run sends, and a runtime Run declared is one the editor recognises.
 * Pure, so the composition is testable as data.
 */

import type { LibraryModel, ModelProfile, ModelProfileSpec, RuntimeSpec } from "./types";

/**
 * What `POST /v1/runtimes` genuinely requires.
 *
 * The spec's `RuntimeSpec.required` is `[name, engine, modelPath]`;
 * everything else is optional with a server-side default. The generated
 * type disagrees — openapi-typescript marks a property non-optional as
 * soon as it carries a `default`, which is right for a response and
 * wrong for a request body. Narrowing here rather than satisfying the
 * generated shape keeps `host` out of the UI, where a second copy of
 * "engines bind loopback" would eventually disagree with the agent's.
 */
export type RuntimeCreate = Pick<RuntimeSpec, "name" | "engine" | "modelPath"> &
  Partial<Omit<RuntimeSpec, "name" | "engine" | "modelPath">>;

/**
 * The composition this whole layering exists for: the model's path from
 * the library, the flags from the profile, as a runtime declaration.
 * Field names line up one for one, so nothing here translates.
 *
 * `host` and `port` are deliberately absent. The agent binds loopback
 * and assigns a port from its own range, and restating either here
 * would put a second source of truth in the UI for something the
 * supervisor owns. `autoStart` IS sent, because pressing Launch is the
 * choice it encodes -- and Run's Skip (decision #6) is the one caller
 * that sends it false: the runtime is declared and left stopped until
 * an engine exists to start it with.
 */
export function composeSpec(
  model: LibraryModel,
  profile: ModelProfile,
  options: { autoStart?: boolean } = {},
): RuntimeCreate {
  return {
    name: runtimeName(model, profile),
    engine: profile.engine,
    modelPath: model.path,
    flags: profile.flags ?? undefined,
    extraArgs: profile.extraArgs ?? undefined,
    env: profile.env ?? undefined,
    autoStart: options.autoStart ?? true,
  };
}

/**
 * A runtime name derived from the model and profile.
 *
 * Runtime names are unique per install and operator-facing, so this aims
 * for recognisable rather than clever. A collision surfaces as a 409
 * from the agent with a message saying so, which is a better outcome
 * than silently adopting an existing runtime that has different flags.
 */
export function runtimeName(model: LibraryModel, profile: Pick<ModelProfile, "name" | "default">) {
  const base = model.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const suffix = profile.default
    ? ""
    : `-${profile.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return `${base}${suffix}`.slice(0, 60).replace(/-$/, "");
}

/** The name Run gives the profile it makes. Also what the profile form
 * proposes for a model's first profile, so the two paths meet. */
export const DEFAULT_PROFILE_NAME = "default";

/**
 * The profile Run saves when a model has none (decision #5): the chosen
 * engine, marked default, and `contextSize` at the largest context that
 * fits entirely on the target device when the agent named one below the
 * model's own. The same rule the profile form's prefill applies
 * (`ProfileEditor`), because the two must reach the same number for the
 * same file on the same machine.
 *
 * Nothing else is set: the engine's defaults are the engine's, and a
 * profile that spelled them out would pin a value the adapter might
 * later improve.
 */
export function defaultProfileSpec(
  engine: ModelProfileSpec["engine"],
  suggestedContext: number | null,
): ModelProfileSpec {
  return {
    name: DEFAULT_PROFILE_NAME,
    engine,
    default: true,
    flags: suggestedContext != null ? { contextSize: suggestedContext } : {},
    extraArgs: [],
    env: {},
  };
}

/**
 * `maxContextLength` from an admission answer, as a prefill: the number
 * when it is positive and below the model's own context (or the model
 * did not say), null when the model's own context fits or nobody could
 * say. Shared by Run and the profile form.
 */
export function contextPrefill(
  maxContextLength: number | null | undefined,
  modelContextLength: number | null | undefined,
): number | null {
  if (typeof maxContextLength !== "number" || maxContextLength <= 0) return null;
  if (modelContextLength != null && maxContextLength >= modelContextLength) return null;
  return maxContextLength;
}
