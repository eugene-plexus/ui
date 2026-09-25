import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import type { ClientKeyList, Model } from "@/lib/types";

import { UseFromAppsCard } from "./UseFromAppsCard";

afterEach(() => vi.restoreAllMocks());

function show() {
  render(<UseFromAppsCard models={[]} gatewayPortUrl={null} placement={null} localNode="worker" />);
}

describe("install-wide key registry", () => {
  it("names the install-wide registry and the admission dependency", async () => {
    const registry: ClientKeyList = {
      keys: [
        {
          id: "k1",
          name: "Laptop",
          tail: "sample",
          createdAt: "2026-09-01T00:00:00Z",
          expiresAt: "2099-09-01T00:00:00Z",
        },
      ],
      scope: "install",
    };
    const get = vi.spyOn(api, "get").mockResolvedValue(registry);
    show();
    expect(await screen.findByText("Laptop")).toBeInTheDocument();
    expect(screen.getByText(/apply to every gateway in this install/)).toBeInTheDocument();
    expect(screen.getByText(/Client requests need the active key authority/)).toBeInTheDocument();
    expect(screen.queryByText(/migrat/i)).toBeNull();
    expect(get).toHaveBeenCalledWith("agent", "/v1/auth/client-keys");
  });

  // Per-node token keys (2026-09-25): a standalone machine's keys are
  // signed by it alone and are not carried into an install it joins.
  it("says a standalone machine's keys stop working when it joins", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ keys: [], scope: "standalone" });
    show();
    expect(await screen.findByText(/stop working when it does/)).toBeInTheDocument();
    expect(screen.queryByText(/will migrate/i)).toBeNull();
  });

  it("refreshes after the authority recovers", async () => {
    const get = vi
      .spyOn(api, "get")
      .mockRejectedValue(new Error("Client-key authority unavailable"));
    show();
    expect(await screen.findByTestId("key-error")).toHaveTextContent("authority unavailable");
    get.mockResolvedValue({ keys: [], scope: "install" });
    fireEvent.click(screen.getByText("Refresh key status"));
    expect(await screen.findByText(/apply to every gateway in this install/)).toBeInTheDocument();
  });

  it("reports authority failure without claiming an empty healthy registry", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new Error("Client-key authority unavailable"));
    show();
    expect(await screen.findByTestId("key-error")).toHaveTextContent("authority unavailable");
    expect(screen.getByText(/Registry status has not been confirmed/)).toBeInTheDocument();
  });
});

it("makes a scoped key with the chosen limits", async () => {
  vi.spyOn(api, "get").mockResolvedValue({ keys: [], scope: "install" });
  const post = vi.spyOn(api, "post").mockResolvedValue({ key: { id: "new" }, token: "shown-once" });
  show();
  await screen.findByText("Keys and revocations apply to every gateway in this install.", {
    exact: false,
  });
  fireEvent.click(screen.getByRole("checkbox", { name: /Allow all models/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Local-only inference/ }));
  fireEvent.change(screen.getByRole("textbox", { name: /Allowed model IDs/ }), {
    target: { value: "alias\nactual\nactual" },
  });
  fireEvent.change(screen.getByLabelText("Concurrent requests"), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Requests per minute"), { target: { value: "12" } });
  fireEvent.click(screen.getByTestId("make-key"));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("agent", "/v1/auth/client-keys", {
      name: "My app",
      limits: {
        localOnly: true,
        allowedModels: ["alias", "actual"],
        maxConcurrentRequests: 1,
        requestsPerMinute: 12,
      },
    }),
  );
  expect(await screen.findByTestId("fresh-key")).toHaveTextContent("shown-once");
});

