import type { Runtime, RuntimeSpec } from "./types";

/** What a runtime declares, the keys of `RuntimeSpec`. */
const SPEC_KEYS = [
  "name",
  "engine",
  "modelPath",
  "modelAlias",
  "mode",
  "host",
  "port",
  "autoStart",
  "autoDriver",
  "idleUnloadSeconds",
  "startOnDemand",
  "flags",
  "extraArgs",
  "env",
  "workingDirectory",
  "profile",
] as const;

/**
 * The runtime's declaration without its `binary`: what `PATCH
 * /v1/runtimes/{name}` is sent so it runs Eugene's own build of its engine,
 * when Eugene's own account will not run the program `binary` names
 * (`Runtime.refusedBinary`, row 8). Only what the runtime declares is sent,
 * never what the node reports about its process.
 */
export function ownBuildSpec(runtime: Runtime): RuntimeSpec {
  const spec: Record<string, unknown> = {};
  for (const key of SPEC_KEYS) {
    const value = (runtime as Record<string, unknown>)[key];
    if (value !== undefined && value !== null) spec[key] = value;
  }
  return spec as RuntimeSpec;
}
