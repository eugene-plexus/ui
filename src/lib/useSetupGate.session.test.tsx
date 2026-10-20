/**
 * Where the gate sends a visitor with no session (CX2-C1).
 *
 * A half-set-up install used to go to /login like any other, and then on to
 * setup, which asked for the passphrase again because the control root still
 * needed it. The agent's open status now says whether first-run setup
 * finished, so a half-set-up install goes straight to setup, which signs in
 * itself.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSetupGate } from "./useSetupGate";

const replace = vi.fn();
vi.mock("next/navigation", () => {
  const router = { replace: (to: string) => replace(to), push: vi.fn(), refresh: vi.fn() };
  return { useRouter: () => router };
});

let status: Record<string, unknown>;

beforeEach(() => {
  replace.mockClear();
  sessionStorage.clear();
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const route = String(input).replace(/^\/api\/proxy\//, "");
      const body = route === "agent/v1/auth/status" ? status : { detail: "not in this test" };
      return new Response(JSON.stringify(body), {
        status: route === "agent/v1/auth/status" ? 200 : 404,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the setup gate with no session", () => {
  it("sends a half-set-up install to setup, which asks for the passphrase once", async () => {
    status = { initialized: true, firstRunComplete: false };
    renderHook(() => useSetupGate());
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/setup"));
    expect(replace).not.toHaveBeenCalledWith(expect.stringMatching(/^\/login/));
  });

  it("sends a finished install to sign in", async () => {
    status = { initialized: true, firstRunComplete: true };
    renderHook(() => useSetupGate());
    await waitFor(() => expect(replace).toHaveBeenCalledWith(expect.stringMatching(/^\/login/)));
  });

  it("treats an older agent that leaves the field out as finished", async () => {
    status = { initialized: true };
    renderHook(() => useSetupGate());
    await waitFor(() => expect(replace).toHaveBeenCalledWith(expect.stringMatching(/^\/login/)));
  });
});
