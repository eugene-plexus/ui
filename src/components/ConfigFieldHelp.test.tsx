/**
 * A setting's help, as a person reads it on the Settings page (Troy,
 * 2026-10-13): the control root's `securityMode` description is 254 words
 * with Markdown in it, and it was drawn as one block of raw asterisks.
 *
 * The body is the one the control root really serves, captured in
 * `settings-wire.json`, so this fails if the component and this page stop
 * agreeing about what a description is.
 */

import { render, screen } from "@testing-library/react";
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
      "How this host keeps its master encryption key between restarts.",
    );
    // Nothing of the other four paragraphs is in view.
    expect(screen.getByText("OS keyring is host-bound.")).not.toBeVisible();
    expect(screen.getByText(/Both auto-unlock modes trade the same thing away/)).not.toBeVisible();
    expect(screen.getByText("More")).toBeVisible();
  });

  it("is Markdown when it is opened: bold and paragraphs, no asterisks", async () => {
    show("control", "securityMode");
    await userEvent.click(screen.getByText("More"));
    expect(screen.getByText("OS keyring is host-bound.").tagName).toBe("STRONG");
    expect(screen.getByText("OS keyring is host-bound.")).toBeVisible();
    expect(screen.getByText("this").tagName).toBe("EM");
    expect(screen.getByText("EUGENE_PLEXUS_CONTROL_PASSPHRASE_FILE").tagName).toBe("CODE");
    // Six paragraphs in the description. The first gives its first sentence
    // to the page and the rest of itself to More, so More holds six.
    const help = screen.getByTestId("description-securityMode");
    expect(help.querySelectorAll("details p")).toHaveLength(6);
    expect(help.textContent).not.toContain("**");
    expect(help.textContent).not.toContain("`");
  });

  it("describes the input by its first sentence, not by all of it", () => {
    show("control", "securityMode");
    expect(screen.getByRole("combobox")).toHaveAccessibleDescription(
      "How this host keeps its master encryption key between restarts.",
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
