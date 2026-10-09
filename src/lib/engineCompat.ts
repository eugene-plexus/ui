/**
 * Which engines can load a model, by format: **only for a library older than
 * `POST /v1/eligibility`**, which judges since LS1 (lib/eligibility.ts).
 *
 * Was the join, in one place.
 *
 * The format match (`EngineDescriptor.modelFormats` × `model.format`)
 * has always been a first filter and not a promise. Since the MLX slice
 * it is also not the whole filter: an MLX-quantized safetensors
 * directory packs its weights as integer tensors that only the MLX
 * loader reads, and the library marks exactly that case with
 * `safetensors.mlxQuantization` (written by `mlx_lm.convert`; vanilla
 * HF exports spell theirs `quantization_config`, a different key).
 * Offering vLLM for such a directory is a launch button that fails at
 * spawn — the thing the join exists to prevent.
 *
 * Absence of the marker means unknown, not incompatible, so a plain
 * safetensors directory keeps its full format-matched set, MLX
 * included: a vanilla HF model does load under MLX (A4, on GitHub's
 * macOS runners), and the engine's own failure is the second filter, as
 * ever.
 */

import type { EngineDescriptor, LibraryModel } from "./types";

export function capableEngines(
  model: LibraryModel,
  engines: EngineDescriptor[],
): EngineDescriptor[] {
  const formatMatched = engines.filter((e) => (e.modelFormats ?? []).includes(model.format));
  if (model.safetensors?.mlxQuantization != null) {
    return formatMatched.filter((e) => e.engine === "mlx");
  }
  return formatMatched;
}

/**
 * Whether an engine belongs on a node's engine list at all.
 *
 * An engine Eugene installs itself (llama.cpp) is always listed: there,
 * "not installable" is a reason worth reading, such as GitHub's hourly
 * limit or a build that has not been published yet.
 *
 * An engine the person installs by hand is listed only where it could
 * actually run here: available (someone pointed `mlxBinary` at a real
 * install), or carrying an install command the agent wrote for this
 * host. `manualInstall.command` is the agent's own judgment of
 * "appropriate hardware", so no platform list is hardcoded here.
 * Everywhere else the line can only say "not here": MLX on anything but
 * Apple silicon, vLLM on Windows or a Mac. On every such box it would
 * teach people to skip the engines line.
 *
 * This rule used to apply to experimental engines only. MLX stopped
 * being one on 2026-09-30 (A4, GitHub's macOS runners), and the rule is
 * about where an engine can run, not about how proven it is.
 */
export function offeredOnThisNode(e: EngineDescriptor): boolean {
  if (e.available) return true;
  const acquisition = e.acquisition;
  if (acquisition?.policy !== "manual") return true;
  return Boolean(acquisition.installable || acquisition.manualInstall?.command);
}
