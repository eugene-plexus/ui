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

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NodesPage from "./page";

vi.mock("next/navigation", () => ({
  // The shared navigation reads the pathname to mark the current
  // screen. Added when the shared navigation landed; without it every
  // page that renders a header throws on mount.
  usePathname: () => "/nodes",
  // The shell reads `?sel=` to know which object the page is about.
  useSearchParams: () => new URLSearchParams(),
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
/** Outstanding join tokens, as the root lists them: never the token. */
let tokenRows: { id: string; expiresAt: string; nodeName?: string | null; used: boolean }[];

beforeEach(() => {
  sealed = true;
  calls = [];
  tokenRows = [];
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
      // Before `/v1/nodes` — it is a prefix of this one, and answering
      // the node list here is the same collision the control root's own
      // router had.
      if (url.includes("/v1/nodes/join-tokens")) return json({ tokens: tokenRows });
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

  it("says why the form is still here now that signing in unlocks the root too", async () => {
    // Until 2026-09-13 this asserted the opposite sentence: "signing in
    // does not unlock it". The login page posts the passphrase to the root
    // now, so the panel's job is to explain the two cases it still covers
    // -- a root that restarted after sign-in, or one keyed differently.
    render(<NodesPage />);
    await screen.findByText(/this control root is locked/i);
    expect(screen.getByText(/signing in to this web ui unlocks it too/i)).toBeTruthy();
    expect(screen.getByText(/different passphrase/i)).toBeTruthy();
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

describe("a root that has not polled yet", () => {
  /**
   * Reported 2026-09-17: update the container, unlock, and every node
   * reads as **down** — then a manual refresh a few seconds later shows
   * them all up.
   *
   * Two causes, and this file drives both. A locked root does not poll,
   * so the moment it is unlocked it holds no observations and reports
   * `reachable: false` for every node; and the page asked once and never
   * again.
   */
  function withNodes(rows: unknown[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, method: (init?.method ?? "GET").toUpperCase() });
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          });
        if (url.includes("/v1/nodes/join-tokens")) return json({ tokens: tokenRows });
        if (url.includes("/v1/nodes")) return json({ nodes: rows });
        if (url.includes("/v1/control/status")) return json({ role: "control", epoch: 1 });
        return json({});
      }),
    );
  }

  beforeEach(() => {
    sealed = false;
  });

  it("says checking, not down, when nothing has been observed", async () => {
    // `reachable: false` with no reason and no `lastSeenAt` is the exact
    // signature of "no probe record exists" — every failed probe carries
    // a reason. See `lib/nodeLiveness.ts`.
    withNodes([{ name: "Amish_Station", role: "worker", reachable: false, url: "http://a:8079" }]);
    render(<NodesPage />);
    const cell = await screen.findByTestId("node-liveness");
    expect(cell).toHaveAttribute("data-liveness", "unchecked");
    expect(cell).not.toHaveTextContent("down");
  });

  it("says down when the root actually tried and could not", async () => {
    withNodes([
      {
        name: "Amish_Station",
        role: "worker",
        reachable: false,
        url: "http://a:8079",
        lastError: "connection refused",
      },
    ]);
    render(<NodesPage />);
    const cell = await screen.findByTestId("node-liveness");
    expect(cell).toHaveAttribute("data-liveness", "down");
    expect(await screen.findByTestId("node-last-error")).toHaveTextContent("connection refused");
  });

  it("keeps asking, so the operator does not have to refresh", async () => {
    // Troy's ask, and the reason for it: the data he is waiting for
    // arrives seconds after he unlocks, from the root's own poller.
    withNodes([{ name: "Amish_Station", role: "worker", reachable: false, url: "http://a:8079" }]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<NodesPage />);
      await screen.findByTestId("node-liveness");
      const nodeReads = () =>
        calls.filter(
          (c) =>
            c.method === "GET" && c.url.includes("/v1/nodes") && !c.url.includes("join-tokens"),
        ).length;
      const before = nodeReads();
      await vi.advanceTimersByTimeAsync(5000);
      const after = nodeReads();
      // At 2 s, five seconds is at least two more reads.
      expect(after).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the last good list when one poll fails", async () => {
    // At one shot a blanked table was the same as an empty one. At two
    // seconds a single missed round trip would flicker every row away
    // and back, on the page someone opens when they already suspect
    // something is wrong.
    let fail = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          });
        if (url.includes("/v1/nodes/join-tokens")) return json({ tokens: [] });
        if (url.includes("/v1/nodes")) {
          if (fail) return json({ detail: "boom" }, 500);
          return json(NODES);
        }
        return json({});
      }),
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<NodesPage />);
      // Scoped to the table: the shell's own tree names machines too.
      const row = async () => within(await screen.findByRole("table")).queryByText("Amish_Station");
      expect(await row()).toBeTruthy();
      fail = true;
      await vi.advanceTimersByTimeAsync(5000);
      expect(await row()).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("join tokens can be withdrawn", () => {
  beforeEach(() => {
    sealed = false;
    tokenRows = [
      { id: "a1b2c3d4e5f60718", expiresAt: "2099-01-01T00:15:00Z", nodeName: "attic", used: false },
    ];
  });

  it("lists what is outstanding, with no token in it", async () => {
    render(<NodesPage />);
    const row = await screen.findByTestId("token-row");
    expect(row).toHaveTextContent("a1b2c3d4e5f60718");
    expect(row).toHaveTextContent("attic");
  });

  it("revokes by id, against the control root", async () => {
    // The id is a handle, not the token — so this is the one thing the
    // page can do to a credential it was shown exactly once.
    render(<NodesPage />);
    await screen.findByTestId("token-row");
    tokenRows = [];
    await userEvent.click(screen.getByTestId("revoke-token"));

    await waitFor(() => {
      const call = calls.find((c) => c.method === "DELETE");
      expect(call?.url).toContain("/v1/nodes/join-tokens/a1b2c3d4e5f60718");
      expect(call?.url).toContain("control");
    });
    await waitFor(() => expect(screen.queryByTestId("token-row")).toBeNull());
  });

  it("shows nothing at all when there is nothing outstanding", async () => {
    tokenRows = [];
    render(<NodesPage />);
    await screen.findByRole("table");
    expect(screen.queryByTestId("outstanding-tokens")).toBeNull();
  });
});
