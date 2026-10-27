import { describe, expect, it } from "vitest";

import {
  RE_ENROLL_HREF,
  describeRefusal,
  refusalText,
  unverifiedLine,
  type AnnouncementRefusal,
} from "./announcementRefusal";

function refusal(reason: AnnouncementRefusal["reason"]): AnnouncementRefusal {
  return { reason, title: "Title", detail: "The root's sentence, naming http://8.8.8.8:8079." };
}

describe("the next step after a refused announcement", () => {
  it("sends a move onto the open internet, a restored backup and a missing key to re-enrollment", () => {
    for (const reason of ["open_internet", "stale_sequence", "no_signing_key"] as const) {
      const view = describeRefusal(refusal(reason));
      expect(view.action).toBe("Re-enroll this machine");
      expect(view.href).toBe(RE_ENROLL_HREF);
    }
  });

  it("does not offer re-enrollment where it would not help", () => {
    for (const reason of ["anothers_address", "not_a_node", "machine_port"] as const) {
      const view = describeRefusal(refusal(reason));
      expect(view.action).toBeNull();
      expect(view.href).toBe("/nodes");
    }
  });

  it("never offers to accept the address", () => {
    for (const reason of [
      "open_internet",
      "anothers_address",
      "not_a_node",
      "machine_port",
      "stale_sequence",
      "no_signing_key",
    ] as const) {
      expect(refusalText(refusal(reason))).not.toMatch(/accept this address/i);
    }
  });

  it("keeps the root's own sentence first", () => {
    expect(refusalText(refusal("not_a_node")).startsWith("The root's sentence")).toBe(true);
    // The root's sentence for a machine port already names its cause.
    expect(refusalText(refusal("machine_port"))).toBe(
      "The root's sentence, naming http://8.8.8.8:8079.",
    );
  });
});

describe("announcements the machine did not sign", () => {
  it("says how many and when, and nothing they carried", () => {
    const line = unverifiedLine({ count: 3, lastAt: "2026-10-26T14:05:00Z" });
    expect(line).toMatch(/^3 announcements not signed by this machine were refused, the last at /);
    expect(unverifiedLine({ count: 1, lastAt: "2026-10-26T14:05:00Z" })).toMatch(
      /^1 announcement not signed by this machine was refused, at /,
    );
  });
});
