/**
 * Settings by topic, across every component.
 *
 * **Design:** `specs/docs/design/ui-settings-reorganisation.md` §2. The
 * five components each serve their own config schema, filed by the
 * component's own categories — the gateway's *Lifecycle policy*, the
 * agent's *Node* — and a person looking for "where do downloads go" has
 * to know which process owns the answer before the page can help. This
 * map files every field under a topic named for what a person is trying
 * to change, whichever process holds it, so one Settings page can show
 * the install's sixty settings in eleven cards and a search box can find
 * any of them.
 *
 * **Pure on purpose.** No React, no fetching: a vitest case takes the
 * schemas the five components serve and asserts every field lands
 * somewhere sensible. A field the map has never heard of lands in a
 * topic named after its own category, so a component that adds a knob
 * still gets a card rather than vanishing.
 */

import type { Selection, Topology } from "./resourceTree";
import type { ConfigField, ConfigSchema } from "./types";

export type TopicId =
  | "models"
  | "model-storage"
  | "answers"
  | "serving"
  | "engines"
  | "access"
  | "machines"
  | "apps"
  | "updates"
  | "metrics-logs"
  | "appearance";

export interface Topic {
  readonly id: TopicId;
  readonly label: string;
  /** One sentence under the card's title. */
  readonly blurb: string;
}

/** The topics, in the order the page shows them: common tasks first. */
export const TOPICS: readonly Topic[] = [
  {
    id: "models",
    label: "Models & downloads",
    blurb: "Where your models are, how they are found, downloaded and scanned.",
  },
  {
    id: "model-storage",
    label: "Model storage on each machine",
    blurb: "How a machine reaches the Library's folders, and whether it keeps its own copies.",
  },
  {
    id: "answers",
    label: "Answer defaults",
    blurb:
      "Used when an app leaves temperature or the output cap unset and the model's own settings do not fill them.",
  },
  {
    id: "serving",
    label: "Serving & failover",
    blurb:
      "How long a request may take, when an idle model is unloaded, how a stopped one is woken, and how load spreads across copies.",
  },
  {
    id: "engines",
    label: "Engines",
    blurb: "Where llama.cpp, vLLM and the others are on each machine, and what may be launched.",
  },
  {
    id: "access",
    label: "Access & security",
    blurb:
      "Unlocking at boot, the address other machines reach this one on, and which browsers may call the gateway.",
  },
  {
    id: "machines",
    label: "Machines",
    blurb: "How the install keeps track of its machines.",
  },
  { id: "apps", label: "Apps", blurb: "Installing optional apps on a machine." },
  {
    id: "updates",
    label: "Updates",
    blurb: "Whether a machine looks for new versions, and which kind.",
  },
  {
    id: "metrics-logs",
    label: "Metrics & logs",
    blurb: "What the gateway records about requests, and how much each service logs.",
  },
  {
    id: "appearance",
    label: "Appearance",
    blurb: "Theme and text size. Saved in this browser only.",
  },
] as const;

/**
 * Fields no settings page shows.
 *
 * `firstRunComplete` is the wizard's flag, written by Start and read by
 * the setup gate — a person changing it by hand gets the wizard again
 * or an install that never had one. `uiTheme` and `uiFontSize` are v0.2
 * fossils on the agent and the control root: their enum matches no real
 * theme and nothing reads them; the browser's Appearance card is the
 * setting that works. Hidden here rather than deleted from the two Python
 * schemas, so it holds against every pinned build.
 */
export const HIDDEN_KEYS: ReadonlySet<string> = new Set([
  "firstRunComplete",
  "uiTheme",
  "uiFontSize",
]);

/** By component, then by the component's own category. */
const BY_CATEGORY: Record<string, Record<string, TopicId>> = {
  agent: {
    storage: "model-storage",
    modelStorage: "model-storage",
    engines: "engines",
    security: "access",
    node: "access",
    apps: "apps",
    updates: "updates",
  },
  gateway: {
    generation: "answers",
    routing: "serving",
    lifecycle: "serving",
    metrics: "metrics-logs",
    logging: "metrics-logs",
    clients: "access",
  },
  library: {
    library: "models",
    scanning: "models",
    catalogue: "models",
    downloads: "models",
    guidance: "models",
    logging: "metrics-logs",
  },
  control: {
    security: "access",
    replication: "machines",
    topology: "machines",
    logging: "metrics-logs",
  },
};

