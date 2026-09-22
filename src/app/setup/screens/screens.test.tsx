/**
 * One screen at a time — which is the point of the M9 split.
 *
 * Before it, `page.tsx` was 1548 lines and **nothing in it could be
 * mounted without mounting the whole wizard**: every screen needed the
 * router, the persisted draft, the topology fetch and the Start
 * transaction to exist first. That is why the wizard's only test is 258
 * lines asserting a call sequence, and why the four bugs Troy found by
 * hand on 2026-09-10 were found by hand.
 *
 * These are deliberately small. The flow-level test still lives in
 * `../page.test.tsx` and still owns the two transactions; what is here is
 * that a screen's own behaviour can be checked without them, and that the
 * rules the footer button asks about are pure functions of the draft.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  MIN_PASSPHRASE_LENGTH,
  blankDraft,
  canContinue,
  chosenFolders,
  passphraseLength,
  restoreDraft,
} from "../draft";
import { ScreenFolders } from "./Folders";
import { ScreenPassphrase } from "./Passphrase";

describe("the passphrase screen", () => {
  it("reports both halves of the passphrase upward and stores neither", async () => {
    const onPassphrase = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ScreenPassphrase
        passphrase=""
        passphraseConfirm=""
        securityMode="prompt_on_startup"
        keyringAvailable={true}
        onPassphrase={onPassphrase}
        onPassphraseConfirm={onConfirm}
        onSecurityMode={vi.fn()}
      />,
    );
    const empty = screen.getAllByDisplayValue("");
    await userEvent.type(empty[0]!, "a");
    await userEvent.type(empty[1]!, "b");
    expect(onPassphrase).toHaveBeenCalledWith("a");
    expect(onConfirm).toHaveBeenCalledWith("b");
    // The passphrase never reaches storage — the wizard keeps it in
    // component state and drops it from the saved draft.
    expect(sessionStorage.getItem("eugene-wizard-draft")).toBeNull();
  });

  it("carries the Welcome screen's job in one sentence", () => {
    render(
      <ScreenPassphrase
        passphrase=""
        passphraseConfirm=""
        securityMode="prompt_on_startup"
        keyringAvailable={null}
        onPassphrase={vi.fn()}
        onPassphraseConfirm={vi.fn()}
        onSecurityMode={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Choose a passphrase" })).toBeInTheDocument();
    expect(screen.getByText(/Eugene cannot reset it/)).toBeInTheDocument();
  });

  it("says a passphrase is too short while it is being typed, not after Continue", () => {
    const props = {
      passphraseConfirm: "",
      securityMode: "prompt_on_startup" as const,
      keyringAvailable: true,
      onPassphrase: vi.fn(),
      onPassphraseConfirm: vi.fn(),
      onSecurityMode: vi.fn(),
    };
    const { rerender } = render(<ScreenPassphrase {...props} passphrase="" />);
    // The rule is stated up front, and nothing is flagged before typing.
    expect(screen.getByText(/at least 12 characters/i)).toBeInTheDocument();
    expect(screen.queryByTestId("passphrase-too-short")).toBeNull();

    rerender(<ScreenPassphrase {...props} passphrase="hunter2" />);
    expect(screen.getByTestId("passphrase-too-short")).toHaveTextContent(
      "Use at least 12 characters. This one has 7.",
    );

    rerender(<ScreenPassphrase {...props} passphrase="correct horse battery" />);
    expect(screen.queryByTestId("passphrase-too-short")).toBeNull();
  });

  it("names each box by its label, so a screen reader says which is which", () => {
    // The labels were bare <label>s tied to nothing: two password boxes
    // with no names, told apart only by position.
    render(
      <ScreenPassphrase
        passphrase=""
        passphraseConfirm=""
        securityMode="prompt_on_startup"
        keyringAvailable={true}
        onPassphrase={vi.fn()}
        onPassphraseConfirm={vi.fn()}
        onSecurityMode={vi.fn()}
      />,
    );
    const first = screen.getByLabelText("Passphrase");
    const second = screen.getByLabelText("Confirm passphrase");
    expect(first).toHaveAttribute("type", "password");
    expect(second).toHaveAttribute("type", "password");
    expect(first).not.toBe(second);
    // And the line under each label is read as its description.
    expect(second).toHaveAccessibleDescription("Same again, to guard against typos.");
  });
});

describe("the folders screen", () => {
  const ready = { status: "ready", path: "/home/sam/Eugene Models", home: "/home/sam" } as const;

  it("shows the proposal checked, with the path and a way to change it", async () => {
    const onChange = vi.fn();
    render(<ScreenFolders draft={blankDraft()} proposal={ready} onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "Make a folder for me" })).toBeChecked();
    expect(screen.getByTestId("proposed-folder")).toHaveTextContent("/home/sam/Eugene Models");
    // Nothing to type into until asked: the proposal is a decision made
    // for the person, and the box appears only when they want to unmake it.
    expect(screen.queryByRole("textbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "change" }));
    expect(onChange).toHaveBeenCalledWith({
      folderChoice: "make",
      customFolder: "/home/sam/Eugene Models",
    });
  });

  it("keeps a row per folder under 'I already have models', each with Browse", () => {
    const draft = { ...blankDraft(), folderChoice: "own" as const, modelRoots: ["D:/models"] };
    render(<ScreenFolders draft={draft} proposal={ready} onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "I already have models" })).toBeChecked();
    expect(screen.getByDisplayValue("D:/models")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Browse for model folder 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add another folder" })).toBeInTheDocument();
  });

  it("disables the proposal when the library could not be asked, and selects the other", () => {
    render(
      <ScreenFolders
        draft={blankDraft()}
        proposal={{ status: "unavailable" }}
        onChange={vi.fn()}
      />,
    );
    const make = screen.getByRole("radio", { name: "Make a folder for me" });
    expect(make).toBeDisabled();
    expect(make).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "I already have models" })).toBeChecked();
    // A regex, because testing-library's default matcher collapses the
    // placeholder's double spaces before comparing.
    expect(screen.getByPlaceholderText(/^D:\\models/)).toBeInTheDocument();
  });
});

describe("the draft's rules", () => {
  it("gates screen 1 on a matching passphrase of at least the minimum length", () => {
    const draft = blankDraft();
    const twelve = "correct hors"; // exactly MIN_PASSPHRASE_LENGTH
    expect(twelve).toHaveLength(MIN_PASSPHRASE_LENGTH);
    expect(canContinue(1, draft, twelve, "correct horz")).toBe(false);
    expect(canContinue(1, draft, "", "")).toBe(false);
    expect(canContinue(1, draft, twelve, twelve)).toBe(true);
    // One short of it is refused here, before initialize does the same.
    expect(canContinue(1, draft, "hunter2", "hunter2")).toBe(false);
    expect(canContinue(1, draft, twelve.slice(1), twelve.slice(1))).toBe(false);
  });

  it("counts characters as a person sees them, not UTF-16 halves", () => {
    // Six emoji are twelve UTF-16 units and six characters to the agent,
    // which counts code points; counting `.length` here would let the
    // wizard's Continue through and initialize refuse it.
    const six = "🔑".repeat(6);
    expect(six.length).toBe(12);
    expect(canContinue(1, blankDraft(), six, six)).toBe(false);
    expect(passphraseLength("🔑".repeat(12))).toBe(12);
  });

  it("gates screen 2 on one folder, from whichever radio is chosen", () => {
    const draft = blankDraft();
    // The proposal not yet known: nothing to write, so nothing to finish.
    expect(canContinue(2, draft, "", "", null)).toBe(false);
    expect(chosenFolders(draft, null)).toEqual([]);
    // Known: the proposal is the folder.
    expect(chosenFolders(draft, "/home/sam/Eugene Models")).toEqual(["/home/sam/Eugene Models"]);
    expect(canContinue(2, draft, "", "", "/home/sam/Eugene Models")).toBe(true);
    // Edited: the edit wins over the proposal, trimmed.
    expect(chosenFolders({ ...draft, customFolder: " D:\\LLM " }, "/x")).toEqual(["D:\\LLM"]);
    // Edited to nothing: back to nothing.
    expect(canContinue(2, { ...draft, customFolder: "   " }, "", "", "/x")).toBe(false);
  });

  it("takes the person's own folders, blank rows dropped, when they have models", () => {
    const own = { ...blankDraft(), folderChoice: "own" as const };
    expect(chosenFolders({ ...own, modelRoots: [] }, "/proposal")).toEqual([]);
    expect(chosenFolders({ ...own, modelRoots: ["", "  "] }, "/proposal")).toEqual([]);
    expect(chosenFolders({ ...own, modelRoots: [" D:/a ", "", "/b"] }, "/proposal")).toEqual([
      "D:/a",
      "/b",
    ]);
    // The proposal plays no part once the other radio is chosen.
    expect(chosenFolders({ ...own, modelRoots: ["/b"] }, "/proposal")).not.toContain("/proposal");
  });

  it("restores a saved draft by its known keys and ignores an older shape", () => {
    // A draft from the five-screen wizard carries `backend` and `screen`.
    // Neither is a field now, and the screen is decided by the install.
    expect(
      restoreDraft({
        modelRoots: ["D:/models"],
        backend: { provider: "ollama_local" },
        securityMode: "os_keyring",
        screen: 3,
      }),
    ).toEqual({
      securityMode: "os_keyring",
      folderChoice: "make",
      customFolder: null,
      modelRoots: ["D:/models"],
    });
    expect(restoreDraft({ drivers: [] })).toBeNull();
    expect(restoreDraft("nope")).toBeNull();
    expect(restoreDraft({ modelRoots: [1, "x"], folderChoice: "own", customFolder: 3 })).toEqual({
      securityMode: "prompt_on_startup",
      folderChoice: "own",
      customFolder: null,
      modelRoots: ["x"],
    });
  });
});
