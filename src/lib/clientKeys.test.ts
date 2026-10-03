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
  it("uses the local agent even when gateways run elsewhere", () => {
    const where = clientKeyTarget(
      placement([
        { node: "nas", kind: "gateway" },
        { node: "amish", kind: "library" },
      ]),
      "amish",
    );
    expect(where.target).toBe("agent");
    expect(where.node).toBe("amish");
    expect(where.derived).toBe("local");
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
    // The key may sit in a recipe's second place rather than its first:
    // Codex names an environment variable in its file and reads the key
    // from there, so its file must NOT carry the key.
    for (const recipe of made) {
      expect([recipe.snippet, recipe.then?.snippet ?? ""].join("\n")).toContain(STRINGS.key);
    }
  });

  it("carries the /v1 suffix everywhere the address appears, except Claude Code", () => {
    // §3's failure #6, first half: "The apiBase differs for each tool.
    // Otherwise, getting 404." A snippet that dropped `/v1` would
    // reproduce the most-reported onboarding bug in the field.
    //
    // **Claude Code is the one exception and it is named rather than
    // skipped**, because the rule and its exception are the same fact:
    // the address a client needs is the one that client appends to.
    // `ANTHROPIC_BASE_URL` is a root and Claude Code appends
    // `/v1/messages` itself, so a `/v1` here produces `/v1/v1/messages`.
    // This test caught the new recipe on its first run, which is the
    // invariant doing its job; weakening it to a blanket skip would
    // have lost the check for the other seven.
    const exceptions = new Set(["Claude Code"]);
    let checked = 0;
    for (const recipe of made) {
      if (exceptions.has(recipe.name)) continue;
      if (!recipe.snippet.includes("192.168.1.20")) continue;
      checked += 1;
      const withoutV1 = recipe.snippet.match(/192\.168\.1\.20:8080(?!\/v1)/);
      expect(withoutV1, `${recipe.name} names the address without /v1`).toBeNull();
    }
    // Or an exception list that grew to cover everything would pass.
    expect(checked).toBeGreaterThan(3);
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

  it("offers a Claude Code recipe, and strips the /v1 from its base URL", () => {
    // **This assertion is the inverse of the one it replaces.** S4
    // refused a Claude Code recipe because the client speaks the
    // Anthropic Messages API at /v1/messages and this gateway served
    // only the OpenAI shape, so a recipe would have 404'd for everyone
    // who followed it. R4 built that door.
    //
    // The `/v1` is the trap and it is the opposite of every other
    // recipe here: ANTHROPIC_BASE_URL is a root and the client appends
    // `/v1/messages` itself, so a base URL ending in `/v1` produces
    // requests to `/v1/v1/messages` and a 404 that reads as "your
    // gateway is wrong".
    const one = made.find((r) => r.name === "Claude Code")!;
    expect(one).toBeTruthy();
    expect(one.snippet).toContain("ANTHROPIC_BASE_URL=http://192.168.1.20:8080\n");
    expect(one.snippet).not.toContain("ANTHROPIC_BASE_URL=http://192.168.1.20:8080/v1");
    expect(one.snippet).toContain(`ANTHROPIC_MODEL=${STRINGS.model}`);
  });

  it("no longer turns Claude Code's effort level off", () => {
    // **Inverted 2026-10-03 (upstream drift audit).** `=unset` is not a
    // value Claude Code documents (its values are low, medium, high,
    // xhigh, max and auto), and the reason given for it went stale on
    // 2026-09-23 when the Anthropic door started accepting
    // `output_config.effort`. A recipe that tells people to set an
    // undocumented value, for a refusal that no longer happens, is two
    // wrong things in one line.
    for (const window of [32_768, null]) {
      const one = recipes({ ...STRINGS, contextWindow: window }).find(
        (r) => r.name === "Claude Code",
      )!;
      expect(one.snippet).not.toContain("EFFORT_LEVEL");
      expect(one.note ?? "").not.toMatch(/effort/i);
    }
  });

  it("tells Claude Code the model's real window, and leaves room for the prompt", () => {
    // Claude Code assumes 200K for a model id it does not know and
    // compacts against that, so a local 32k model overflows long before
    // Claude Code thinks to shorten anything. And it keeps 32,000 tokens
    // free for each reply on such a model, which on a 32k window is all
    // of it -- so the window alone, without the output line, would make
    // Claude Code compact on every turn.
    const one = recipes({ ...STRINGS, contextWindow: 32_768 }).find(
      (r) => r.name === "Claude Code",
    )!;
    expect(one.snippet).toContain("CLAUDE_CODE_MAX_CONTEXT_TOKENS=32768");
    expect(one.snippet).toContain("CLAUDE_CODE_MAX_OUTPUT_TOKENS=8192");
    expect(one.note).toContain("CLAUDE_CODE_MAX_CONTEXT_TOKENS");
    expect(one.note).toContain("CLAUDE_CODE_MAX_OUTPUT_TOKENS");
    // Every line is one variable, as a person pastes them.
    for (const line of one.snippet.split("\n")) expect(line).toMatch(/^[A-Z_]+=\S+$/);
  });

  it("does not lower Claude Code's reply room where a quarter of the window is already more", () => {
    // A quarter of 128k is Claude Code's own 32,000; past that, a line
    // would say what Claude Code already does.
    for (const window of [128_000, 262_144]) {
      const one = recipes({ ...STRINGS, contextWindow: window }).find(
        (r) => r.name === "Claude Code",
      )!;
      expect(one.snippet).toContain(`CLAUDE_CODE_MAX_CONTEXT_TOKENS=${window}`);
      expect(one.snippet).not.toContain("CLAUDE_CODE_MAX_OUTPUT_TOKENS");
    }
    // Just under it, the line appears.
    const near = recipes({ ...STRINGS, contextWindow: 127_996 }).find(
      (r) => r.name === "Claude Code",
    )!;
    expect(near.snippet).toContain("CLAUDE_CODE_MAX_OUTPUT_TOKENS=31999");
  });

  it("never invents a window it was not told", () => {
    // Settings never lie: an unknown window is said to be unknown, and the
    // variable is named so a person who knows the number can set it.
    for (const window of [null, undefined, 0]) {
      const one = recipes({ ...STRINGS, contextWindow: window }).find(
        (r) => r.name === "Claude Code",
      )!;
      expect(one.snippet).not.toContain("CLAUDE_CODE_MAX_CONTEXT_TOKENS");
      expect(one.snippet).not.toContain("CLAUDE_CODE_MAX_OUTPUT_TOKENS");
      expect(one.note).toContain("CLAUDE_CODE_MAX_CONTEXT_TOKENS");
      expect(one.note).toMatch(/not known/);
    }
  });

  it("tells Claude Code's reader to use AUTH_TOKEN rather than API_KEY", () => {
    // Measured, not preference. ANTHROPIC_API_KEY needs a one-off
    // approval prompt before Claude Code will use it at all, and an
    // ambient Claude subscription login silently beats it -- which
    // sends the reader's own Anthropic OAuth token to their gateway
    // while the client key they just minted goes unused.
    const one = made.find((r) => r.name === "Claude Code")!;
    expect(one.snippet).toContain("ANTHROPIC_AUTH_TOKEN=");
    expect(one.snippet).not.toContain("ANTHROPIC_API_KEY=");
    expect(one.note).toContain("ANTHROPIC_API_KEY");
  });

  describe("Codex", () => {
    // Every key below was read in Codex 0.160.0's source: `ConfigToml`
    // (`model`, `model_provider`, `model_context_window`,
    // `model_providers`) and `ModelProviderInfo` (`name`, `base_url`,
    // `env_key`, `wire_api`), both `deny_unknown_fields`, so a misspelt
    // key is a Codex that will not start.
    const codex = (window: number | null = 32_768) =>
      recipes({ ...STRINGS, contextWindow: window }).find((r) => r.name === "Codex")!;

    /** Top-level `key = value` lines, before the first `[table]`. */
    function topLevel(toml: string): Map<string, string> {
      const out = new Map<string, string>();
      for (const line of toml.split("\n")) {
        if (line.startsWith("[")) break;
        const m = line.match(/^([a-z_]+) = (.+)$/);
        if (m) out.set(m[1]!, m[2]!);
      }
      return out;
    }

    /** `key = value` lines under `[name]`, up to the next table. */
    function table(toml: string, name: string): Map<string, string> {
      const out = new Map<string, string>();
      let inside = false;
      for (const line of toml.split("\n")) {
        if (line.startsWith("[")) {
          inside = line === `[${name}]`;
          continue;
        }
        const m = inside ? line.match(/^([a-z_]+) = (.+)$/) : null;
        if (m) out.set(m[1]!, m[2]!);
      }
      return out;
    }

    it("is offered, and says which file it goes in", () => {
      const one = codex();
      expect(one).toBeTruthy();
      expect(one.where).toContain(".codex/config.toml");
    });

    it("picks the provider and the model at the top, before any table", () => {
      // **The order is the TOML, not style.** A key written after a
      // `[table]` header belongs to that table, so a `model = ...` below
      // `[model_providers.eugene]` is a provider field Codex refuses.
      const top = topLevel(codex().snippet);
      expect(top.get("model_provider")).toBe('"eugene"');
      expect(JSON.parse(top.get("model")!)).toBe(STRINGS.model);
      expect(top.get("model_context_window")).toBe("32768");
    });

    it("declares the provider with every field Codex needs", () => {
      const provider = table(codex().snippet, "model_providers.eugene");
      expect(JSON.parse(provider.get("name")!)).toBeTruthy();
      // Codex appends `/responses` to this, so the `/v1` stays.
      expect(JSON.parse(provider.get("base_url")!)).toBe(STRINGS.baseUrl);
      expect(provider.get("wire_api")).toBe('"responses"');
      // Mandatory since openai/codex#39214: without it a custom provider
      // sends no key at all.
      expect(provider.get("env_key")).toBe('"EUGENE_API_KEY"');
    });

    it("keeps the key out of the file and in the variable the file names", () => {
      const one = codex();
      expect(one.snippet).not.toContain(STRINGS.key);
      expect(one.then?.snippet).toBe(`EUGENE_API_KEY=${STRINGS.key}`);
      expect(one.then?.where).toMatch(/environment/i);
    });

    it("does not switch Codex's sub-agents off", () => {
      // The gateway takes Codex's `namespace` tools since the 2026-10-03
      // contract, so the audit's interim `multi_agent = false` is not
      // part of the recipe.
      expect(codex().snippet).not.toContain("multi_agent");
      expect(codex().snippet).not.toContain("[features]");
    });

    it("says an unknown window is unknown instead of writing a number", () => {
      const one = codex(null);
      expect(topLevel(one.snippet).has("model_context_window")).toBe(false);
      expect(one.note).toContain("model_context_window");
      expect(one.note).toMatch(/not known/);
    });

    it("writes a model id with a quote in it as a TOML string", () => {
      const one = recipes({ ...STRINGS, model: 'odd"id\\x', contextWindow: 8192 }).find(
        (r) => r.name === "Codex",
      )!;
      expect(JSON.parse(topLevel(one.snippet).get("model")!)).toBe('odd"id\\x');
    });
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