/**
 * By key, where a category mixes two topics. The gateway files the
 * address of the control root under *Routing* because that is what reads
 * it; to a person it is about which machines are in the install.
 */
const BY_KEY: Record<string, Record<string, TopicId>> = {
  gateway: { controlUrl: "machines" },
};

/**
 * The topic a field belongs to: one of `TOPICS`, or the field's own
 * category when the map has no entry for it. The fallback keeps a new
 * knob visible under a heading the component itself named.
 */
export function topicOf(
  component: string,
  field: Pick<ConfigField, "key" | "category">,
): TopicId | string {
  const byKey = BY_KEY[component]?.[field.key];
  if (byKey) return byKey;
  const category = field.category ?? "general";
  return BY_CATEGORY[component]?.[category] ?? category;
}

export function isTopicId(id: string): id is TopicId {
  return TOPICS.some((t) => t.id === id);
}

/** The label for a topic id, or for a fallback category via the schema's own labels. */
export function topicLabel(id: string, categories?: Record<string, string> | null): string {
  const known = TOPICS.find((t) => t.id === id);
  if (known) return known.label;
  return categories?.[id] ?? id;
}

/**
 * Sort key: the known topics in their order, then the fallbacks
 * alphabetically after them.
 */
export function topicRank(id: string): number {
  const index = TOPICS.findIndex((t) => t.id === id);
  return index < 0 ? TOPICS.length : index;
}

/* ─────────────────────────────── search ────────────────────────────── */

/**
 * Every word of the query appears somewhere in the texts, case-folded.
 * An empty query matches everything. Words rather than a substring of
 * the whole, so "download folder" finds *Where downloads land* although
 * the two words are apart.
 */
export function matchesQuery(
  query: string,
  texts: ReadonlyArray<string | null | undefined>,
): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = texts
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    .join("\n")
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The texts a field is searched by. */
export function fieldSearchTexts(
  field: ConfigField,
  context: { topic: string; owner: string; categoryLabel?: string | null },
): string[] {
  return [
    field.label,
    field.description ?? null,
    field.key,
    context.categoryLabel ?? field.category ?? null,
    context.topic,
    context.owner,
  ].filter((t): t is string => typeof t === "string");
}

/* ─────────────────────────────── owners ────────────────────────────── */

/** Which component's settings a section is, and where. */
export type OwnerComponent = "gateway" | "library" | "control" | "agent";

/**
 * Whose settings a selection shows.
 *
 * The install root shows every owner the topology names -- the three
 * singletons where the tree would draw them, and every machine's agent,
 * this one first -- so the page cannot list a component the tree beside
 * it does not. A singleton chosen by name shows itself whether or not
 * the topology has answered yet: the person clicked its row, and an
 * editor that cannot reach it says so. Backends and apps have their own
 * pages and answer nothing here.
 */
export function ownersFor(selection: Selection | null, topology: Topology): SettingsOwner[] {
  const local = topology.localNode;
  const has = (kind: string) => topology.components.some((c) => c.kind === kind);
  const singleton = (component: Exclude<OwnerComponent, "agent">): SettingsOwner => ({
    id: component,
    target: component,
    component,
    label: SINGLETON_LABEL[component],
    node: topology.components.find((c) => c.kind === component)?.node ?? null,
    hint: SINGLETON_HINT[component],
  });
  const machine = (name: string | null): SettingsOwner => ({
    id: name ? `agent:${name}` : "agent",
    target: name === null || name === local ? "agent" : `node:${name}`,
    component: "agent",
    label: name ?? "This machine",
    node: name,
    hint: name !== null && name === local ? "agent · this machine" : "agent",
  });

  switch (selection?.type ?? "install") {
    case "install": {
      const out: SettingsOwner[] = [];
      if (has("library")) out.push(singleton("library"));
      if (has("gateway")) out.push(singleton("gateway"));
      if (has("control")) out.push(singleton("control"));
      const rest = topology.nodes
        .filter((n) => n && n !== local)
        .sort((a, b) => a.localeCompare(b));
      const names: (string | null)[] = local ? [local, ...rest] : rest;
      if (names.length === 0) names.push(null);
      for (const name of names) out.push(machine(name));
      return out;
    }
    case "gateway":
    case "library":
    case "control":
      return [singleton(selection!.type as Exclude<OwnerComponent, "agent">)];
    case "agent":
    case "libraryNode":
      return [machine(selection!.node)];
    default:
      return [];
  }
}

