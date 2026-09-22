import { describe, expect, it } from "vitest";

import {
  SAMPLE_TICKET,
  buildRequest,
  curlLine,
  describeAnswer,
  sampleQuestions,
  sdkSnippet,
} from "./decisions";

describe("the sample request", () => {
  it("carries one of each pinned question kind", () => {
    const questions = sampleQuestions();
    expect(Object.values(questions).map((q) => q.type)).toEqual(["noul", "choice", "score"]);
    // The protocol's own bounds, respected by our own sample: 2-10
    // ordered score levels, choice options under 255.
    const urgency = questions.urgency;
    expect(urgency).toBeDefined();
    expect(Array.isArray(urgency?.criteria)).toBe(true);
    expect((urgency?.criteria as string[]).length).toBeGreaterThanOrEqual(2);
  });

  it("builds the TypeSafe shape verbatim", () => {
    const request = buildRequest("tickets", SAMPLE_TICKET, sampleQuestions());
    expect(Object.keys(request).sort()).toEqual(["model", "questions", "state"]);
    expect(request.model).toBe("tickets");
  });
});

describe("the curl line", () => {
  it("targets /v1/systemone with the bearer placeholder in double quotes", () => {
    const line = curlLine("http://192.168.16.75:8080/", buildRequest("t", "x", sampleQuestions()));
    expect(line).toContain("http://192.168.16.75:8080/v1/systemone");
    // The playground-diagnostic lesson: a single-quoted placeholder is
    // sent literally; only double quotes expand.
    expect(line).toContain('"Authorization: Bearer $EUGENE_PLEXUS_TOKEN"');
  });

  it("escapes non-ASCII so Git Bash on Windows cannot shorten the body", () => {
    const line = curlLine("http://h", buildRequest("t", "minus 3°C", sampleQuestions()));
    expect(line).toContain("\\u00b0");
    expect(line).not.toContain("°");
  });
});

describe("the SDK snippet", () => {
  it("pins the client and turns its automatic retries off", () => {
    const snippet = sdkSnippet("http://h:8080", "tickets");
    expect(snippet).toContain("typesafe==1.13.*");
    // A retried decision is a second decision: the pinned docs say the
    // SDKs retry by default, so the example must disable it visibly.
    expect(snippet).toContain("max_retries=0");
    expect(snippet).toContain('model="tickets"');
  });
});

describe("the answer inspector", () => {
  it("reads a noul as a percentage of yes", () => {
    expect(describeAnswer("refunded", { type: "noul", noul: 0.98 })).toBe("refunded: 98% yes");
  });

  it("reads a choice with its confidence", () => {
    expect(
      describeAnswer("route", {
        type: "choice",
        choice: "billing",
        probabilities: { billing: 0.84 },
        confidence: 0.76,
      }),
    ).toBe("route: billing (confidence 76%)");
  });

  it("reads a score against its legend", () => {
    expect(
      describeAnswer("urgency", {
        type: "score",
        score: 0.75,
        legend: { "0": "low", "1": "medium", "2": "high" },
        probabilities: { "0": 0.41, "1": 0.43, "2": 0.16 },
      }),
    ).toContain('nearest level "medium"');
  });
});
