import { describe, expect, it } from "vitest";

import { blockers, clientKeyTarget, curlLine, keyLabel, keyStatus, recipes } from "./clientKeys";
import type { ComponentPlacementList } from "./types";

// A JWT's shape, with no entropy in it. The obvious fixture --
// `eyJhbGciOiJIUzI1NiJ9.abc.def` -- scored 4.11 on gitleaks' generic
// API-key rule and turned this repo's secret scan red from S4 until
// somebody looked, which is the real cost: a scanner nobody believes
// stops being a scanner. The recipes only ever substitute this string
// verbatim, so its entropy is not the subject of any test here.
const FAKE_TOKEN = "eyJhbGciOiJIUzI1NiJ9.EXAMPLE-NOT-A-REAL-TOKEN.EXAMPLE";

const STRINGS = {
  baseUrl: "http://192.168.1.20:8080/v1",
  key: FAKE_TOKEN,
  model: "Qwen3-14B-Q6_K_XL",
};

function placement(rows: Array<{ node: string; kind: string; name?: string }>) {
  return {
    components: rows.map((r) => ({ node: r.node, name: r.name ?? r.kind, kind: r.kind })),
  } as unknown as ComponentPlacementList;
}

describe("clientKeyTarget", () => {
  it("addresses the gateway's node when it is not this one", () => {
    const where = clientKeyTarget(
      placement([
        { node: "nas", kind: "gateway" },
        { node: "amish", kind: "library" },
      ]),
      "amish",
    );
    expect(where.target).toBe("node:nas");
    expect(where.node).toBe("nas");
    expect(where.derived).toBe("gateway-node");
  });

  it("stays local when the gateway is on this node", () => {
    const where = clientKeyTarget(placement([{ node: "amish", kind: "gateway" }]), "amish");
    expect(where.target).toBe("agent");
    expect(where.node).toBe("amish");
  });

  it("falls back to the local agent when the control root did not answer", () => {
    // The commonest case there is: a standalone box, where the local
    // agent IS the gateway's agent and there is no registry at all.
    const where = clientKeyTarget(null, null);
    expect(where.target).toBe("agent");
    expect(where.derived).toBe("local");
  });

  it("falls back when the root answered but names no gateway", () => {
    const where = clientKeyTarget(placement([{ node: "nas", kind: "library" }]), "amish");
    expect(where.target).toBe("agent");
    expect(where.derived).toBe("local");
  });
});

describe("keyStatus", () => {
  const now = new Date("2026-09-15T12:00:00Z");

  it("says how long a live key has", () => {
    const s = keyStatus(
      { createdAt: "2026-09-15T12:00:00Z", expiresAt: "2027-09-15T12:00:00Z" },
      now,
    );
    expect(s.tone).toBe("ok");
    expect(s.text).toContain("made");
    expect(s.text).toContain("good until");
  });

  it("warns when a key is nearly out", () => {
    const s = keyStatus(
      { createdAt: "2026-09-01T12:00:00Z", expiresAt: "2026-09-20T12:00:00Z" },
      now,
    );
    expect(s.tone).toBe("warn");
    expect(s.text).toContain("5 days");
  });

  it("separates 'you turned this off' from 'this ran out'", () => {
    // Two different next steps: one is undone by making another key, the
    // other by making another key AND knowing nobody revoked it.
    const revoked = keyStatus(
      {
        createdAt: "2026-09-01T12:00:00Z",
        expiresAt: "2027-09-01T12:00:00Z",
        revokedAt: "2026-09-10T12:00:00Z",
      },
      now,
    );
    const expired = keyStatus(
      { createdAt: "2025-09-01T12:00:00Z", expiresAt: "2026-09-01T12:00:00Z" },
      now,
    );
    expect(revoked.text).toContain("turned off");
    expect(expired.text).toContain("expired");
    expect(revoked.text).not.toEqual(expired.text);
  });
});