const SINGLETON_LABEL: Record<Exclude<OwnerComponent, "agent">, string> = {
  gateway: "Gateway",
  library: "Library",
  control: "Machines",
};

const SINGLETON_HINT: Record<Exclude<OwnerComponent, "agent">, string> = {
  gateway: "gateway",
  library: "library",
  control: "control root",
};

export interface SettingsOwner {
  /** Stable id for React keys and section handles. */
  id: string;
  /** The proxy target the editor addresses. */
  target: string;
  component: OwnerComponent;
  /** What the section is titled. */
  label: string;
  /** The machine, for an agent; null for a singleton or an unnamed box. */
  node: string | null;
  /** Hover text with the implementation noun, per hobbyist-ux decision #12. */
  hint: string;
}

/** The order sections take inside a card. */
const OWNER_ORDER: Record<OwnerComponent, number> = {
  library: 0,
  gateway: 1,
  control: 2,
  agent: 3,
};

export function sortOwners(owners: SettingsOwner[]): SettingsOwner[] {
  return [...owners].sort((a, b) => OWNER_ORDER[a.component] - OWNER_ORDER[b.component]);
}

/* ─────────────────────────────── cards ─────────────────────────────── */

export interface SettingsSection {
  owner: SettingsOwner;
  /** The keys the section shows, in the schema's order. */
  keys: string[];
  /** True when a key the search matched is one the editor would fold away. */
  matchedHidden: boolean;
}

export interface SettingsCard {
  topic: string;
  label: string;
  blurb: string | null;
  sections: SettingsSection[];
}

/**
 * Group every owner's visible fields into topic cards, applying the
 * search. A card with no matching field is not returned at all, which
 * is what makes the page shrink to the answer as a person types.
 *
 * `moreKeys` says which keys the editor folds under *Show more* for an
 * owner, so a match behind the fold can be opened for the person who
 * searched for it.
 */
export function buildCards(
  owners: SettingsOwner[],
  schemas: ReadonlyMap<string, ConfigSchema>,
  query: string,
  options: {
    visible?: (owner: SettingsOwner, field: ConfigField) => boolean;
    moreKeys?: (owner: SettingsOwner, fields: ConfigField[]) => ReadonlySet<string>;
  } = {},
): SettingsCard[] {
  const byTopic = new Map<string, { label: string; sections: SettingsSection[] }>();
  for (const owner of sortOwners(owners)) {
    const schema = schemas.get(owner.id);
    if (!schema) continue;
    const fields = schema.fields.filter(
      (f) => !HIDDEN_KEYS.has(f.key) && (options.visible?.(owner, f) ?? true),
    );
    const folded = options.moreKeys?.(owner, fields) ?? new Set<string>();
    const perTopic = new Map<string, { keys: string[]; matchedHidden: boolean }>();
    for (const field of fields) {
      const topic = topicOf(owner.component, field);
      const label = topicLabel(topic, schema.categories);
      const hit = matchesQuery(
        query,
        fieldSearchTexts(field, {
          topic: label,
          owner: owner.label,
          categoryLabel: schema.categories?.[field.category ?? ""] ?? null,
        }),
      );
      if (!hit) continue;
      const entry = perTopic.get(topic) ?? { keys: [], matchedHidden: false };
      entry.keys.push(field.key);
      if (query.trim() && folded.has(field.key)) entry.matchedHidden = true;
      perTopic.set(topic, entry);
    }
    for (const [topic, entry] of perTopic) {
      const card = byTopic.get(topic) ?? {
        label: topicLabel(topic, schema.categories),
        sections: [],
      };
      card.sections.push({ owner, keys: entry.keys, matchedHidden: entry.matchedHidden });
      byTopic.set(topic, card);
    }
  }
  return [...byTopic.entries()]
    .sort(([a], [b]) => topicRank(a) - topicRank(b) || a.localeCompare(b))
    .map(([topic, card]) => ({
      topic,
      label: card.label,
      blurb: TOPICS.find((t) => t.id === topic)?.blurb ?? null,
      sections: card.sections,
    }));
}

