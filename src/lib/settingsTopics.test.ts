/**
 * The topic map, against the schemas the five components serve.
 *
 * The fixtures below are the field lists each component's own venv
 * printed on 2026-09-29 (`ui-settings-reorganisation.md` §0.1), so a
 * knob added since lands here as a fallback rather than silently. What
 * is asserted is the property the page depends on: every field the
 * components serve has a topic, the three dead or internal ones have
 * none, and the search finds a field by any of the words a person has.
 */

import { describe, expect, it } from "vitest";

import type { Topology } from "./resourceTree";
import {
  buildCards,
  elsewhereIndex,
  elsewhereMatches,
  HIDDEN_KEYS,
  isTopicId,
  matchesQuery,
  ownersFor,
  TOPICS,
  topicLabel,
  topicOf,
  topicRank,
  type SettingsOwner,
} from "./settingsTopics";
import type { ConfigField, ConfigSchema } from "./types";

/** `key:category` per component, as served on the day of writing. */
const SERVED: Record<string, string[]> = {
  agent: [
    "firstRunComplete:setup",
    "securityMode:security",
    "uiTheme:ui",
    "uiFontSize:ui",
    "engineBinaryRoots:engines",
    "allowUnrestrictedEngineLaunch:engines",
    "vllmBinary:engines",
    "uvBinary:apps",
    "allowCustomApps:apps",
    "mlxBinary:engines",
    "kevPython:engines",
    "advertiseUrl:node",
    "allowedHosts:node",
    "pathMappings:storage",
    "shareCredentials:storage",
    "modelCopyEnabled:modelStorage",
    "modelCopyDir:modelStorage",
    "modelCopyMinFreeGb:modelStorage",
    "updateChecks:updates",
    "updateChannel:updates",
  ],
  gateway: [
    "defaultTemperature:generation",
    "defaultMaxTokens:generation",
    "profileCacheSeconds:generation",
    "profileMaxStaleSeconds:generation",
    "requestTimeoutSeconds:routing",
    "routingRefreshSeconds:routing",
    "decisionMaxQuestions:routing",
    "maxImagesPerRequest:routing",
    "modelSlots:lifecycle",
    "loadBalancing:lifecycle",
    "swapWaitSeconds:lifecycle",
    "idleCheckSeconds:lifecycle",
    "controlUrl:routing",
    "logLevel:logging",
    "metricsEnabled:metrics",
    "metricsRetentionDays:metrics",
    "metricsRollupEnabled:metrics",
    "corsEnabled:clients",
    "corsAllowedOrigins:clients",
  ],
  library: [
    "modelRoots:library",
    "scanOnStartup:scanning",
    "followSymlinks:scanning",
    "catalogueEnabled:catalogue",
    "catalogueBaseUrl:catalogue",
    "hfToken:catalogue",
    "downloadLayout:downloads",
    "maxConcurrentDownloads:downloads",
    "guidanceContextLength:guidance",
    "starterModelsFile:guidance",
    "logLevel:logging",
  ],
  control: [
    "firstRunComplete:setup",
    "securityMode:security",
    "standbyUrls:replication",
    "nodePollIntervalSeconds:topology",
    "nodeRequestTimeoutSeconds:topology",
    "joinTokenTtlSeconds:security",
    "uiTheme:ui",
    "uiFontSize:ui",
    "logLevel:logging",
  ],
};

function field(key: string, category: string, extra: Partial<ConfigField> = {}): ConfigField {
  return {
    key,
    label: key,
    category,
    valueType: "string",
    ...extra,
  } as ConfigField;
}

function schemaOf(component: string): ConfigSchema {
  return {
    component,
    fields: SERVED[component]!.map((entry) => {
      const [key, category] = entry.split(":") as [string, string];
      return field(key, category);
    }),
    categories: {},
  } as ConfigSchema;
}

