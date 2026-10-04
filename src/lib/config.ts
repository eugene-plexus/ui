/**
 * What a proxy target is, and nothing else.
 *
 * This file used to hold the server-side resolver: the mapping from a
 * target name to a component URL, read by a Next route handler when a
 * request landed. Both moved to the agent at install-paths §9 step 1 —
 * `eugene_plexus_agent/routes/proxy.py` — where the topology is an
 * in-process object rather than a bearer-protected HTTP endpoint the
 * proxy had to authenticate against to use.
 *
 * Two fixed targets, `gateway` and `agent`; `library` and `control` are
 * resolved from the agent's topology by KIND, because an install has
 * exactly one of each; anything else is the NAME of an inference-driver
 * entry. The browser does not need to know any of that — it says what it
 * wants to talk to and the agent knows where that is.
 */

export type ProxyTarget = string;
