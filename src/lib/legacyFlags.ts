/**
 * A profile's flags as today's settings read them (agent#6).
 *
 * `flashAttention` was a checkbox. It is now On, Off or not set, where not
 * set means llama.cpp decides (auto). A profile saved as a checkbox keeps
 * what it did: `true` always sent on, so it is "on"; `false` always sent
 * nothing, which was llama.cpp's own choice, so it is not set -- never
 * "off", which would turn it off in every profile saved before.
 */
export function currentFlags(flags: Record<string, unknown>): Record<string, unknown> {
  const out = { ...flags };
  if (out.flashAttention === true) out.flashAttention = "on";
  else if (out.flashAttention === false) delete out.flashAttention;
  return out;
}

/** One flag's value as today's settings read it. */
export function currentFlag(key: string, value: unknown): unknown {
  return currentFlags({ [key]: value })[key];
}
