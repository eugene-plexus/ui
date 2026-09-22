/**
 * Which engines can load a model — the join, in one place.
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
 * included: whether a vanilla HF model loads under MLX is one of the
 * pending physical-Mac questions and the engine's own failure is the
 * second filter, as ever.
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
 * An experimental engine is shown only where it could actually run:
 * available (someone pointed `mlxBinary` at a real install), or
 * installable, or carrying a real install command for this host — the
 * agent's `manualInstall.command` is its own judgment of "appropriate
 * hardware", so no platform list is hardcoded here. Everywhere else the
 * option is noise: "mlx: not installed (not installable here)" on every
 * Windows box in an install would teach people to skip the line.
 */
export function offeredOnThisNode(e: EngineDescriptor): boolean {
  if (!e.experimental) return true;
  return Boolean(
    e.available || e.acquisition?.installable || e.acquisition?.manualInstall?.command,
  );
}
