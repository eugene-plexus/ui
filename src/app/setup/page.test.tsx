/**
 * What the first-run wizard actually asks of the install.
 *
 * These tests drive the real screens and assert the *sequence of HTTP calls*
 * Start makes, because that sequence is where every wizard defect so far has
 * lived: a screen that looked right and quietly wrote nothing, or wrote to a
 * component that could not exist yet. Layout is not the subject here.
 *
 * `fetch` is mocked at the boundary the api client uses, so a call's target is
 * readable straight off the URL: `/api/proxy/<target>/<path>`.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import WizardPage from "./page";

/**
 * Router and recorder are rebound per test rather than shared and cleared.
 *
 * Start is a long async transaction, and a test that fails partway leaves it
 * in flight: the component unmounts but the promise chain keeps going and
 * keeps calling. Shared-and-cleared doubles cause that stray work to land in
 * the *next* test's assertions, which is how one real failure here first
 * presented as four. Binding at render/stub time sends it to the test that
 * started it, where it is ignored.
 */
let replace = vi.fn();
vi.mock("next/navigation", () => ({
  // `replace` is read when the component renders, so each render captures the
  // function belonging to the test that rendered it.
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}));

/** One recorded request, reduced to what an assertion cares about. */
interface Call {
  method: string;
  /** `/api/proxy/` stripped, so a target reads off the front:
   * `agent/v1/auth/initialize`. */
  route: string;
  body: Record<string, unknown> | undefined;
}

type Handler = () => { status: number; body?: unknown };

let calls: Call[];
let handlers: Map<string, Handler>;

/** Every route the wizard touches on the shortest complete path, answered the
 * way a healthy fresh install answers it. Individual tests override one entry
 * to describe the install they mean. */
function healthyInstall(): Map<string, Handler> {
  return new Map<string, Handler>([
    [
      "POST agent/v1/auth/initialize",
      () => ({
        status: 200,
        body: { sessionToken: "test-token", expiresAt: "2099-01-01T00:00:00Z" },
      }),
    ],
    [
      "GET agent/v1/components",
      () => ({
        status: 200,
        body: {
          components: [
            { name: "control", kind: "control", url: "http://127.0.0.1:8083/" },
            { name: "gateway", kind: "gateway", url: "http://127.0.0.1:8080/" },
            { name: "library", kind: "library", url: "http://127.0.0.1:8082/" },
          ],
        },
      }),
    ],
    ["POST control/v1/auth/initialize", () => ({ status: 204 })],
    // The control host's agent enrolls with the root it just spawned -
    // "every node enrolls the same way, including the control host's",
    // which nothing outside an acceptance script had ever done. Skipping
    // it leaves the agent's signing key and the install's unrelated, so
    // the session this browser holds does not verify at the control root.
    [
      "POST control/v1/auth/login",
      () => ({ status: 200, body: { sessionToken: "control-token" } }),
    ],
    ["POST control/v1/nodes/join-token", () => ({ status: 201, body: { token: "join-token" } })],
    ["POST agent/v1/node/enroll", () => ({ status: 200, body: { enrolled: true } })],
    [
      "POST agent/v1/auth/login",
      () => ({ status: 200, body: { sessionToken: "post-enroll-token" } }),
    ],
    ["PATCH agent/v1/config", () => ({ status: 200, body: {} })],
    ["PATCH library/v1/config", () => ({ status: 200, body: {} })],
  ]);
}

function key(call: Call): string {
  return `${call.method} ${call.route}`;
}

/** Only the calls a test names, in order, so an assertion about the trust root
 * survives an unrelated step being added elsewhere in the sequence. */
function routesFrom(names: string[]): string[] {
  return calls.map(key).filter((k) => names.includes(k));
}

