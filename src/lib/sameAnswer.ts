import type { Runtime } from "./types";

/** DI7: the agent snapshots this launch field after the expert overrides. */
export function sameAnswerLine(
  runtime: Pick<Runtime, "engine" | "status" | "flags"> | null | undefined,
): string | null {
  if (!runtime || !["starting", "loading", "ready"].includes(runtime.status)) return null;
  const enabled = runtime.flags?.sameAnswerEveryTime;
  if (typeof enabled !== "boolean") return null;
  if (!enabled) return "Same answer every time: off.";
  return runtime.engine === "llama_cpp"
    ? "Same answer every time: on; one request at a time; others wait."
    : "Same answer every time: batch-invariant mode on.";
}
