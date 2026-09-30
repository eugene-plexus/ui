/**
 * The settings cache is thrown away by every write (settings never lie,
 * 2026-09-30): a save on the Routing, Folders or Reach page, or by the
 * wizard, used to read back as the old value for as long as it lasted.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";
import { clearConfigTrios, loadConfigTrio, onConfigTrioInvalidated } from "./configTrio";

afterEach(() => {
  vi.unstubAllGlobals();
  clearConfigTrios();
});

describe("the settings cache", () => {
  it("is emptied by a write made anywhere, and says so", async () => {
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") reads += 1;
        return Response.json(init?.method === "PATCH" ? { applied: [], rejected: [] } : {});
      }),
    );
    const told = vi.fn();
    const stop = onConfigTrioInvalidated(told);
    await loadConfigTrio("gateway");
    await loadConfigTrio("gateway");
    expect(reads).toBe(2); // schema + document, once, then shared
    await api.patch("gateway", "/v1/config", { modelSlots: [] });
    expect(told).toHaveBeenCalled();
    await loadConfigTrio("gateway");
    expect(reads).toBe(4);
    stop();
  });
});
