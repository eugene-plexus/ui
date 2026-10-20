/**
 * Connect apps (CX5): the card that hands an app its address, key and model,
 * on a page that renders whether or not a model is served.
 *
 * On Home it showed only while a chat model was served, so with the models
 * stopped there was no way to turn off a leaked key.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import type { ClientKeyList } from "@/lib/types";

import ConnectAppsPage from "./page";

vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div data-testid="shell">{children}</div>,
}));

let served: string[];
vi.mock("@/lib/completions", () => ({
  PROXY: { kind: "proxy" },
  listModels: async () => ({
    object: "list",
    data: served.map((id) => ({ id, object: "model", owned_by: "eugene" })),
  }),
}));

const KEYS: ClientKeyList = {
  keys: [
    {
      id: "k1",
      name: "Leaked laptop key",
      tail: "abcd",
      createdAt: "2026-10-01T00:00:00Z",
      expiresAt: "2099-10-01T00:00:00Z",
    },
  ],
  scope: "standalone",
};

beforeEach(() => {
  served = [];
  // The card checks its address with a plain fetch. Answer it here, so no
  // real request is still in flight when a test ends.
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ object: "list", data: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
  vi.spyOn(api, "get").mockImplementation(async (target: string, path: string) => {
    if (target === "agent" && path === "/v1/node") return { name: "worker", enrolled: false };
    if (target === "agent" && path === "/v1/components")
      return { components: [{ name: "gateway", kind: "gateway", url: "http://127.0.0.1:8080" }] };
    if (path === "/v1/auth/client-keys") return KEYS;
    throw new Error(`not in this test: ${target} ${path}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Connect apps with no model served", () => {
  it("still shows the address and the keys, and says no model is running", async () => {
    render(<ConnectAppsPage />);
    expect(await screen.findByRole("heading", { name: "Connect apps" })).toBeInTheDocument();
    expect(await screen.findByTestId("connect-no-model")).toHaveTextContent(
      /No chat model is running/,
    );
    const card = screen.getByTestId("home-use-from-apps");
    expect(await within(card).findByText("Leaked laptop key")).toBeInTheDocument();
    await waitFor(() => expect(within(card).getByTestId("base-url")).toHaveTextContent(/\/v1$/));
  });

  it("turns off a key with the models stopped", async () => {
    const del = vi.spyOn(api, "delete").mockResolvedValue(undefined);
    render(<ConnectAppsPage />);
    const name = await screen.findByText("Leaked laptop key");
    const row = within(name.closest("li")!);
    fireEvent.click(row.getByRole("button", { name: "Turn off" }));
    fireEvent.click(row.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("agent", "/v1/auth/client-keys/k1"));
  });

  it("does not say no model is running when one is", async () => {
    served = ["qwen3-14b"];
    render(<ConnectAppsPage />);
    // The row reads "nothing is running" until the first poll lands.
    await waitFor(() => expect(screen.getByTestId("app-model")).toHaveTextContent("qwen3-14b"));
    expect(screen.queryByTestId("connect-no-model")).toBeNull();
  });
});
