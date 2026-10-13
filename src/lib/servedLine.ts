/**
 * One line of "Serves" on Machines: the model, and what state it is in.
 *
 * Troy, 2026-10-13, of `qwen3.8-flash-next-iq2_xsvia qwen3-8-flash-next-iq2-xs-driver
 * (qwen3-8-flash-next-iq2-xs, stopped)`: "When the driver has the same name
 * as the model, I don't need to see both. It buries the lead (which is the
 * state of the model)." The line leads with the model and its state; the
 * driver is named only when its name tells a person something the model's
 * does not, and the runtime stays in the tooltip with the rest of the
 * plumbing.
 */

export interface ServedInput {
  /** The inference driver's name. */
  driver: string;
  /** What the gateway says it serves; null while it has not said. */
  model: string | null;
  /** The engine process behind it, when Eugene runs one. */
  runtime: string | null;
  /** Whether the gateway reached the driver; null when it does not know. */
  reachable: boolean | null;
  /** The runtime's own status word: `ready`, `stopped`, `loading`... */
  status: string | null;
}

export interface ServedLine {
  /** What is served: the model, or the driver when no model is named. */
  lead: string;
  /** The state, in the word a person uses; null when nothing is known. */
  state: string | null;
  tone: "good" | "bad" | "muted";
  /** The driver, only when its name adds to the model's. */
  via: string | null;
  /** The names behind the line, for hover. */
  title: string;
}

/**
 * A name as it compares: lower case, letters and digits only, and no
 * trailing "driver". `qwen3-8-flash-next-iq2-xs-driver` and
 * `qwen3.8-flash-next-iq2_xs` are the same name to a person.
 */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/driver$/, "");
}

/**
 * Whether `name` says nothing the model's own name does not: the same name,
 * or a shortened form of it (a publisher dropped, a quant kept). An account
 * driver `anthropic` beside `anthropic/… (12 models)` is the second kind.
 */
export function repeatsModel(name: string, model: string): boolean {
  const driver = nameKey(name);
  const served = nameKey(model);
  if (driver === "" || driver === served) return true;
  // A short name is a prefix of too many models to say it is theirs.
  return driver.length >= 4 && (served.startsWith(driver) || served.endsWith(driver));
}

export function describeServed(served: ServedInput): ServedLine {
  const lead = served.model ?? served.driver;
  // The runtime's own word, except that a driver nobody can reach is not
  // "ready" whatever the runtime says. Anything else already explains why it
  // is not reached: a stopped model is unreachable, and "stopped" is the cause.
  const state = !served.status
    ? served.reachable === false
      ? "unreachable"
      : null
    : served.status === "ready" && served.reachable === false
      ? "unreachable"
      : served.status;
  const via =
    served.model !== null && !repeatsModel(served.driver, served.model) ? served.driver : null;
  const names = [`driver ${served.driver}`, served.runtime ? `runtime ${served.runtime}` : null];
  return {
    lead,
    state,
    tone:
      state === "ready" ? "good" : state === "crashed" || state === "unreachable" ? "bad" : "muted",
    via,
    title: names.filter(Boolean).join(", "),
  };
}
