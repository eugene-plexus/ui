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

import { describe, expect, it } from "vitest";

import { ApiError, describeError, problemMessage } from "./api";

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
