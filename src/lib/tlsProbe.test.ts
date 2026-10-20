import { describe, expect, it, vi } from "vitest";

import {
  caServed,
  decideAction,
  httpsTarget,
  httpsTrusted,
  runProbe,
  shouldProbe,
  type PageLocation,
} from "./tlsProbe";

const page: PageLocation = {
  protocol: "http:",
  hostname: "192.168.1.5",
  host: "192.168.1.5:8079",
  pathname: "/config",
  search: "?tab=agent",
  hash: "#x",
};

const ok = { ok: true, status: 200 };

describe("shouldProbe", () => {
  it("probes a plain page on a LAN host", () => {
    expect(shouldProbe("http:", "192.168.1.5")).toBe(true);
    expect(shouldProbe("http:", "nas.local")).toBe(true);
  });
  it("leaves https and loopback alone", () => {
    expect(shouldProbe("https:", "192.168.1.5")).toBe(false);
    for (const host of ["localhost", "127.0.0.1", "::1", "[::1]", "LOCALHOST"]) {
      expect(shouldProbe("http:", host)).toBe(false);
    }
  });
});

describe("decideAction", () => {
  it("moves when https works, offers trust when only the CA is served, else nothing", () => {
    expect(decideAction(true, false)).toBe("move");
    expect(decideAction(true, true)).toBe("move");
    expect(decideAction(false, true)).toBe("offer-trust");
    expect(decideAction(false, false)).toBe("nothing");
  });
});

describe("httpsTarget", () => {
  it("keeps host, port, path, query and hash", () => {
    expect(httpsTarget(page)).toBe("https://192.168.1.5:8079/config?tab=agent#x");
  });
});

describe("the probe", () => {
  it("fetches /healthz over https with no-cors and no-store", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 0 });
    expect(await httpsTrusted("192.168.1.5:8079", fetchFn)).toBe(true);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://192.168.1.5:8079/healthz");
    expect(init).toMatchObject({ mode: "no-cors", cache: "no-store" });
  });

  it("treats a rejection as not trusted", async () => {
    expect(await httpsTrusted("h:1", vi.fn().mockRejectedValue(new TypeError("x")))).toBe(false);
  });

  it("gives up after the timeout", async () => {
    const hang = (_url: string, init?: RequestInit) =>
      new Promise<never>((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    expect(await httpsTrusted("h:1", hang, 10)).toBe(false);
  });

  it("serves the CA only on a 200", async () => {
    expect(await caServed(vi.fn().mockResolvedValue(ok))).toBe(true);
    expect(await caServed(vi.fn().mockResolvedValue({ ok: false, status: 404 }))).toBe(false);
    expect(await caServed(vi.fn().mockRejectedValue(new Error("down")))).toBe(false);
  });

  it("moves when https answers, without asking for the CA", async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok);
    expect(await runProbe(page, fetchFn)).toBe("move");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("offers trust when https fails and the CA is served", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.startsWith("https:")) throw new TypeError("handshake");
      return ok;
    });
    expect(await runProbe(page, fetchFn)).toBe("offer-trust");
  });

  it("says nothing when https fails and there is no CA", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.startsWith("https:")) throw new TypeError("handshake");
      return { ok: false, status: 404 };
    });
    expect(await runProbe(page, fetchFn)).toBe("nothing");
  });

  it("does not touch the network on loopback or https", async () => {
    const fetchFn = vi.fn();
    expect(
      await runProbe({ ...page, hostname: "localhost", host: "localhost:8079" }, fetchFn),
    ).toBe("nothing");
    expect(await runProbe({ ...page, protocol: "https:" }, fetchFn)).toBe("nothing");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