/* ─────────────────────────── the elsewhere index ───────────────────── */

/**
 * Settings that live on other pages — a switch on Home, a page of their
 * own, a form per object — so a search here can answer with a link
 * rather than with silence.
 */
export interface ElsewhereEntry {
  id: string;
  label: string;
  description: string;
  href: string;
  /** Words the search should also match, beyond the two above. */
  keywords: readonly string[];
  /** The topic card that shows this as a "see also" line, when one does. */
  topic?: TopicId;
}

const ELSEWHERE_STATIC: readonly ElsewhereEntry[] = [
  {
    id: "folders",
    label: "Library folders, and where each machine finds them",
    description: "Which folders hold models, and the path each machine opens them by.",
    href: "/library/folders?sel=library",
    keywords: ["model roots", "mount", "share", "path", "directory", "override", "nas"],
    topic: "models",
  },
  {
    id: "profile",
    label: "A model's own settings",
    description:
      "Context size, GPU layers and answer defaults for one model, which fill before these do: open it in the Library.",
    href: "/library?sel=library",
    keywords: ["profile", "context", "gpu layers", "offload", "temperature", "max tokens", "top-p"],
    topic: "answers",
  },
  {
    id: "routing",
    label: "Priority lists",
    description: "Which backends answer a model name, and what is tried when one fails.",
    href: "/routing?sel=gateway",
    keywords: ["model slots", "failover", "tier", "alias", "fallback", "cascade"],
    topic: "serving",
  },
  {
    id: "client-keys",
    label: "Keys for your apps",
    description: "Make, limit and revoke the keys your apps use, on Home.",
    href: "/#use-from-apps",
    keywords: ["client key", "api key", "token", "revoke", "limits", "connect", "base url"],
    topic: "access",
  },
  {
    id: "reach",
    label: "Reach it from other devices",
    description: "Answer on your network, and check the firewall, on Home.",
    href: "/#reach",
    keywords: ["advertise", "lan", "firewall", "phone", "tailnet", "remote", "network"],
    topic: "access",
  },
  {
    id: "people-permissions",
    label: "Each person's job-site permissions",
    description:
      "Whether one person may add machines or use job sites as themselves, beyond the defaults here: on the People page.",
    href: "/people",
    keywords: [
      "job sites",
      "permissions",
      "add job sites",
      "use job sites",
      "people",
      "workspaces",
    ],
    topic: "access",
  },
  {
    id: "machines",
    label: "Add a machine, versions and updates",
    description: "Join tokens, each machine's version and the Update button.",
    href: "/nodes?sel=control",
    keywords: ["join", "token", "node", "enroll", "version", "update", "upgrade"],
    topic: "machines",
  },
  {
    id: "add-backend",
    label: "Add a backend you already run",
    description: "Ollama, LM Studio, an OpenAI-compatible server or a cloud CLI.",
    href: "/backends/add?sel=backends",
    keywords: ["ollama", "lm studio", "openrouter", "openai", "claude", "codex", "external"],
  },
  {
    id: "engines",
    label: "Engine versions",
    description: "Install llama.cpp or pin a build, per machine, on the Backends page.",
    href: "/inference?sel=backends",
    keywords: ["llama.cpp", "vllm", "install", "build", "pin", "version"],
    topic: "engines",
  },
];

/** One backend the topology names, addressed by its own settings page. */
export interface BackendRef {
  name: string;
  node: string | null;
}

export function elsewhereIndex(backends: readonly BackendRef[] = []): ElsewhereEntry[] {
  const perBackend: ElsewhereEntry[] = backends.map((b) => ({
    id: `backend:${b.name}@${b.node ?? ""}`,
    label: `${b.name}${b.node ? ` on ${b.node}` : ""}`,
    description: "This backend's provider, model, address and API key.",
    href: `/config?sel=${encodeURIComponent(
      b.node ? `driver:${b.name}@${b.node}` : `driver:${b.name}`,
    )}`,
    keywords: ["backend", "driver", "provider", "model", "api key", "base url", "timeout"],
  }));
  return [...ELSEWHERE_STATIC, ...perBackend];
}

export function elsewhereMatches(
  entries: readonly ElsewhereEntry[],
  query: string,
): ElsewhereEntry[] {
  return entries.filter((e) => matchesQuery(query, [e.label, e.description, e.id, ...e.keywords]));
}