describe("keyLabel", () => {
  it("is the tail, marked as a tail", () => {
    expect(keyLabel("k9Q0Xz")).toBe("…k9Q0Xz");
  });
});

describe("recipes", () => {
  const made = recipes(STRINGS);

  it("puts all three strings in every recipe that needs all three", () => {
    for (const recipe of made) {
      expect(recipe.snippet).toContain(STRINGS.key);
    }
  });

  it("carries the /v1 suffix everywhere the address appears", () => {
    // §3's failure #6, first half: "The apiBase differs for each tool.
    // Otherwise, getting 404." A snippet that dropped `/v1` would
    // reproduce the most-reported onboarding bug in the field.
    for (const recipe of made) {
      if (!recipe.snippet.includes("192.168.1.20")) continue;
      const withoutV1 = recipe.snippet.match(/192\.168\.1\.20:8080(?!\/v1)/);
      expect(withoutV1, `${recipe.name} names the address without /v1`).toBeNull();
    }
  });

  it("names Continue's file and uses its own key names", () => {
    const one = made.find((r) => r.name === "Continue")!;
    expect(one.where).toContain("config.yaml");
    expect(one.snippet).toContain("apiBase:");
    expect(one.snippet).toContain("apiKey:");
    expect(one.snippet).toContain(`model: ${STRINGS.model}`);
  });

  it("emits valid JSON for OpenCode", () => {
    const one = made.find((r) => r.name === "OpenCode")!;
    const parsed = JSON.parse(one.snippet);
    expect(parsed.provider["eugene-plexus"].options.baseURL).toBe(STRINGS.baseUrl);
    expect(parsed.provider["eugene-plexus"].options.apiKey).toBe(STRINGS.key);
    expect(Object.keys(parsed.provider["eugene-plexus"].models)).toEqual([STRINGS.model]);
  });

  it("does not offer a Claude Code recipe", () => {
    // The design's §7 S4 named one. Claude Code takes ANTHROPIC_BASE_URL
    // and speaks the Anthropic Messages API at /v1/messages; this
    // gateway serves the OpenAI shape. A recipe would 404 for everyone
    // who followed it.
    expect(made.map((r) => r.name)).not.toContain("Claude Code");
  });

  it("tells Open WebUI's reader there is no model to type", () => {
    const one = made.find((r) => r.name === "Open WebUI")!;
    expect(one.snippet).not.toContain(STRINGS.model);
    expect(one.note).toBeTruthy();
  });
});

describe("curlLine", () => {
  it("quotes the key so a shell cannot expand it", () => {
    const line = curlLine(STRINGS);
    expect(line).toContain(`'Authorization: Bearer ${STRINGS.key}'`);
  });

  it("posts to chat/completions under the base URL", () => {
    expect(curlLine(STRINGS)).toContain("http://192.168.1.20:8080/v1/chat/completions");
  });

  it("sends a body a gateway will parse", () => {
    const line = curlLine(STRINGS);
    const body = line.match(/-d '(.*)'$/s)?.[1];
    expect(body).toBeTruthy();
    expect(JSON.parse(body!).model).toBe(STRINGS.model);
  });

  it("escapes a single quote in a value rather than breaking the line", () => {
    const line = curlLine({ ...STRINGS, model: "it's-a-model" });
    expect(line).toContain(`'\\''`);
  });
});

describe("blockers", () => {
  it("is empty when all three are known", () => {
    expect(blockers({ baseUrl: "x", key: "y", model: "z" })).toEqual([]);
  });

  it("names the missing model before the missing key", () => {
    // Order is the order a person hits them: a key is no use without
    // something to point it at.
    const lines = blockers({ baseUrl: "x", key: null, model: null });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("model");
    expect(lines[1]).toContain("key");
  });

  it("explains a missing address rather than showing a blank box", () => {
    const lines = blockers({ baseUrl: null, key: "y", model: "z" });
    expect(lines[0]).toContain("gateway");
  });
});
