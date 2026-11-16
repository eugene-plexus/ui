import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";
import { SCREENS } from "./navigation";
import {
  allowedPath,
  bearerFor,
  clearOperationsSession,
  MACHINES,
  MODELS,
  operationsLine,
  powersOf,
  setOperationsSession,
  type OperationsSession,
} from "./operations";

const DANA: OperationsSession = { token: "admin-session", name: "Dana", powers: [MODELS] };

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A root and two machines: `gpu-a` runs the library, `gpu-b` the gateway. */
function install(): { fetcher: typeof fetch; seen: { url: string; auth: string | null }[] } {
  const seen: { url: string; auth: string | null }[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("authorization");
    seen.push({ url, auth });
    if (url.endsWith("/v1/auth/operations-machines")) {
      return answer(200, {
        machines: [
          { name: "gpu-a", kinds: ["library"] },
          { name: "gpu-b", kinds: ["gateway"] },
        ],
        unreachableNodes: [],
      });
    }
    if (url.endsWith("/v1/auth/operations-token")) {
      const machine = JSON.parse(String(init?.body)).machine;
      return answer(200, {
        token: `ops-for-${machine}`,
        machine,
        powers: ["operate-models"],
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      });
    }
    // The agent serving this console is gpu-b: it answers only its own token.
    if (url === "/api/proxy/agent/v1/node") {
      return auth === "Bearer ops-for-gpu-b" ? answer(200, { name: "gpu-b" }) : answer(401, {});
    }
    return answer(200, {});
  }) as unknown as typeof fetch;
  return { fetcher, seen };
}

describe("the console for a person who is not the owner", () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearOperationsSession();
  });

  it("shows a person with Models only the pages Models uses", () => {
    const allowed = SCREENS.filter((s) => allowedPath(s.href, powersOf({ operateModels: true })));
    expect(allowed.map((s) => s.label).sort()).toEqual(
      [
        "Alerts",
        "Dashboards",
        "Discover",
        "Home",
        "Hosts",
        "Library",
        "Machines",
        "Metrics",
      ].sort(),
    );
    for (const owners of ["/config", "/people", "/routing", "/inference", "/sites", "/logs"]) {
      expect(allowedPath(owners, [MODELS])).toBe(false);
    }
    expect(allowedPath("/library/folders/", [MODELS])).toBe(true);
    expect(allowedPath("/logs/", [MACHINES])).toBe(true);
    expect(allowedPath("/discover", [MACHINES])).toBe(false);
    expect(allowedPath("/", [])).toBe(false);
  });

  it("says who is signed in and with what", () => {
    expect(operationsLine({ ...DANA, powers: [MODELS, MACHINES] })).toBe(
      "Signed in as Dana: models, updates and restarts",
    );
  });

  it("sends each target the token of the machine that serves it", async () => {
    const { fetcher } = install();
    expect(await bearerFor(DANA, "control", fetcher)).toBe("admin-session");
    expect(await bearerFor(DANA, "library", fetcher)).toBe("ops-for-gpu-a");
    expect(await bearerFor(DANA, "gateway", fetcher)).toBe("ops-for-gpu-b");
    expect(await bearerFor(DANA, "node:gpu-a", fetcher)).toBe("ops-for-gpu-a");
    expect(await bearerFor(DANA, "agent", fetcher)).toBe("ops-for-gpu-b");
    // A driver by name is nothing a person's powers reach.
    expect(await bearerFor(DANA, "llama-1", fetcher)).toBeNull();
  });

  it("exchanges once per machine and reuses the token", async () => {
    const { fetcher, seen } = install();
    await bearerFor(DANA, "node:gpu-a", fetcher);
    await bearerFor(DANA, "library", fetcher);
    expect(seen.filter((s) => s.url.endsWith("/operations-token"))).toHaveLength(1);
  });
});

describe("the api client in operations mode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    clearOperationsSession();
  });

  it("carries the library machine's token to the library, and never the owner's", async () => {
    const { fetcher, seen } = install();
    vi.stubGlobal("fetch", fetcher);
    setOperationsSession(DANA);
    await api.get("library", "/v1/models");
    const sent = seen.find((s) => s.url === "/api/proxy/library/v1/models");
    expect(sent?.auth).toBe("Bearer ops-for-gpu-a");
  });

  it("leaves a machine's refusal in place rather than signing the person out", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/operations-machines"))
        return answer(200, { machines: [{ name: "gpu-a", kinds: ["library"] }] });
      if (url.endsWith("/operations-token"))
        return answer(200, { token: "t", expiresAt: new Date(Date.now() + 600_000).toISOString() });
      return answer(403, { detail: { detail: "Only the owner can do this." } });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetcher);
    setOperationsSession(DANA);
    await expect(api.patch("library", "/v1/config", {})).rejects.toMatchObject({ status: 403 });
    expect(sessionStorage.getItem("eugene-operations-session")).not.toBeNull();
  });
});

describe("the end of a named session", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    clearOperationsSession();
  });

  it("ends when the root refuses the exchange, not when an owner-only route refuses", async () => {
    let exchange = 200;
    const replace = vi.fn();
    vi.stubGlobal("location", { ...window.location, replace, pathname: "/nodes" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/operations-machines"))
          return answer(200, { machines: [{ name: "gpu-a", kinds: ["library"] }] });
        if (url.endsWith("/operations-token"))
          return exchange === 200
            ? answer(200, { token: "t", expiresAt: new Date(Date.now() + 600_000).toISOString() })
            : answer(401, { detail: { detail: "Sign in again." } });
        return answer(401, { detail: { detail: "Not accepted here." } });
      }) as unknown as typeof fetch,
    );
    setOperationsSession(DANA);
    await expect(api.get("control", "/v1/nodes")).rejects.toMatchObject({ status: 401 });
    expect(replace).not.toHaveBeenCalled();
    clearOperationsSession();
    setOperationsSession(DANA);
    exchange = 401;
    await expect(api.get("library", "/v1/models")).rejects.toMatchObject({ status: 401 });
    expect(replace).toHaveBeenCalledWith("/administration/?reason=expired");
    expect(sessionStorage.getItem("eugene-operations-session")).toBeNull();
  });
});