it("makes legacy access explicit and edits limits without minting another token", async () => {
  const key = {
    id: "legacy",
    name: "Old app",
    tail: "sample",
    createdAt: "2026-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
  };
  const get = vi.spyOn(api, "get").mockResolvedValue({ keys: [key], scope: "install" });
  const put = vi.spyOn(api, "put").mockResolvedValue({});
  const post = vi.spyOn(api, "post");
  show();
  expect(await screen.findByText(/Legacy \/ unrestricted/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Set limits"));
  const row = screen.getByTestId("key-list");
  fireEvent.click(within(row).getByRole("checkbox", { name: /Allow all models/ }));
  get.mockResolvedValue({
    keys: [
      {
        ...key,
        limits: {
          localOnly: false,
          allowedModels: [],
          maxConcurrentRequests: 2,
          requestsPerMinute: 60,
        },
      },
    ],
    scope: "install",
  });
  fireEvent.click(within(row).getByText("Save limits"));
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith("agent", "/v1/auth/client-keys/legacy/limits", {
      limits: {
        localOnly: false,
        allowedModels: [],
        maxConcurrentRequests: 2,
        requestsPerMinute: 60,
      },
    }),
  );
  expect(await screen.findByText(/No models allowed/)).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});

describe("turning a key off", () => {
  // It cannot be taken back: every app holding that key stops working,
  // and the key drops out of the list. One click used to do it.
  const key = {
    id: "laptop",
    name: "Laptop",
    tail: "sample",
    createdAt: "2026-09-01T00:00:00Z",
    expiresAt: "2099-09-01T00:00:00Z",
  };

  it("asks first, and one click does not turn it off", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ keys: [key], scope: "install" });
    const del = vi.spyOn(api, "delete").mockResolvedValue(undefined);
    show();
    const row = within(await screen.findByTestId("key-list"));
    fireEvent.click(row.getByRole("button", { name: "Turn off" }));
    expect(del).not.toHaveBeenCalled();
    expect(row.getByText("Apps using this key will stop working.")).toBeInTheDocument();
    // The way out leaves it alone.
    fireEvent.click(row.getByRole("button", { name: "Keep" }));
    expect(del).not.toHaveBeenCalled();
    expect(row.getByText("Laptop")).toBeInTheDocument();
  });

  it("turns it off once confirmed", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ keys: [key], scope: "install" });
    const del = vi.spyOn(api, "delete").mockResolvedValue(undefined);
    show();
    const row = within(await screen.findByTestId("key-list"));
    fireEvent.click(row.getByRole("button", { name: "Turn off" }));
    fireEvent.click(row.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("agent", "/v1/auth/client-keys/laptop"));
  });
});

describe("the card's controls have names", () => {
  // A placeholder is not a label: it disappears as soon as anyone types,
  // and a screen reader may not read it at all.
  const models = [
    { id: "qwen", object: "model", created: 0, owned_by: "eugene-plexus" },
    { id: "gemma", object: "model", created: 0, owned_by: "eugene-plexus" },
  ] as Model[];

  it("labels the key name, the model and the address", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ keys: [], scope: "install" });
    render(
      <UseFromAppsCard models={models} gatewayPortUrl={null} placement={null} localNode="worker" />,
    );
    await screen.findByText(/Registry status|every gateway/);
    expect(screen.getByLabelText("What the key is for")).toBe(screen.getByTestId("key-name"));
    expect(screen.getByLabelText("Model")).toBe(screen.getByTestId("app-model"));
    fireEvent.click(screen.getByRole("button", { name: "Not right?" }));
    expect(screen.getByLabelText("Address")).toBe(screen.getByTestId("base-url-input"));
  });

  it("pairs every term in the list with its description", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ keys: [], scope: "install" });
    show();
    await screen.findByText(/Registry status|every gateway/);
    const terms = document.querySelectorAll("[data-testid='home-use-from-apps'] dt");
    expect(terms.length).toBeGreaterThan(0);
    for (const term of terms) expect(term.nextElementSibling?.tagName).toBe("DD");
  });
});

describe("the address editor", () => {
  it("takes focus on open, cancels on Escape, and hands focus back", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ keys: [], scope: "install" });
    const user = userEvent.setup();
    show();
    await screen.findByText(/Registry status|every gateway/);
    await user.click(screen.getByRole("button", { name: "Not right?" }));
    const box = screen.getByTestId("base-url-input");
    expect(box).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("base-url-input")).toBeNull();
    expect(screen.getByRole("button", { name: "Not right?" })).toHaveFocus();
  });

  it("hands focus back after Save too", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ keys: [], scope: "install" });
    const user = userEvent.setup();
    show();
    await screen.findByText(/Registry status|every gateway/);
    await user.click(screen.getByRole("button", { name: "Not right?" }));
    await user.type(screen.getByTestId("base-url-input"), "http://10.0.0.5:8280{Enter}");
    expect(screen.getByRole("button", { name: "Change" })).toHaveFocus();
  });
});

describe("the address check", () => {
  it("does not start again when Home's poll hands down the same reading", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ keys: [], scope: "install" });
    const probes: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        probes.push(String(input));
        return new Response(JSON.stringify({ object: "list", data: [{ id: "qwen" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const props = {
      models: [] as Model[],
      gatewayPortUrl: "http://127.0.0.1:8080",
      placement: null,
      localNode: "worker",
    };
    const { rerender } = render(
      <UseFromAppsCard {...props} boundAddresses={[{ process: "agent", port: 8079 }]} />,
    );
    const verdict = await screen.findByTestId("base-url-verdict");
    await waitFor(() => expect(verdict).toHaveAttribute("data-verdict", "confirmed"));
    const before = probes.length;
    // Every 15 s: an equal reading, in a new array.
    rerender(<UseFromAppsCard {...props} boundAddresses={[{ process: "agent", port: 8079 }]} />);
    rerender(<UseFromAppsCard {...props} boundAddresses={[{ process: "agent", port: 8079 }]} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId("base-url-verdict")).toHaveAttribute("data-verdict", "confirmed");
    expect(probes.length).toBe(before);
    vi.unstubAllGlobals();
  });
});
