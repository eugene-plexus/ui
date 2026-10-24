import type { ServingKnee, ServingWorkload } from "./servingMeasurements";

export function servingSentence(knee: ServingKnee | null, workload: ServingWorkload): string {
  if (!knee) return "No usable level measured yet.";
  const speed = Math.round(knee.tokensPerSecondEach);
  if (!knee.found)
    return `At least ${knee.people} people at ${speed} tok/s each. The limit is above ${knee.people}.`;
  if (knee.people === 1) return `One person at ${speed} tok/s. A second person slows both.`;
  const kind =
    workload === "agents" ? "agent sessions" : workload === "chat" ? "chat sessions" : "streams";
  return `${knee.people} people at ${speed} tok/s each, first token in ${(knee.ttftP50Ms / 1000).toFixed(1)} s (${kind}).`;
}
