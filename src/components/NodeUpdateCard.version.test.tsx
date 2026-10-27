/**
 * Each machine's card on Machines says the version it runs (row 75), and
 * the commits are behind Details, never in the line.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { NodeIdentity } from "@/lib/types";

import { NodeUpdateCard } from "./NodeUpdateCard";

const COMMIT = "85e9e7612345678901234567890123456789abcd";

function identity(version: NodeIdentity["version"]): NodeIdentity {
  return {
    enrolled: true,
    name: "NAS",
    os: "linux",
    install: {
      mechanism: "container",
      development: false,
      components: [{ name: "agent", state: "stamped", commit: COMMIT }],
    },
    update: {
      enabled: true,
      channel: "releases",
      channelSource: "default",
      checkedAt: "2026-10-26T10:00:00Z",
      available: false,
      behind: [],
      ahead: [],
      apply: { possible: false },
    },
    ...(version ? { version } : {}),
  };
}

function card(id: NodeIdentity | null) {
  render(
    <NodeUpdateCard
      name="NAS"
      target="node:NAS"
      identity={id}
      loaded
      now={Date.parse("2026-10-26T12:00:00Z")}
      onChanged={() => {}}
    />,
  );
}

describe("a machine's card says its version", () => {
  it("says the release", () => {
    card(identity({ kind: "release", release: "v0.4.0" }));
    expect(screen.getByTestId("node-version")).toHaveTextContent("v0.4.0");
  });

  it("says Edge and the day it was built", () => {
    card(identity({ kind: "edge", publishedAt: "2026-10-24T09:30:00Z" }));
    expect(screen.getByTestId("node-version")).toHaveTextContent("Edge, built 2026-10-24");
  });

  it("says an install that matches no release is not one, and keeps the commits on demand", () => {
    card(identity({ kind: "unmatched" }));
    expect(screen.getByTestId("node-version")).toHaveTextContent("not a published release");
    // The commits are in Details, not in the version line or the headline.
    expect(screen.getByTestId("node-version")).not.toHaveTextContent("85e9e76");
    const details = screen.getByTestId("node-update-details");
    expect(details).toHaveTextContent("agent 85e9e76");
    expect(details.tagName).toBe("DETAILS");
    expect(details).not.toHaveAttribute("open");
  });

  it("names the cause when the version could not be looked up", () => {
    card(identity({ kind: "unknown", error: "GitHub rate limit: try again in 12 minutes" }));
    expect(screen.getByTestId("node-version")).toHaveTextContent("version not known yet");
    expect(screen.getByTestId("node-update-details")).toHaveTextContent(
      "GitHub rate limit: try again in 12 minutes",
    );
  });

  it("does not fail for an agent from before the field", () => {
    card(identity(undefined));
    expect(screen.queryByTestId("node-version")).toBeNull();
    expect(screen.getByTestId("node-update")).toBeInTheDocument();
  });
});
