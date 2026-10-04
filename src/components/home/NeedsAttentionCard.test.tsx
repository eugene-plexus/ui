/**
 * Home's "Needs attention" card, driven.
 *
 * The list is `issues.ts`, the reads are `useIssues.ts`, and the row is
 * `IssueRow` — all tested elsewhere. What is left here is the one thing
 * this card decides for itself: **it says "nothing" where the badge says
 * nothing at all**, and it says neither until it has actually looked.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Issue } from "@/lib/issues";

import { NeedsAttentionCard } from "./NeedsAttentionCard";

const unlockControlRoot = vi.fn();
vi.mock("@/lib/controlUnlock", () => ({
  unlockControlRoot: (...args: unknown[]) => unlockControlRoot(...args),
}));

const SEALED: Issue = {
  id: "control-sealed",
  kind: "control-sealed",
  severity: "blocking",
  title: "The control root is locked",
  detail: "Nothing is lost, and nothing else will work until it is unlocked.",
  href: "/nodes",
  action: "unlock-control-root",
};

const ON_CPU: Issue = {
  id: "on-cpu:Amish_Station:gemma",
  kind: "runtime-on-cpu",
  severity: "warning",
  title: "gemma-3-27b is running on the processor, not the graphics card",
  detail: "Raise the GPU layers in its settings and restart it.",
  href: "/inference",
  node: "Amish_Station",
};

beforeEach(() => {
  unlockControlRoot.mockReset();
  sessionStorage.clear();
  sessionStorage.setItem("eugene-session-token", "test-token");
});

describe("before the first read has answered", () => {
  it("says it is still looking, and does not claim everything is fine", () => {
    render(<NeedsAttentionCard issues={[]} loaded={false} />);
    const card = screen.getByTestId("home-needs-attention");
    expect(card).toHaveTextContent("Checking");
    // The failure this whole slice exists to remove is a green report
    // from an install that does not work. Half a second of one is still
    // one.
    expect(card).not.toHaveTextContent("Nothing.");
  });
});

describe("when there is nothing wrong", () => {
  it("says so, because Home is where somebody asks how it is", () => {
    render(<NeedsAttentionCard issues={[]} loaded={true} />);
    const card = screen.getByTestId("home-needs-attention");
    expect(card).toHaveTextContent("Nothing.");
    expect(card).toHaveAttribute("data-issue-count", "0");
  });
});

describe("when something is wrong", () => {
  it("lists every issue with the sentence that says what to do", () => {
    render(<NeedsAttentionCard issues={[SEALED, ON_CPU]} loaded={true} />);
    const card = screen.getByTestId("home-needs-attention");
    expect(card).toHaveAttribute("data-issue-count", "2");
    expect(screen.getAllByTestId("issue-row")).toHaveLength(2);
    expect(card).toHaveTextContent("Raise the GPU layers in its settings and restart it.");
    expect(card).not.toHaveTextContent("Nothing.");
  });

  it("counts only what is actually down in its summary line", () => {
    render(<NeedsAttentionCard issues={[SEALED, ON_CPU]} loaded={true} />);
    expect(screen.getByTestId("home-needs-attention")).toHaveTextContent(
      "1 thing is stopping it working",
    );
  });

  it("says nothing about things being down when nothing is", () => {
    render(<NeedsAttentionCard issues={[ON_CPU]} loaded={true} />);
    expect(screen.getByTestId("home-needs-attention")).not.toHaveTextContent("stopping it working");
  });

  it("carries the sealed root's unlock here too, which is what 'any page' means", async () => {
    unlockControlRoot.mockResolvedValue("unlocked");
    const onFixed = vi.fn();
    render(<NeedsAttentionCard issues={[SEALED]} loaded={true} onFixed={onFixed} />);

    fireEvent.change(screen.getByTestId("issues-unlock-passphrase"), {
      target: { value: "the install passphrase" },
    });
    fireEvent.click(screen.getByTestId("issues-unlock-submit"));

    await waitFor(() => expect(unlockControlRoot).toHaveBeenCalledTimes(1));
    expect(unlockControlRoot).toHaveBeenCalledWith("the install passphrase", "test-token", {
      timeoutMs: 30_000,
      confirmAttempts: 4,
    });
    await waitFor(() => expect(onFixed).toHaveBeenCalledTimes(1));
  });

  it("does not take the cursor on its own", () => {
    // The header's list focuses the passphrase because a person opened
    // it to act. This card is on Home when the page loads, and focusing
    // it would pull the cursor out of the box a person came to type in.
    render(<NeedsAttentionCard issues={[SEALED]} loaded={true} />);
    expect(screen.getByTestId("issues-unlock-passphrase")).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
  });

  it("sends an ordinary issue to the screen that owns its fix", () => {
    render(<NeedsAttentionCard issues={[ON_CPU]} loaded={true} />);
    expect(screen.getByRole("link", { name: "Go and fix it" })).toHaveAttribute(
      "href",
      "/inference",
    );
    expect(screen.queryByTestId("issues-unlock-passphrase")).toBeNull();
  });
});
