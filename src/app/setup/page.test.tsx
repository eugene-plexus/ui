/**
 * What the first-run wizard actually asks of the install.
 *
 * These tests drive the real screens and assert the *sequence of HTTP calls*
 * each button makes, because that sequence is where every wizard defect so
 * far has lived: a screen that looked right and quietly wrote nothing, or
 * wrote to a component that could not exist yet. Layout is not the subject
 * here.
 *
 * Two screens since S2 of the hobbyist UX plan, each with a button that
 * writes: Continue commits the passphrase step (initialize, components,
 * trust root, enroll, reboot choice) and Finish commits where models live.
 * The tests below are split the same way, plus the one property the split
 * created: a visit to an install whose passphrase is already set opens on
 * screen 2 (§10 trap 8).
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
 * Continue is a long async transaction, and a test that fails partway leaves
 * it in flight: the component unmounts but the promise chain keeps going and
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

const PROPOSED = "C:\\Users\\sam\\Eugene Models";

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
    // S0: the wizard asks, before it has a token, whether this host can
    // keep Eugene unlocked across a reboot. The healthy fixture says no -
    // the CI runner's truth - so the sequence tests below see the default
    // path; the keyring tests flip it. `initialized: false` is what opens
    // the wizard on screen 1; the resume test flips that too.
    [
      "GET agent/v1/auth/status",
      () => ({
        status: 200,
        body: { initialized: false, unlocked: false, keyringAvailable: false },
      }),
    ],
    ["GET agent/v1/config", () => ({ status: 200, body: { firstRunComplete: false } })],
    ["PATCH control/v1/config", () => ({ status: 200, body: {} })],
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
    ["POST library/v1/scan", () => ({ status: 202, body: { state: "running" } })],
    // S2: screen 2 asks the library for its host's starting points and
    // proposes a folder under the `Home` entry. A Windows home here, so a
    // wrong separator in the proposal cannot pass as a POSIX one.
    [
      "GET library/v1/directories",
      () => ({
        status: 200,
        body: {
          host: "sam-pc",
          entries: [
            { name: "C:\\", path: "C:\\", kind: "directory" },
            { name: "Home", path: "C:\\Users\\sam", kind: "directory" },
          ],
        },
      }),
    ],
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

/** Screen 1 with a passphrase typed and Continue pressed: the shortest path a
 * real person can take, and the likeliest shape of an actual first run.
 * Resolves once screen 2 has rendered. */
async function continuePastPassphrase(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("heading", { name: /^Choose a passphrase$/ });
  await user.type(screen.getByPlaceholderText(/a line of poetry/i), "correct horse battery staple");
  await user.type(
    screen.getByPlaceholderText(/repeat the passphrase/i),
    "correct horse battery staple",
  );
  await user.click(screen.getByRole("button", { name: "Continue" }));
  // Asserted by heading rather than assumed: a click that lands on whatever
  // screen the flow happens to have is how a test keeps passing while
  // looking at something other than its subject.
  await screen.findByRole("heading", { name: /^Where should models live\?$/ }, { timeout: 5000 });
}

async function finish(user: ReturnType<typeof userEvent.setup>) {
  // Finish is disabled until the proposal has arrived (or a folder is
  // typed), so wait for the button to be pressable rather than clicking a
  // disabled one and asserting on silence.
  const button = screen.getByRole("button", { name: "Finish" });
  await waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}