beforeEach(() => {
  const recorder: Call[] = [];
  const routes = healthyInstall();
  calls = recorder;
  handlers = routes;
  replace = vi.fn();
  sessionStorage.clear();
  localStorage.clear();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? "GET",
        route: String(input).replace(/^\/api\/proxy\//, ""),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      // `recorder`/`routes`, not `calls`/`handlers`: bound to this test even
      // when a previous test's transaction is still running.
      recorder.push(call);
      const handler = routes.get(key(call));
      // An unhandled route is a test-authoring mistake, and it must not look
      // like a component being down: withRetry swallows failures, so a 500
      // here would burn ten seconds and then report the wrong cause.
      const result = handler
        ? handler()
        : { status: 418, body: { detail: { title: `unhandled route: ${key(call)}` } } };
      // `null`, not `""`: 204 is a null-body status and the Response
      // constructor throws on a body of any kind with one. Control's
      // initialize answers 204 on success, so getting this wrong made the
      // success path look like a component that would not answer.
      return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
        status: result.status,
        statusText: String(result.status),
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** `delay: null` types a passphrase in one tick instead of one per character.
 * A whole walk at the default keystroke delay is most of a five-second test
 * budget spent proving that typing works. */
function newUser() {
  return userEvent.setup({ delay: null });
}

/** Click through to the last screen with a passphrase set and nothing else
 * chosen: the shortest path a real operator can take, and the likeliest shape
 * of an actual first run. */
async function walkToLastScreen(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Continue →" }));

  // Screen 2, Security, is the only screen that gates Continue.
  await user.type(
    await screen.findByPlaceholderText(/a line of poetry/i),
    "correct horse battery staple",
  );
  await user.type(
    screen.getByPlaceholderText(/repeat the passphrase/i),
    "correct horse battery staple",
  );

  // Screens 3 and 4 are accept-the-default. Asserted by heading rather
  // than counted: a loop of clicks lands on whatever screen the flow
  // happens to have, which is how a test keeps passing while looking at
  // something other than its subject.
  await user.click(screen.getByRole("button", { name: "Continue →" }));
  await screen.findByRole("heading", { name: /^Your models$/ });
  await user.click(screen.getByRole("button", { name: "Continue →" }));
  await screen.findByRole("heading", { name: /^Add a backend$/ });
  await user.click(screen.getByRole("button", { name: "Continue →" }));
  await screen.findByRole("heading", { name: /^Ready$/ });
  return screen.findByRole("button", { name: "Start" });
}

describe("first-run wizard: what Start writes", () => {
  it("initializes the control root, not just the agent", async () => {
    const user = newUser();
    render(<WizardPage />);
    await user.click(await walkToLastScreen(user));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"), { timeout: 5000 });

    // The defect this test exists for: a first run set the operator passphrase
    // on the agent and left the trust root with none, so control sat degraded
    // and 503'd its whole surface - node registry, join tokens, even its own
    // /v1/config - on an install the wizard had called finished.
    expect(routesFrom(["POST control/v1/auth/initialize"])).toEqual([
      "POST control/v1/auth/initialize",
    ]);

    // The same passphrase as the agent. A second secret for the same operator
    // is a second thing to lose, and losing this one loses every sealed secret
    // in the install.
    const init = calls.find((c) => key(c) === "POST control/v1/auth/initialize");
    expect(init?.body).toEqual({ passphrase: "correct horse battery staple" });

    // Order matters twice over: the trust root is initialized only after the
    // topology read has confirmed there is one, and before firstRunComplete
    // declares the install set up.
    //
    // The topology is read twice on purpose and the first one leads. On mount
    // the wizard asks unauthenticated, for the summary, and tolerates the 401
    // a fresh install gives it; the read that decides anything is the one
    // after a token exists. Conflating the two is what once let the wizard
    // accuse a healthy install of having no components at all.
    expect(
      routesFrom([
        "POST agent/v1/auth/initialize",
        "GET agent/v1/components",
        "POST control/v1/auth/initialize",
        "PATCH agent/v1/config",
      ]),
    ).toEqual([
      "GET agent/v1/components",
      "POST agent/v1/auth/initialize",
      "GET agent/v1/components",
      "POST control/v1/auth/initialize",
      "PATCH agent/v1/config",
    ]);
  });

  it("treats an already-initialized control root as done, not as a failure", async () => {
    // Re-running setup against an install whose trust root is already set up
    // is not an error, and 409 must not be retried: it is the final answer.
    handlers.set("POST control/v1/auth/initialize", () => ({
      status: 409,
      body: { detail: { title: "Already initialized" } },
    }));

    const user = newUser();
    render(<WizardPage />);
    await user.click(await walkToLastScreen(user));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"), { timeout: 5000 });
    expect(calls.filter((c) => key(c) === "POST control/v1/auth/initialize")).toHaveLength(1);
  });

  it("does not call the install finished when the trust root will not initialize", async () => {
    // Deliberately wordless about what went wrong, so the assertion below
    // is about the wizard's own explanation and cannot be satisfied by this
    // fixture's phrasing leaking through.
    handlers.set("POST control/v1/auth/initialize", () => ({
      status: 500,
      body: { detail: { title: "Kaboom", detail: "kaboom" } },
    }));

    const user = newUser();
    render(<WizardPage />);
    await user.click(await walkToLastScreen(user));

    await screen.findByText(/trust root would not accept a passphrase/i, {}, { timeout: 20000 });
    // The install is half-made either way - the agent's passphrase is set
    // and cannot be unset from here - so the honest outcome is to say so,
    // not to flip firstRunComplete and send the operator to a dashboard
    // backed by an inert trust root.
    expect(calls.map(key)).not.toContain("PATCH agent/v1/config");
    expect(replace).not.toHaveBeenCalledWith("/");
  }, 30000);

  it("points the library at model directories only when some were given", async () => {
    const user = newUser();
    render(<WizardPage />);
    await user.click(await walkToLastScreen(user));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"), { timeout: 5000 });
    expect(calls.map(key)).not.toContain("PATCH library/v1/config");
  });
});
