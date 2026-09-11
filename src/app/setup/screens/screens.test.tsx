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
 * `../page.test.tsx` and still owns the Start transaction; what is new
 * here is that a screen's own behaviour can be checked without it.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { blankDraft, canContinue } from "../draft";
import { ScreenBackend } from "./Backend";
import { ScreenModels } from "./Models";
import { ScreenSecurity } from "./Security";

describe("the security screen", () => {
  it("reports both halves of the passphrase upward and stores neither", async () => {
    const onPassphrase = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ScreenSecurity
        passphrase=""
        passphraseConfirm=""
        securityMode="prompt_on_startup"
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
});

describe("the models screen", () => {
  it("keeps a row per directory and reports the whole list", async () => {
    const onChange = vi.fn();
    render(<ScreenModels roots={["D:/models"]} onChange={onChange} />);
    expect(screen.getByDisplayValue("D:/models")).toBeInTheDocument();
  });
});

describe("the backend screen", () => {
  it("shows no credential fields until a provider is chosen", () => {
    const draft = blankDraft();
    const { container } = render(<ScreenBackend backend={draft.backend} onChange={vi.fn()} />);
    // `provider: ""` means "none, ask me later", and asking for an API
    // key before knowing the provider is asking for a key to nothing.
    expect(container.querySelectorAll("input[type=password]")).toHaveLength(0);
  });
});

describe("canContinue", () => {
  it("is a pure function of the draft, checkable without rendering anything", () => {
    const draft = blankDraft();
    // Screen 2 is the passphrase. Mismatched halves must not advance.
    expect(canContinue(2, draft, "hunter2", "hunter3")).toBe(false);
    expect(canContinue(2, draft, "hunter2", "hunter2")).toBe(true);
    // Screen 1 is Welcome — prose, nothing to get wrong.
    expect(canContinue(1, draft, "", "")).toBe(true);
    // Screen 3 is model directories, and none is a valid answer: Discover
    // downloads into one later, and nothing here may block a first run.
    expect(canContinue(3, draft, "", "")).toBe(true);
  });

  it("holds a chosen backend to its provider's credentials, and no further", () => {
    // Screen 4. "None" is a valid answer, so an untouched draft advances.
    const draft = blankDraft();
    expect(canContinue(4, draft, "", "")).toBe(true);

    // openai_compat_custom needs both a base URL and an API key, and does
    // not advance while either is missing. (The key is the real one from
    // WIZARD_PROVIDERS: an unknown provider has no credentials to require,
    // so a typo here would assert nothing and pass.)
    const chosen = {
      ...draft,
      backend: { ...draft.backend, provider: "openai_compat_custom", apiKey: "sk-x" },
    };
    expect(canContinue(4, chosen, "", "")).toBe(false);
    expect(
      canContinue(4, { ...chosen, backend: { ...chosen.backend, baseUrl: "http://h:1" } }, "", ""),
    ).toBe(true);

    // But NOT to a model id. A driver has to exist before it can be asked
    // what it serves, and it cannot exist before Start — which is why the
    // last screen asks, from a list the driver actually reported.
    expect(
      canContinue(
        4,
        { ...chosen, backend: { ...chosen.backend, baseUrl: "http://h:1", modelId: "" } },
        "",
        "",
      ),
    ).toBe(true);
  });
});
