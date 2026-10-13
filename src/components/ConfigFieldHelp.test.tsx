/**
 * A setting's help, as a person reads it on the Settings page (Troy,
 * 2026-10-13): the control root's `securityMode` description was 254 words
 * with Markdown in it, and it was drawn as one block of raw asterisks. The
 * control root now writes it for this page (control a44c772): one sentence,
 * the three modes as a list, and a closing paragraph, 107 words.
 *
 * The body is the one the control root really serves, captured in
 * `settings-wire.json`, so this fails if the component and this page stop
 * agreeing about what a description is.
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfigFieldInput } from "./ConfigField";
import wire from "@/lib/__fixtures__/settings-wire.json";
import type { ConfigField } from "@/lib/types";

type Case = { field: ConfigField; value: unknown };
const cases = wire as unknown as Record<string, Record<string, Case>>;

function show(component: string, name: string, patch: Partial<ConfigField> = {}) {
  const found = cases[component]![name]!;
  render(
    <ConfigFieldInput
      field={{ ...found.field, ...patch }}
      value={found.value}
      savedValue={found.value}
      pending={false}
      onChange={vi.fn()}
    />,
  );
  return found.field;
}

describe("a long description", () => {
  it("is one sentence on the page, with the rest behind More", () => {
    show("control", "securityMode");
    const help = screen.getByTestId("description-securityMode");
    expect(help).toHaveTextContent(
      "How this control root keeps its master encryption key between restarts.",
    );
    // Nothing of the list or the paragraph after it is in view.
    expect(within(help).getByText("OS keyring")).not.toBeVisible();
    expect(screen.getByText(/Either auto-unlock mode lets anyone who can read/)).not.toBeVisible();
    expect(screen.getByText("More")).toBeVisible();
  });

  it("is Markdown when it is opened: a list of the three modes, bold and code, no marks", async () => {
    show("control", "securityMode");
    await userEvent.click(screen.getByText("More"));
    const help = screen.getByTestId("description-securityMode");
    // The three modes are a list, each led by its name in bold.
    expect(help.querySelectorAll("details ul")).toHaveLength(1);
    const modes = [...help.querySelectorAll("details li")];
    expect(modes.map((li) => li.querySelector("strong")?.textContent)).toEqual([
      "Prompt on startup",
      "OS keyring",
      "Passphrase file",
    ]);
    expect(within(help).getByText("OS keyring").tagName).toBe("STRONG");
    expect(within(help).getByText("OS keyring")).toBeVisible();
    expect(screen.getByText("EUGENE_PLEXUS_CONTROL_PASSPHRASE_FILE").tagName).toBe("CODE");
    // The closing paragraph is the only paragraph: a list item is not one.
    expect(help.querySelectorAll("details p")).toHaveLength(1);
    expect(help.querySelector("details p")).toHaveTextContent(
      "Either auto-unlock mode lets anyone who can read the keyring or the file unlock this install without the passphrase.",
    );
    expect(help.textContent).not.toContain("**");
    expect(help.textContent).not.toContain("`");
    expect(help.textContent).not.toContain("- ");
  });

  it("describes the input by its first sentence, not by all of it", () => {
    show("control", "securityMode");
    expect(screen.getByRole("combobox")).toHaveAccessibleDescription(
      "How this control root keeps its master encryption key between restarts.",
    );
  });

  it("a short description has no More at all", () => {
    show("gateway", "corsAllowedOrigins", {
      description: "Which origins may call the gateway from a browser.",
    });
    expect(screen.getByTestId("description-corsAllowedOrigins")).toHaveTextContent(
      "Which origins may call the gateway from a browser.",
    );
    expect(screen.queryByText("More")).toBeNull();
  });

  it("a field with no description draws nothing and points at nothing", () => {
    show("gateway", "controlUrl", { description: undefined });
    expect(screen.queryByTestId("description-controlUrl")).toBeNull();
    expect(screen.getByRole("textbox")).not.toHaveAttribute("aria-describedby");
  });
});
