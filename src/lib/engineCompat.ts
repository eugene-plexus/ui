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
 * The engines installed on the node that cannot load this model, each
 * with why. A profile's engine list holds only `capableEngines`, so an
 * engine someone has just installed was simply missing from it, with
 * nothing saying why (Strata on Amish_Station, 2026-10-09).
 */
export function installedButNotFor(
  model: LibraryModel,
  engines: EngineDescriptor[],
): { engine: string; why: string }[] {
  const capable = new Set(capableEngines(model, engines).map((e) => e.engine));
  return engines
    .filter((e) => e.available && !capable.has(e.engine))
    .map((e) => {
      const formats = e.modelFormats ?? [];
      const why =
        formats.length === 0
          ? e.engine === "strata"
            ? "runs only prepared Strata models, not Library files. Add one under Backends, in this machine's Strata section."
            : "runs only models prepared for it, not Library files."
          : formats.includes(model.format)
            ? "cannot load MLX-quantized weights; only the mlx engine reads them."
            : `loads ${formats.join(" or ")} models, and this one is ${model.format}.`;
      return { engine: e.engine, why };
    });
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
