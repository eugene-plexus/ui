import type { EngineDescriptor } from "./types";

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
