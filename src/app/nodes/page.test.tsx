/**
 * The nodes page, driven — and specifically the sealed-root path.
 *
 * This page had no tests, and the behaviour it was missing was found by
 * an operator reporting the *absence* of a symptom: "my container does
 * not act like it needs a login, I am browsing every page of the UI."
 * He was right. `/login` posts to the agent, the agent is not what is
 * sealed, and this screen is one of only two places in the whole UI that
 * talks to the control root — so a locked root was invisible everywhere
 * except here, and here it rendered as "not reachable, or has not been
 * set up yet", which is advice to wipe an install that exists.
 *
 * The assertions worth keeping are the ones about *not* being confidently
 * wrong: a sealed root must not read as an absent one, and an unasked
 * registry must not render as an empty one.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NodesPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

const LOCKED = {
  detail: {
    type: "https://github.com/eugene-plexus/control#locked",
    title: "Locked",
    status: 503,
    detail:
      "This control root is initialized but locked: it holds the install's signing key " +
      "sealed and has not been given the passphrase. Call POST /v1/auth/login.",
    component: "control",
  },
};

const UNINITIALIZED = {
  detail: {
    type: "https://github.com/eugene-plexus/control#setup-required",
    title: "Setup required",
    status: 503,
    detail: "This install has no passphrase yet. Call POST /v1/auth/initialize first.",
    component: "control",
  },
};

const NODES = {
  nodes: [
    { name: "unraid", role: "control", reachable: true, url: "http://192.168.16.252:8283" },
    { name: "Amish_Station", role: "worker", reachable: true, url: "http://192.168.16.75:8079" },
  ],
};

/** Flips to false when the login call lands, like the real root does. */
let sealed: boolean;
let calls: { url: string; method: string }[];

beforeEach(() => {
  sealed = true;
  calls = [];
  const seen = calls;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      seen.push({ url, method });
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });

      if (url.includes("/v1/auth/login")) {
        sealed = false;
        return json({ sessionToken: "fresh", expiresAt: "2099-01-01T00:00:00Z" });
      }
      if (sealed) return json(LOCKED, 503);
      if (url.includes("/v1/nodes")) return json(NODES);
      if (url.includes("/v1/control/status")) return json({ role: "control", epoch: 1 });
      return json({});
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("nodes page, sealed control root", () => {
  it("offers to unlock rather than reporting an unreachable root", async () => {
    render(<NodesPage />);

    await screen.findByText(/this control root is locked/i);
    expect(screen.getByLabelText(/operator passphrase/i)).toBeTruthy();

    // The old text sent an operator toward first-run setup, which on an
    // install that already exists is advice to wipe it.
    expect(screen.queryByText(/has not been set up yet/i)).toBeNull();
  });

  it("says the registry is unknown, not empty", async () => {
    render(<NodesPage />);

    await screen.findByText(/this control root is locked/i);
    expect(screen.getByText(/unknown until the root is unlocked/i)).toBeTruthy();
    // "No nodes are enrolled. That is unusual" is a claim about the
    // registry. We never got to read it.
    expect(screen.queryByText(/no nodes are enrolled/i)).toBeNull();
  });

  it("says plainly that signing in to the UI does not unlock it", async () => {
    render(<NodesPage />);
    await screen.findByText(/this control root is locked/i);
    expect(screen.getByText(/goes to the node agent/i)).toBeTruthy();
  });

  it("unlocks against the control root and then shows the install", async () => {
    render(<NodesPage />);
    await screen.findByText(/this control root is locked/i);

    await userEvent.type(screen.getByLabelText(/operator passphrase/i), "correct-horse");
    await userEvent.click(screen.getByRole("button", { name: /unlock/i }));

    await waitFor(() => expect(screen.getByText("Amish_Station")).toBeTruthy());
    expect(screen.queryByText(/this control root is locked/i)).toBeNull();

    // Addressed to the control root, not the agent -- the whole point.
    const login = calls.find((c) => c.url.includes("/v1/auth/login"));
    expect(login?.method).toBe("POST");
    expect(login?.url).toContain("control");
  });

  it("hides the join-token form while locked, because minting would only 503", async () => {
    render(<NodesPage />);
    await screen.findByText(/this control root is locked/i);
    expect(screen.queryByRole("button", { name: /mint/i })).toBeNull();
  });
});

describe("nodes page, uninitialized control root", () => {
  it("does not offer to unlock an install that does not exist yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(UNINITIALIZED), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    render(<NodesPage />);

    // The root's own words, which name the right endpoint. The two 503s
    // are different situations and the page must not merge them: one
    // wants a passphrase, the other wants first-run setup.
    await screen.findByText(/no passphrase yet/i);
    expect(screen.queryByLabelText(/operator passphrase/i)).toBeNull();
  });
});
