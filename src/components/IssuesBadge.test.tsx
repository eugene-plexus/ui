/**
 * The Issues badge, driven.
 *
 * The list is `issues.ts` and is tested as data; the reads are
 * `useIssues.ts` and are tested against a mocked wire. What is left here
 * is the disclosure and the one thing S7 is measured by: **a sealed root
 * shows as one issue with the unlock as its action, from any page** — so
 * the unlock is exercised through the form, against a mocked
 * `controlUnlock`, including the two ways it fails.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Issue } from "@/lib/issues";

import { IssuesBadgeView } from "./IssuesBadge";

const unlockControlRoot = vi.fn();
vi.mock("@/lib/controlUnlock", () => ({
  unlockControlRoot: (...args: unknown[]) => unlockControlRoot(...args),
}));

const SEALED: Issue = {
  id: "control-sealed",
  kind: "control-sealed",
  severity: "blocking",
  title: "The control root is locked",
  detail:
    "It holds this install's keys sealed and has not been given the passphrase since it last " +
    "started. Nothing is lost, and nothing else will work until it is unlocked.",
  href: "/nodes",
  action: "unlock-control-root",
};

const STALE_BUILD: Issue = {
  id: "stale-build:Amish_Station:llama_cpp",
  kind: "engine-build-stale",
  severity: "warning",
  title: "gemma-3-27b is running on llama.cpp b10948, not the b10990 that is installed",
  detail: "Restarting it picks up the new build.",
  href: "/inference",
  node: "Amish_Station",
};

beforeEach(() => {
  unlockControlRoot.mockReset();
  sessionStorage.clear();
  sessionStorage.setItem("eugene-session-token", "test-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("when there is nothing to say", () => {
  it("renders nothing at all rather than an all-clear", () => {
    const { container } = render(<IssuesBadgeView issues={[]} worst={null} loaded={true} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing before the first read has answered", () => {
    // A cheerful badge shown half a second before the list fills, to
    // somebody whose root is sealed, is worse than silence.
    const { container } = render(
      <IssuesBadgeView issues={[SEALED]} worst="blocking" loaded={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the badge", () => {
  it("counts everything and colours by the worst, without being opened", () => {
    render(<IssuesBadgeView issues={[SEALED, STALE_BUILD]} worst="blocking" loaded={true} />);
    const button = screen.getByTestId("issues-badge");
    expect(button).toHaveAttribute("data-severity", "blocking");
    expect(screen.getByTestId("issues-count")).toHaveTextContent("2");
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("is a warning when nothing is actually down", () => {
    render(<IssuesBadgeView issues={[STALE_BUILD]} worst="warning" loaded={true} />);
    expect(screen.getByTestId("issues-badge")).toHaveAttribute("data-severity", "warning");
  });

  it("opens, and closes the two ways a person closes a disclosure", () => {
    render(<IssuesBadgeView issues={[STALE_BUILD]} worst="warning" loaded={true} />);
    const button = screen.getByTestId("issues-badge");

    fireEvent.click(button);
    expect(screen.getByTestId("issues-popover")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("issues-popover")).toBeNull();
    // Focus returns to the button, or a keyboard user is left nowhere.
    expect(document.activeElement).toBe(button);

    fireEvent.click(button);
    expect(screen.getByTestId("issues-popover")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("issues-popover")).toBeNull();
  });

  it("gives an ordinary issue a link to the screen that owns the fix", () => {
    render(<IssuesBadgeView issues={[STALE_BUILD]} worst="warning" loaded={true} />);
    fireEvent.click(screen.getByTestId("issues-badge"));
    const row = screen.getByTestId("issue-row");
    expect(row).toHaveAttribute("data-issue-kind", "engine-build-stale");
    expect(within(row).getByRole("link")).toHaveAttribute("href", "/inference");
    // And no passphrase box: the unlock is for the one issue that has one.
    expect(screen.queryByTestId("issues-unlock-passphrase")).toBeNull();
  });

  it("prints the whole sentence that says what to do", () => {
    render(<IssuesBadgeView issues={[SEALED]} worst="blocking" loaded={true} />);
    fireEvent.click(screen.getByTestId("issues-badge"));
    expect(screen.getByTestId("issue-row")).toHaveTextContent(
      "nothing else will work until it is unlocked",
    );
  });
});

describe("the sealed root is fixed from inside the list", () => {
  function openTheForm() {
    const result = render(
      <IssuesBadgeView issues={[SEALED]} worst="blocking" loaded={true} onFixed={onFixed} />,
    );
    fireEvent.click(screen.getByTestId("issues-badge"));
    return result;
  }
  let onFixed = vi.fn(async () => {});

  beforeEach(() => {
    onFixed = vi.fn(async () => {});
  });

  it("puts the cursor in the passphrase box when the list is opened", () => {
    // Troy, 2026-09-23: the click that opens the list is a click to act,
    // so it should be the only one before typing. Opened from the
    // keyboard it is the same handler, so Enter on the badge and then
    // the passphrase is the whole unlock.
    openTheForm();
    expect(document.activeElement).toBe(screen.getByTestId("issues-unlock-passphrase"));
  });

  it("still hands focus back to the badge on Escape", () => {
    openTheForm();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(screen.getByTestId("issues-badge"));
  });

  it("takes the passphrase and posts it to the control root", async () => {
    unlockControlRoot.mockResolvedValue("unlocked");
    openTheForm();
    // The slice's Done when: the fix is here, not behind a link to a
    // screen that cannot load while the root is shut.
    expect(screen.queryByRole("link", { name: "Go and fix it" })).toBeNull();

    fireEvent.change(screen.getByTestId("issues-unlock-passphrase"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByTestId("issues-unlock-submit"));

    await waitFor(() => expect(unlockControlRoot).toHaveBeenCalledTimes(1));
    // The patient variant, deliberately: this form has a spinner and a
    // person watching, and the 8 s sign-in default is what produced the
    // live "enter it twice" report when Argon2id outlived it.
    expect(unlockControlRoot).toHaveBeenCalledWith("correct horse battery staple", "test-token", {
      timeoutMs: 30_000,
      confirmAttempts: 4,
    });
    // And the list is pulled forward rather than left stale for half a
    // minute after the thing it reports was fixed.
    await waitFor(() => expect(onFixed).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("issues-unlock-problem")).toBeNull();
  });

  it("will not submit an empty passphrase", () => {
    unlockControlRoot.mockResolvedValue("unlocked");
    openTheForm();
    expect(screen.getByTestId("issues-unlock-submit")).toBeDisabled();
    fireEvent.click(screen.getByTestId("issues-unlock-submit"));
    expect(unlockControlRoot).not.toHaveBeenCalled();
  });

  it("names the confusing case rather than calling it a wrong password", async () => {
    unlockControlRoot.mockResolvedValue("mismatch");
    openTheForm();
    fireEvent.change(screen.getByTestId("issues-unlock-passphrase"), {
      target: { value: "the sign-in one" },
    });
    fireEvent.click(screen.getByTestId("issues-unlock-submit"));

    const problem = await screen.findByTestId("issues-unlock-problem");
    // The session is already good; this is the root holding a different
    // secret, which is a real state and not a typo.
    expect(problem).toHaveTextContent("not always the one you sign in with");
    expect(onFixed).not.toHaveBeenCalled();
  });

  it("says the root did not answer when it did not", async () => {
    unlockControlRoot.mockResolvedValue("unavailable");
    openTheForm();
    fireEvent.change(screen.getByTestId("issues-unlock-passphrase"), {
      target: { value: "anything" },
    });
    fireEvent.click(screen.getByTestId("issues-unlock-submit"));

    expect(await screen.findByTestId("issues-unlock-problem")).toHaveTextContent("did not answer");
    expect(onFixed).not.toHaveBeenCalled();
  });

  it("does not post a passphrase with no session to carry it", async () => {
    sessionStorage.clear();
    openTheForm();
    fireEvent.change(screen.getByTestId("issues-unlock-passphrase"), {
      target: { value: "anything" },
    });
    fireEvent.click(screen.getByTestId("issues-unlock-submit"));

    expect(await screen.findByTestId("issues-unlock-problem")).toBeInTheDocument();
    expect(unlockControlRoot).not.toHaveBeenCalled();
  });
});

/**
 * Principle P5, the same rule Home is held to: the architecture's nouns
 * do not appear in what a person reads. This is the text somebody reads
 * when they are already unhappy, so it is held to it hardest.
 */
describe("the words", () => {
  it("uses none of the banned ones", () => {
    render(<IssuesBadgeView issues={[SEALED, STALE_BUILD]} worst="blocking" loaded={true} />);
    fireEvent.click(screen.getByTestId("issues-badge"));
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const banned of ["epoch", "advertiseurl", "companion driver", "admission", "mint"]) {
      expect(text).not.toContain(banned);
    }
  });
});