describe("every served field has a topic", () => {
  it("files each of the sixty real settings under one of the eleven topics", () => {
    for (const [component, entries] of Object.entries(SERVED)) {
      for (const entry of entries) {
        const [key, category] = entry.split(":") as [string, string];
        if (HIDDEN_KEYS.has(key)) continue;
        const topic = topicOf(component, { key, category });
        expect(isTopicId(topic), `${component}.${key} (${category}) fell through to ${topic}`).toBe(
          true,
        );
      }
    }
  });

  it("hides exactly the wizard's flag and the two dead appearance knobs", () => {
    expect([...HIDDEN_KEYS].sort()).toEqual(["firstRunComplete", "uiFontSize", "uiTheme"]);
    // Six of the sixty-six served fields.
    const hidden = Object.values(SERVED)
      .flat()
      .filter((entry) => HIDDEN_KEYS.has(entry.split(":")[0]!));
    expect(hidden).toHaveLength(6);
  });

  it("files the control root's address under Machines, not under the gateway's Routing", () => {
    expect(topicOf("gateway", { key: "controlUrl", category: "routing" })).toBe("machines");
    expect(topicOf("gateway", { key: "requestTimeoutSeconds", category: "routing" })).toBe(
      "serving",
    );
  });

  it("puts the two security modes and the gateway's CORS in one topic", () => {
    expect(topicOf("agent", { key: "securityMode", category: "security" })).toBe("access");
    expect(topicOf("control", { key: "securityMode", category: "security" })).toBe("access");
    expect(topicOf("gateway", { key: "corsEnabled", category: "clients" })).toBe("access");
    expect(topicOf("agent", { key: "advertiseUrl", category: "node" })).toBe("access");
  });

  it("lets a knob the map has never heard of fall back to its own category, labelled by the schema", () => {
    expect(topicOf("library", { key: "newThing", category: "experiments" })).toBe("experiments");
    expect(topicLabel("experiments", { experiments: "Experiments" })).toBe("Experiments");
    expect(topicLabel("experiments", null)).toBe("experiments");
    // After every known topic, so the page's order stays the plan's.
    expect(topicRank("experiments")).toBe(TOPICS.length);
    expect(topicRank("models")).toBe(0);
  });

  it("orders the topics common tasks first and appearance last", () => {
    expect(TOPICS.map((t) => t.id)).toEqual([
      "models",
      "model-storage",
      "answers",
      "serving",
      "engines",
      "access",
      "machines",
      "apps",
      "updates",
      "metrics-logs",
      "appearance",
    ]);
  });
});

describe("the search", () => {
  it("matches every word, in any order, in any of the texts", () => {
    expect(matchesQuery("download folder", ["Where downloads land", "a folder per model"])).toBe(
      true,
    );
    expect(matchesQuery("folder download", ["Where downloads land", "a folder per model"])).toBe(
      true,
    );
    expect(matchesQuery("download rocket", ["Where downloads land"])).toBe(false);
    expect(matchesQuery("", [])).toBe(true);
    expect(matchesQuery("   ", ["x"])).toBe(true);
    expect(matchesQuery("HF", [null, undefined, "hfToken"])).toBe(true);
  });

  it("finds the settings that live on other pages, by the words a person has", () => {
    const index = elsewhereIndex([{ name: "ollama-qwen", node: "Amish_Station" }]);
    expect(elsewhereMatches(index, "api key").map((e) => e.id)).toEqual([
      "client-keys",
      "backend:ollama-qwen@Amish_Station",
    ]);
    expect(elsewhereMatches(index, "firewall").map((e) => e.id)).toEqual(["reach"]);
    expect(elsewhereMatches(index, "join token").map((e) => e.id)).toEqual(["machines"]);
    // The standby has no setting of its own any more (standbyUrls retired),
    // so a search for it has to answer with the Machines page.
    expect(elsewhereMatches(index, "standby").map((e) => e.id)).toEqual(["standby"]);
    expect(elsewhereMatches(index, "replication")[0]?.href).toBe("/nodes?sel=control#standby");
    // A search for Google finds the search accounts (and the backends page,
    // which also takes a Gemini key).
    expect(elsewhereMatches(index, "google").map((e) => e.id)).toContain("search-accounts");
    expect(elsewhereMatches(index, "web search order")[0]?.href).toBe(
      "/backends/search?sel=backends",
    );
    expect(elsewhereMatches(index, "nothing like this")).toEqual([]);
    // A backend's entry opens that backend's own settings page.
    expect(index.at(-1)?.href).toBe("/config?sel=driver%3Aollama-qwen%40Amish_Station");
  });
});

/* ─────────────────────────────── owners ────────────────────────────── */

const TWO_MACHINE: Topology = {
  localNode: "Amish_Station",
  nodes: ["nas", "Amish_Station"],
  components: [
    { name: "gateway", kind: "gateway", node: "nas" },
    { name: "library", kind: "library", node: "nas" },
    { name: "control", kind: "control", node: "nas" },
    { name: "ollama-qwen", kind: "inference-driver", node: "Amish_Station" },
  ],
};

const STANDALONE: Topology = {
  localNode: null,
  nodes: [],
  components: [
    { name: "gateway", kind: "gateway", node: null },
    { name: "library", kind: "library", node: null },
    { name: "control", kind: "control", node: null },
  ],
};

