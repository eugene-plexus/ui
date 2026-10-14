/**
 * Unwrapping the sentence a component wrote.
 *
 * Reported from the live install: clicking Gateway on a worker node
 * showed `503 Service Unavailable — {"detail":{"type":"https://…
 * #target-not-in-topology","title":"Target not in topology","status":
 * 503,"detail":"No component of kind 'gateway' …"}}`. The agent had
 * written a paragraph explaining exactly what to do; the screen printed
 * the envelope around it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, describeError, postStream, problemMessage } from "./api";
import { getSessionToken, setSessionToken } from "./session";

describe("problemMessage", () => {
  it("reads the nested Problem FastAPI actually produces", () => {
    // The shape the report was made against, verbatim in structure.
    expect(
      problemMessage({
        detail: {
          type: "https://github.com/eugene-plexus/agent#target-not-in-topology",
          title: "Target not in topology",
          status: 503,
          detail: "No component of kind 'gateway' is declared on this node.",
          component: "agent",
        },
      }),
    ).toBe("No component of kind 'gateway' is declared on this node.");
  });

  it("falls back to the title when a Problem carries no detail", () => {
    expect(problemMessage({ detail: { title: "Locked", status: 503 } })).toBe("Locked");
  });

  it("reads a bare string detail, which is what FastAPI's own errors are", () => {
    expect(problemMessage({ detail: "Not authenticated" })).toBe("Not authenticated");
  });

  it("reads OpenAI's envelope, which /v1/chat/completions answers with", () => {
    expect(problemMessage({ error: { message: "no backend for model 'x'" } })).toBe(
      "no backend for model 'x'",
    );
  });

  it("reads a Problem returned without FastAPI's wrapper", () => {
    expect(problemMessage({ title: "No node reachable", status: 503 })).toBe("No node reachable");
  });

  it("returns null rather than a stringified object when there is no sentence", () => {
    // The null is load-bearing: callers print the status line instead,
    // and a helper that returned "[object Object]" here would look like
    // it worked.
    expect(problemMessage({ nothing: "useful" })).toBeNull();
    expect(problemMessage(null)).toBeNull();
    expect(problemMessage(undefined)).toBeNull();
  });

  it("passes a plain-text body through", () => {
    expect(problemMessage("upstream sent an empty reply")).toBe("upstream sent an empty reply");
  });
});

describe("describeError", () => {
  it("prefers the component's sentence over the status line", () => {
    const error = new ApiError(503, "Service Unavailable", {
      detail: { detail: "The install's gateway runs on node 'root'." },
    });
    expect(describeError(error)).toBe("The install's gateway runs on node 'root'.");
  });

  it("falls back to the status line when the body says nothing", () => {
    expect(describeError(new ApiError(502, "Bad Gateway", ""))).toBe("502 Bad Gateway");
  });

  it("handles an error that is not an ApiError at all", () => {
    expect(describeError(new Error("Failed to fetch"))).toBe("Failed to fetch");
  });
});

/**
 * A refused session says so on the sign-in page.
 *
 * The api client already cleared the token and went to `/login` on a
 * 401, and the login page then read exactly as it does for someone who
 * had never signed in: nothing said the session had ended, so a person
 * reading a page one moment and a passphrase box the next had no idea
 * why. `reason=expired` is the one bit the login page needs, and it is
 * only true when a session was actually sent.
 */
describe("a 401 on a signed-in request", () => {
  let replace: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    replace = vi.fn();
    vi.stubGlobal("location", {
      pathname: "/library/",
      search: "?sel=library",
      replace,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "expired" }), { status: 401 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const NEXT = encodeURIComponent("/library/?sel=library");

  it("clears the session and says it ended", async () => {
    setSessionToken("old-token");
    await expect(api.get("agent", "/v1/config")).rejects.toBeInstanceOf(ApiError);
    expect(getSessionToken()).toBeNull();
    expect(replace).toHaveBeenCalledWith(`/login?next=${NEXT}&reason=expired`);
  });

  it("does not say a session ended when there was none", async () => {
    await expect(api.get("agent", "/v1/config")).rejects.toBeInstanceOf(ApiError);
    expect(replace).toHaveBeenCalledWith(`/login?next=${NEXT}`);
  });

  it("says so for every request that carried the session, not just the first", async () => {
    // Home polls several things at once. The first 401 clears the token,
    // and a check made at response time would find it gone for the rest -
    // whose navigation, being later, is the one the browser keeps.
    setSessionToken("old-token");
    await Promise.allSettled([
      api.get("agent", "/v1/config"),
      api.get("library", "/v1/models"),
      api.get("gateway", "/v1/models"),
    ]);
    expect(replace).toHaveBeenCalledTimes(3);
    for (const [url] of replace.mock.calls) expect(url).toContain("&reason=expired");
  });

  it("the streaming path does the same, which it used to skip entirely", async () => {
    setSessionToken("old-token");
    await expect(
      postStream("gateway", "/v1/chat/completions", { model: "m", messages: [] }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(getSessionToken()).toBeNull();
    expect(replace).toHaveBeenCalledWith(`/login?next=${NEXT}&reason=expired`);
  });

  it("a supplied bearer being refused is not the session", async () => {
    setSessionToken("old-token");
    await expect(
      postStream("gateway", "/v1/chat/completions", {}, { bearer: "someone-else" }),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      api.get("control", "/v1/nodes", { bearer: "someone-else" }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(getSessionToken()).toBe("old-token");
    expect(replace).not.toHaveBeenCalled();
  });
});
