import { describe, expect, it, vi } from "vitest";

import {
  describeRemap,
  describeVerdict,
  normalizeBase,
  pagePort,
  portRemapEvidence,
  verifyGatewayAddress,
} from "./gatewayAddress";

// Both fixtures were read off the wire on 2026-09-16 rather than
// invented, because the whole point of this module is telling one real
// service apart from another and an imagined body proves nothing about
// that. Commands and full output are in the acceptance record.
//
//   curl -i http://192.168.16.252:8280/v1/models -H 'Origin: ...'
const GATEWAY_401 = {
  detail: {
    type: "https://github.com/eugene-plexus/gateway#missing-token",
    title: "Missing token",
    status: 401,
    detail: "Provide a bearer token via the Authorization: Bearer header.",
    component: "gateway",
  },
};

//   curl -i http://192.168.16.252:8080/v1/models   -> qBittorrent
const QBITTORRENT_404_BODY = "Not Found";

/** A `Response` with only what this module reads off one. */
function fakeResponse(init: {
  status: number;
  body?: unknown;
  text?: string;
  type?: ResponseType;
}): Response {
  return {
    ok: init.status >= 200 && init.status < 300,
    status: init.status,
    type: init.type ?? "cors",
    json: async () => {
      if (init.text !== undefined) throw new SyntaxError("Unexpected token N in JSON");
      return init.body;
    },
  } as unknown as Response;
}

describe("pagePort", () => {
  it("reads an explicit port", () => {
    expect(pagePort({ protocol: "http:", port: "8279" })).toBe(8279);
  });

  // The sabotage this pins: drop the scheme defaults and a page served
  // on 80 or 443 reads as "no port", which silently turns every remap
  // behind a reverse proxy into no-evidence.
  it("makes the scheme's default port explicit", () => {
    expect(pagePort({ protocol: "http:", port: "" })).toBe(80);
    expect(pagePort({ protocol: "https:", port: "" })).toBe(443);
  });

  it("is null for a scheme with no default we know", () => {
    expect(pagePort({ protocol: "file:", port: "" })).toBeNull();
  });
});

describe("portRemapEvidence", () => {
  const bound = [
    { process: "agent", port: 8079 },
    { process: "gateway", port: 8080 },
  ];

  it("reports a remap when the page's port is not the agent's socket", () => {
    // The live install: UnRAID publishes 8079 as 8279.
    const evidence = portRemapEvidence({ protocol: "http:", port: "8279" }, bound);
    expect(evidence).toEqual({ kind: "remapped", pagePort: 8279, agentPort: 8079 });
  });

  it("catches a reverse proxy on the scheme's default port", () => {
    const evidence = portRemapEvidence({ protocol: "https:", port: "" }, bound);
    expect(evidence).toEqual({ kind: "remapped", pagePort: 443, agentPort: 8079 });
  });

  it("has no third answer meaning the guess is trustworthy", () => {
    // Matching proves only that the AGENT's port is published one to
    // one. A host may still publish the gateway's differently, so the
    // answer is the absence of evidence and never a promise. If this
    // type ever grows a `kind: "direct"`, the card will start telling
    // people an unverified address is fine.
    const evidence = portRemapEvidence({ protocol: "http:", port: "8079" }, bound);
    expect(evidence).toEqual({ kind: "none" });
  });

  it("says nothing when the agent's bind is unknown", () => {
    expect(portRemapEvidence({ protocol: "http:", port: "8279" }, [])).toEqual({ kind: "none" });
    expect(portRemapEvidence({ protocol: "http:", port: "8279" }, null)).toEqual({ kind: "none" });
    // An agent too old to report `reach` at all.
    expect(
      portRemapEvidence({ protocol: "http:", port: "8279" }, [{ process: "gateway", port: 8080 }]),
    ).toEqual({
      kind: "none",
    });
  });
});

describe("normalizeBase", () => {
  it("keeps scheme, host and port and drops everything else", () => {
    expect(normalizeBase("http://192.168.16.252:8280/v1/")).toBe("http://192.168.16.252:8280");
    expect(normalizeBase("  http://nas:8280  ")).toBe("http://nas:8280");
  });

  it("refuses what is not an http URL", () => {
    expect(normalizeBase("192.168.16.252:8280")).toBeNull();
    expect(normalizeBase("file:///etc/passwd")).toBeNull();
    expect(normalizeBase("")).toBeNull();
  });
});