describe("whose settings a selection shows", () => {
  it("shows every owner for the install, singletons first, this machine before the others", () => {
    const owners = ownersFor({ type: "install", node: null, name: null }, TWO_MACHINE);
    expect(owners.map((o) => [o.id, o.target])).toEqual([
      ["library", "library"],
      ["gateway", "gateway"],
      ["control", "control"],
      ["agent:Amish_Station", "agent"],
      ["agent:nas", "node:nas"],
    ]);
    expect(owners.find((o) => o.id === "agent:Amish_Station")?.hint).toBe("agent · this machine");
    expect(owners.find((o) => o.id === "control")?.label).toBe("Machines");
  });

  it("names the nameless box This machine, through the local agent", () => {
    const owners = ownersFor(null, STANDALONE);
    expect(owners.map((o) => o.id)).toEqual(["library", "gateway", "control", "agent"]);
    expect(owners.at(-1)?.label).toBe("This machine");
    expect(owners.at(-1)?.target).toBe("agent");
  });

  it("omits a singleton the topology does not name, so the page cannot list what the tree does not", () => {
    const sealed: Topology = {
      localNode: "Amish_Station",
      nodes: [],
      rootUnreachable: true,
      components: [],
    };
    expect(ownersFor(null, sealed).map((o) => o.id)).toEqual(["agent:Amish_Station"]);
  });

  it("shows one object's share when one is selected, whether or not the topology has answered", () => {
    expect(
      ownersFor({ type: "gateway", node: null, name: null }, STANDALONE).map((o) => o.id),
    ).toEqual(["gateway"]);
    expect(
      ownersFor({ type: "agent", node: "nas", name: null }, TWO_MACHINE).map((o) => o.target),
    ).toEqual(["node:nas"]);
    expect(
      ownersFor({ type: "libraryNode", node: "nas", name: null }, TWO_MACHINE).map((o) => o.target),
    ).toEqual(["node:nas"]);
    // A backend and the Backends rows answer nothing here.
    expect(ownersFor({ type: "driver", node: "nas", name: "x" }, TWO_MACHINE)).toEqual([]);
    expect(ownersFor({ type: "backends", node: null, name: null }, TWO_MACHINE)).toEqual([]);
  });
});

/* ─────────────────────────────── cards ─────────────────────────────── */

describe("the cards", () => {
  const owners: SettingsOwner[] = ownersFor(
    { type: "install", node: null, name: null },
    TWO_MACHINE,
  );
  const schemas = new Map<string, ConfigSchema>([
    ["library", schemaOf("library")],
    ["gateway", schemaOf("gateway")],
    ["control", schemaOf("control")],
    ["agent:Amish_Station", schemaOf("agent")],
    ["agent:nas", schemaOf("agent")],
  ]);

  it("puts every owner's share of a topic in one card, in the plan's order", () => {
    const cards = buildCards(owners, schemas, "");
    expect(cards.map((c) => c.topic)).toEqual([
      "models",
      "model-storage",
      "answers",
      "serving",
      "engines",
      "access",
      "machines",
      "apps",
      "updates",
      "metrics-logs",
    ]);
    const access = cards.find((c) => c.topic === "access")!;
    expect(access.sections.map((s) => [s.owner.id, s.keys])).toEqual([
      ["gateway", ["corsEnabled", "corsAllowedOrigins"]],
      ["control", ["securityMode", "joinTokenTtlSeconds"]],
      ["agent:Amish_Station", ["securityMode", "advertiseUrl", "allowedHosts"]],
      ["agent:nas", ["securityMode", "advertiseUrl", "allowedHosts"]],
    ]);
    // Engines is per machine: two sections, one per agent.
    const engines = cards.find((c) => c.topic === "engines")!;
    expect(engines.sections.map((s) => s.owner.label)).toEqual(["Amish_Station", "nas"]);
  });

  it("never shows a hidden key, whichever owner serves it", () => {
    const shown = buildCards(owners, schemas, "").flatMap((c) => c.sections.flatMap((s) => s.keys));
    for (const key of HIDDEN_KEYS) expect(shown).not.toContain(key);
  });

  it("shrinks to the cards a search matches, and says when a match is behind the fold", () => {
    const folded = (owner: SettingsOwner) =>
      owner.component === "agent" ? new Set(["vllmBinary"]) : new Set<string>();
    const cards = buildCards(owners, schemas, "vllm", { moreKeys: folded });
    expect(cards.map((c) => c.topic)).toEqual(["engines"]);
    expect(cards[0]!.sections.map((s) => [s.owner.id, s.keys, s.matchedHidden])).toEqual([
      ["agent:Amish_Station", ["vllmBinary"], true],
      ["agent:nas", ["vllmBinary"], true],
    ]);
    // With nothing typed, nothing is reported as matched-behind-the-fold.
    const all = buildCards(owners, schemas, "", { moreKeys: folded });
    expect(all.every((c) => c.sections.every((s) => !s.matchedHidden))).toBe(true);
  });

  it("matches on the topic and the owner as well as the field", () => {
    expect(buildCards(owners, schemas, "updates").map((c) => c.topic)).toEqual(["updates"]);
    const nas = buildCards(owners, schemas, "nas");
    expect(nas.every((c) => c.sections.every((s) => s.owner.id === "agent:nas"))).toBe(true);
    expect(buildCards(owners, schemas, "zzz-nothing")).toEqual([]);
  });

  it("leaves out a field whose showWhen condition the document does not meet", () => {
    const withCondition = new Map(schemas);
    withCondition.set("gateway", {
      ...schemaOf("gateway"),
      fields: [
        field("corsEnabled", "clients"),
        field("corsAllowedOrigins", "clients", { showWhen: { key: "corsEnabled", equals: true } }),
      ],
    } as ConfigSchema);
    const cards = buildCards([owners[1]!], withCondition, "", {
      visible: (_owner, f) => !f.showWhen,
    });
    expect(cards.find((c) => c.topic === "access")?.sections[0]?.keys).toEqual(["corsEnabled"]);
  });
});
