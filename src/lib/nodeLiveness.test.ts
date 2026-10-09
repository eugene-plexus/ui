import { describe, expect, it } from "vitest";

import { describeLiveness, nodeLiveness } from "./nodeLiveness";

/**
 * The rule. The *wiring* — that the page renders three words and polls
 * fast enough to leave the third behind — is in `nodes/page.test.tsx`.
 */
describe("nodeLiveness", () => {
  it("reads a fresh root as not-yet-checked rather than down", () => {
    // The reported case exactly: unlock, and the root holds no
    // observations at all. Every node arrives `reachable: false` with
    // nothing else said.
    expect(nodeLiveness({ reachable: false })).toBe("unchecked");
    expect(nodeLiveness({ reachable: false, lastError: null, lastSeenAt: null })).toBe("unchecked");
  });

  it("reads a failed probe as down, because it said why", () => {
    // Every `reachable: false` the probe client produces carries an
    // error; there is no branch that fails without one. That is what
    // makes the absence of a reason mean "no observation" rather than
    // "no explanation".
    expect(nodeLiveness({ reachable: false, lastError: "connection refused" })).toBe("down");
    expect(
      nodeLiveness({
        reachable: false,
        lastError: "HTTP 401: The token is not yet valid (iat)",
        lastSeenAt: "2026-09-17T12:00:00Z",
      }),
    ).toBe("down");
  });

  it("reads a node that WAS reached and then was not as down, not unchecked", () => {
    // A `lastSeenAt` with no current error is a node this root has
    // observed at some point. Calling that "checking" would hide a real
    // outage behind a word that means "wait a moment".
    expect(nodeLiveness({ reachable: false, lastSeenAt: "2026-09-17T12:00:00Z" })).toBe("down");
  });

  it("reachable wins over everything, including a stale error", () => {
    expect(nodeLiveness({ reachable: true, lastError: "old news" })).toBe("reachable");
  });

  it("never says the word down for a node nothing has looked at", () => {
    // The whole point: an operator who has just unlocked a root is
    // deciding whether something is broken, and a wrong answer there
    // sends them to the worker's logs.
    const { label, title } = describeLiveness("unchecked");
    expect(label).not.toMatch(/down/i);
    expect(title).toContain("not a report");
  });
});