describe("screen 1: what Continue commits", () => {
  it("initializes the agent, checks the components, initializes the trust root and enrolls - and writes nothing about models", async () => {
    const user = newUser();
    render(<WizardPage />);
    await continuePastPassphrase(user);

    // The defect the trust-root step exists for: a first run set the
    // operator passphrase on the agent and left the trust root with none,
    // so control sat degraded and 503'd its whole surface - node registry,
    // join tokens, even its own /v1/config - on an install the wizard had
    // called finished.
    const init = calls.find((c) => key(c) === "POST control/v1/auth/initialize");
    expect(init?.body).toEqual({ passphrase: "correct horse battery staple" });

    // Order matters: the trust root is initialized only after the topology
    // read has confirmed there is one, and enrollment follows it.
    expect(
      routesFrom([
        "POST agent/v1/auth/initialize",
        "GET agent/v1/components",
        "POST control/v1/auth/initialize",
        "POST control/v1/auth/login",
        "POST control/v1/nodes/join-token",
        "POST agent/v1/node/enroll",
        "POST agent/v1/auth/login",
      ]),
    ).toEqual([
      "POST agent/v1/auth/initialize",
      "GET agent/v1/components",
      "POST control/v1/auth/initialize",
      "POST control/v1/auth/login",
      "POST control/v1/nodes/join-token",
      "POST agent/v1/node/enroll",
      "POST agent/v1/auth/login",
    ]);

    // Continue is half the transaction. Where models live is screen 2's
    // question, and the install is not finished until it is answered.
    expect(calls.map(key)).not.toContain("PATCH library/v1/config");
    expect(calls.map(key)).not.toContain("PATCH agent/v1/config");
    expect(replace).not.toHaveBeenCalled();
    // The session it holds now is the one signed with the install's key.
    expect(sessionStorage.getItem("eugene-session-token")).toBe("post-enroll-token");
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
    await continuePastPassphrase(user);
    expect(calls.filter((c) => key(c) === "POST control/v1/auth/initialize")).toHaveLength(1);
  });

  it("stops before enrolling and before screen 2 when the control root will not initialize", async () => {
    // Deliberately wordless about what went wrong, so the assertion below
    // is about the wizard's own explanation and cannot be satisfied by this
    // fixture's phrasing leaking through.
    handlers.set("POST control/v1/auth/initialize", () => ({
      status: 500,
      body: { detail: { title: "Kaboom", detail: "kaboom" } },
    }));

    const user = newUser();
    render(<WizardPage />);
    await screen.findByRole("heading", { name: /^Choose a passphrase$/ });
    await user.type(
      screen.getByPlaceholderText(/a line of poetry/i),
      "correct horse battery staple",
    );
    await user.type(
      screen.getByPlaceholderText(/repeat the passphrase/i),
      "correct horse battery staple",
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // R1.5 rewrote this sentence (review §6.3 #35): it named the "trust
    // root", ran to seventy words, and ended by telling somebody in a
    // browser to POST JSON and read a PowerShell script.
    const error = await screen.findByText(
      /control root did not take the passphrase/i,
      {},
      { timeout: 20000 },
    );
    expect(error).toHaveClass("status-error");
    // And it points at the diagnosis instead of at a shell.
    expect(error).toHaveTextContent(/Needs attention/i);
    expect(error.textContent ?? "").not.toMatch(/POST|\/v1\/auth\/initialize|dev-seed/i);
    // The install is half-made either way - the agent's passphrase is set
    // and cannot be unset from here - so the honest outcome is to say so on
    // the screen the person is on, not to enroll, move on, or flip
    // firstRunComplete.
    expect(screen.getByRole("heading", { name: /^Choose a passphrase$/ })).toBeInTheDocument();
    expect(calls.map(key)).not.toContain("POST agent/v1/node/enroll");
    expect(calls.map(key)).not.toContain("PATCH agent/v1/config");
    expect(replace).not.toHaveBeenCalledWith("/");
  }, 30000);

  it("defaults to the keyring where the host has one, and writes it to BOTH processes", async () => {
    handlers.set("GET agent/v1/auth/status", () => ({
      status: 200,
      body: { initialized: false, unlocked: false, keyringAvailable: true },
    }));

    const user = newUser();
    render(<WizardPage />);

    // The default follows the measurement, not the platform and not a
    // hard-coded "prompt".
    const box = await screen.findByRole("checkbox", { name: /unlock eugene on its own/i });
    await waitFor(() => expect(box).toBeChecked());
    expect(box).toBeEnabled();
    expect(screen.queryByTestId("no-keyring-note")).toBeNull();

    await continuePastPassphrase(user);

    // Both processes hold a master key on this host, and both read the
    // field. The stale comment this replaced said the root ignored it.
    const agentPatches = calls.filter((c) => key(c) === "PATCH agent/v1/config");
    const controlPatches = calls.filter((c) => key(c) === "PATCH control/v1/config");
    expect(agentPatches.map((c) => c.body)).toEqual([{ securityMode: "os_keyring" }]);
    expect(controlPatches.map((c) => c.body)).toEqual([{ securityMode: "os_keyring" }]);

    // After enrollment, so one credential reaches both.
    expect(
      routesFrom(["POST agent/v1/node/enroll", "PATCH control/v1/config", "PATCH agent/v1/config"]),
    ).toEqual(["POST agent/v1/node/enroll", "PATCH agent/v1/config", "PATCH control/v1/config"]);
  });

  it("says plainly when there is no keyring, and writes nothing about it", async () => {
    // healthyInstall() already answers keyringAvailable: false.
    render(<WizardPage />);

    const box = await screen.findByRole("checkbox", { name: /unlock eugene on its own/i });
    await waitFor(() => expect(screen.getByTestId("no-keyring-note")).toBeVisible());
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(screen.getByTestId("no-keyring-note").textContent).toMatch(/ask for the passphrase/i);
  });

  it("keeps a choice the operator made before a tab refresh", async () => {
    handlers.set("GET agent/v1/auth/status", () => ({
      status: 200,
      body: { initialized: false, unlocked: false, keyringAvailable: true },
    }));
    sessionStorage.setItem(
      "eugene-wizard-draft",
      JSON.stringify({
        modelRoots: [],
        folderChoice: "make",
        customFolder: null,
        securityMode: "prompt_on_startup",
      }),
    );
    render(<WizardPage />);
    const box = await screen.findByRole("checkbox", { name: /unlock eugene on its own/i });
    // Give the probe every chance to (wrongly) flip it.
    await new Promise((r) => setTimeout(r, 50));
    expect(box).not.toBeChecked();
  });

  it("never writes the passphrase to storage", async () => {
    const user = newUser();
    render(<WizardPage />);
    await screen.findByRole("heading", { name: /^Choose a passphrase$/ });
    await user.type(screen.getByPlaceholderText(/a line of poetry/i), "hunter2");
    await waitFor(() => expect(sessionStorage.getItem("eugene-wizard-draft")).not.toBeNull());
    expect(sessionStorage.getItem("eugene-wizard-draft")).not.toContain("hunter2");
  });
});

describe("screen 2: what Finish commits", () => {
  it("proposes a folder under the library host's home, and Finish writes it, then firstRunComplete, then opens Home", async () => {
    const user = newUser();
    render(<WizardPage />);
    await continuePastPassphrase(user);

    // The default: a folder Eugene will make, named and placed where the
    // person can find it in a file manager. Joined with the separator the
    // home path's shape implies - this one is Windows.
    const make = screen.getByRole("radio", { name: /make a folder for me/i });
    expect(make).toBeChecked();
    await waitFor(() => expect(screen.getByTestId("proposed-folder")).toHaveTextContent(PROPOSED));
    expect(
      screen.getByText(/nothing is created until the first download lands there/i),
    ).toBeInTheDocument();

    await finish(user);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"), { timeout: 5000 });

    const roots = calls.find((c) => key(c) === "PATCH library/v1/config");
    expect(roots?.body).toEqual({ modelRoots: [PROPOSED] });
    const done = calls.filter((c) => key(c) === "PATCH agent/v1/config");
    expect(done.map((c) => c.body)).toEqual([{ firstRunComplete: true }]);
    // The folder lands before the install calls itself set up.
    expect(routesFrom(["PATCH library/v1/config", "PATCH agent/v1/config"])).toEqual([
      "PATCH library/v1/config",
      "PATCH agent/v1/config",
    ]);
    expect(sessionStorage.getItem("eugene-wizard-draft")).toBeNull();
  });

  it("looks in the folder it was just given", async () => {
    // Found by S10's first execution on a fresh install: the library
    // boots with no roots and logs "skipping the startup scan", the
    // wizard then writes the root with a PATCH that deliberately does
    // not scan, and nothing ever goes back to look -- so somebody who
    // pointed at a folder full of models lands on a Home reading
    // "0 models on disk" that offers to download a 16 GB one.
    const user = newUser();
    render(<WizardPage />);
    await continuePastPassphrase(user);
    await waitFor(() => expect(screen.getByTestId("proposed-folder")).toHaveTextContent(PROPOSED));
    await finish(user);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"), { timeout: 5000 });

    // After the folder is saved, and before the install calls itself set
    // up: a scan of a folder that is not recorded yet finds nothing.
    expect(routesFrom(["PATCH library/v1/config", "POST library/v1/scan"])).toEqual([
      "PATCH library/v1/config",
      "POST library/v1/scan",
    ]);
  });

  it("finishes anyway when the library will not scan", async () => {
    // The folder is saved either way and the Library's own Scan button is
    // the retry. An install whose library is briefly away should finish
    // setup rather than fail it.
    handlers.set("POST library/v1/scan", () => ({ status: 503, body: { detail: "away" } }));
    const user = newUser();
    render(<WizardPage />);
    await continuePastPassphrase(user);
    await waitFor(() => expect(screen.getByTestId("proposed-folder")).toHaveTextContent(PROPOSED));
    await finish(user);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"), { timeout: 5000 });
    expect(calls.filter((c) => key(c) === "PATCH agent/v1/config").map((c) => c.body)).toEqual([
      { firstRunComplete: true },
    ]);
  });

  it("writes an edited proposal as typed", async () => {
    const user = newUser();
    render(<WizardPage />);
    await continuePastPassphrase(user);
    await waitFor(() => expect(screen.getByTestId("proposed-folder")).toHaveTextContent(PROPOSED));

    await user.click(screen.getByRole("button", { name: "change" }));
    const field = screen.getByRole("textbox", { name: "Folder to make" });
    expect(field).toHaveValue(PROPOSED);
    await user.clear(field);
    await user.type(field, "D:\\LLM");

    await finish(user);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"), { timeout: 5000 });
    expect(calls.find((c) => key(c) === "PATCH library/v1/config")?.body).toEqual({
      modelRoots: ["D:\\LLM"],
    });
  });

  it("writes the folder a person who already has models typed, and not the proposal", async () => {
    const user = newUser();
    render(<WizardPage />);
    await continuePastPassphrase(user);

    await user.click(screen.getByRole("radio", { name: /i already have models/i }));
    // The proposal is off the table the moment the other radio is chosen,
    // so an empty row here must disable Finish rather than write nothing.
    expect(screen.getByRole("button", { name: "Finish" })).toBeDisabled();
    await user.type(screen.getByPlaceholderText(/D:\\models/), "/srv/models");

    await finish(user);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"), { timeout: 5000 });
    expect(calls.find((c) => key(c) === "PATCH library/v1/config")?.body).toEqual({
      modelRoots: ["/srv/models"],
    });
  });

  it("opens on screen 2 when the passphrase step is already committed", async () => {
    // §10 trap 8: a tab closed after Continue left an initialized,
    // enrolled install with no models folder. The next visit has nothing
    // to redo on screen 1 and must not offer a passphrase form for an
    // install whose passphrase exists.
    handlers.set("GET agent/v1/auth/status", () => ({
      status: 200,
      body: { initialized: true, unlocked: true, keyringAvailable: false },
    }));
    sessionStorage.setItem("eugene-session-token", "existing-session");

    render(<WizardPage />);
    await screen.findByRole("heading", { name: /^Where should models live\?$/ });
    expect(screen.queryByRole("heading", { name: /^Choose a passphrase$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    // Nothing from screen 1 is re-run.
    expect(calls.map(key)).not.toContain("POST agent/v1/auth/initialize");
    expect(calls.map(key)).not.toContain("POST control/v1/auth/initialize");
    // And the folder proposal is asked for, under the session that exists.
    await waitFor(() => expect(screen.getByTestId("proposed-folder")).toHaveTextContent(PROPOSED));
  });

  it("sends a committed install with no session to sign in, and returns here", async () => {
    handlers.set("GET agent/v1/auth/status", () => ({
      status: 200,
      body: { initialized: true, unlocked: true, keyringAvailable: false },
    }));
    render(<WizardPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?next=%2Fsetup"));
  });

  it("leaves a finished install alone", async () => {
    // A wander to /setup on an install that is set up must not offer to
    // overwrite its folders with the proposal.
    handlers.set("GET agent/v1/auth/status", () => ({
      status: 200,
      body: { initialized: true, unlocked: true, keyringAvailable: false },
    }));
    handlers.set("GET agent/v1/config", () => ({ status: 200, body: { firstRunComplete: true } }));
    sessionStorage.setItem("eugene-session-token", "existing-session");
    render(<WizardPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(calls.map(key)).not.toContain("GET library/v1/directories");
  });
});