describe("verifyGatewayAddress", () => {
  it("confirms from a model list and carries the ids", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      fakeResponse({ status: 200, body: { object: "list", data: [{ id: "Qwen3-27B-Q6_K_L" }] } }),
    );
    const verdict = await verifyGatewayAddress("http://nas:8280", {
      key: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(verdict).toEqual({
      kind: "confirmed",
      models: ["Qwen3-27B-Q6_K_L"],
      authenticated: true,
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("http://nas:8280/v1/models");
  });

  // The sabotage this pins: accept only 2xx as confirmation and the
  // card can no longer check an address until a key exists -- which is
  // the moment a person most needs it checked.
  it("confirms from the gateway's own 401, with no key at all", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      fakeResponse({ status: 401, body: GATEWAY_401 }),
    );
    const verdict = await verifyGatewayAddress("http://nas:8280", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(verdict).toEqual({ kind: "confirmed", models: [], authenticated: false });
    // No key, so no Authorization header -- which also keeps this a
    // CORS-simple request with no preflight.
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined;
    expect((init?.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("names something that answered but is not this gateway", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse({ status: 404, text: QBITTORRENT_404_BODY }));
    const verdict = await verifyGatewayAddress("http://nas:8080", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(verdict).toEqual({ kind: "not-gateway", status: 404 });
  });

  it("does not mistake a JSON body from somebody else for ours", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ status: 401, body: { detail: { component: "qbittorrent" } } }),
    );
    const verdict = await verifyGatewayAddress("http://nas:8080", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(verdict).toEqual({ kind: "not-gateway", status: 401 });
  });

  // The sabotage this pins: drop the `no-cors` retry and this case
  // collapses into `unreachable` -- which sends a person to check their
  // firewall for a port that is answering perfectly well, to somebody
  // else. It is exactly the afternoon that prompted this module.
  it("separates a service that will not talk to a browser from a dead port", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.mode === "no-cors") return fakeResponse({ status: 0, type: "opaque" });
      throw new TypeError("Failed to fetch");
    });
    const verdict = await verifyGatewayAddress("http://nas:8080", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(verdict).toEqual({ kind: "blocked" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reports nothing listening when even the opaque probe fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const verdict = await verifyGatewayAddress("http://nas:9999", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(verdict).toEqual({ kind: "unreachable", message: "Failed to fetch" });
  });

  it("refuses a base URL that is not one, without dialling", async () => {
    const fetchImpl = vi.fn();
    const verdict = await verifyGatewayAddress("192.168.16.252:8280", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(verdict.kind).toBe("unreachable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("describeRemap", () => {
  it("names both ports, because that is what sends a person to look", () => {
    const text = describeRemap({ kind: "remapped", pagePort: 8279, agentPort: 8079 });
    expect(text).toContain("8279");
    expect(text).toContain("8079");
  });

  it("says nothing when there is no evidence", () => {
    expect(describeRemap({ kind: "none" })).toBeNull();
  });
});

describe("describeVerdict", () => {
  it("treats the gateway's 401 as good news and points at the key", () => {
    const { tone, text } = describeVerdict(
      { kind: "confirmed", models: [], authenticated: false },
      "http://nas:8280",
    );
    expect(tone).toBe("ok");
    expect(text).toMatch(/key/i);
  });

  it("names the models when it has them", () => {
    const { tone, text } = describeVerdict(
      { kind: "confirmed", models: ["Qwen3-27B"], authenticated: true },
      "http://nas:8280",
    );
    expect(tone).toBe("ok");
    expect(text).toContain("Qwen3-27B");
  });

  // The sentence this slice exists for. It must say that something IS
  // there and that it is not us -- "cannot reach" would send a person to
  // their firewall for a port that is answering perfectly well.
  it("says another service is on the port, not that nothing is", () => {
    const { tone, text } = describeVerdict(
      { kind: "not-gateway", status: 400 },
      "http://192.168.16.252:8080",
    );
    expect(tone).toBe("error");
    expect(text).toContain("192.168.16.252:8080");
    expect(text).toMatch(/another service/i);
    expect(text).not.toMatch(/nothing answered/i);
  });

  it("distinguishes a listening service that will not talk to a browser", () => {
    const { tone, text } = describeVerdict({ kind: "blocked" }, "http://nas:8080");
    expect(tone).toBe("error");
    expect(text).toMatch(/listening/i);
  });

  it("sends an unreachable address to the reach card, not to a shrug", () => {
    const { tone, text } = describeVerdict(
      { kind: "unreachable", message: "Failed to fetch" },
      "http://nas:9999",
    );
    expect(tone).toBe("warn");
    expect(text).toMatch(/Reach it from other devices/);
  });
});
