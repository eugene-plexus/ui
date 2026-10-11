/**
 * The `catalogue_sources` editor (LS4): where Discover finds models.
 *
 * **The defect worth testing is the token.** `GET /v1/config` never returns
 * one, so every hub arrives with an empty token box in front of a token the
 * Library holds. Writing that blank back would clear it; the Library keeps a
 * token for an entry sent without one, and these tests hold this side to
 * sending none unless the person typed one or chose to forget it.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { newSourceId } from "./CatalogueSources";
import { ConfigFieldInput } from "./ConfigField";
import type { ConfigField } from "@/lib/types";

const FIELD: ConfigField = {
  key: "catalogueSources",
  label: "Where to find models",
  category: "catalogue",
  valueType: "catalogue_sources",
  sensitive: false,
  required: false,
  requiresRestart: false,
  pendingRestart: false,
  default: [],
};

/** As `GET /v1/config` answers: the hub's token redacted, `hasToken` saying so. */
const SAVED = [
  {
    id: "huggingface",
    kind: "hf_hub",
    label: "Hugging Face",
    enabled: true,
    address: "https://huggingface.co",
    token: null,
    hasToken: true,
  },
  { id: "engines", kind: "engine_list", label: "Engines' own lists", enabled: true },
];

function renderField(value: unknown = SAVED) {
  const onChange = vi.fn();
  render(<ConfigFieldInput field={FIELD} value={value} pending={false} onChange={onChange} />);
  return onChange;
}

function lastSent(onChange: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
  return onChange.mock.calls.at(-1)![0] as Record<string, unknown>[];
}

describe("catalogue sources", () => {
  it("says a saved token is saved, and a rename sends no token so it is kept", () => {
    const onChange = renderField();
    const [token] = screen.getAllByLabelText("Access token");
    expect(token).toHaveValue("");
    expect(token).toHaveAttribute("placeholder", "token saved - leave blank to keep it");
    fireEvent.change(screen.getAllByLabelText("Name")[0]!, { target: { value: "HF" } });
    const hub = lastSent(onChange)[0]!;
    expect(hub).toEqual({
      id: "huggingface",
      kind: "hf_hub",
      enabled: true,
      label: "HF",
      address: "https://huggingface.co",
    });
    expect("token" in hub).toBe(false);
  });

  it("forgetting a token sends an empty one, and typing one sends it", () => {
    const onChange = renderField();
    fireEvent.click(screen.getByTestId("source-forget-huggingface"));
    expect(lastSent(onChange)[0]!.token).toBe("");
    expect(screen.getAllByLabelText("Access token")[0]).toHaveAttribute(
      "placeholder",
      "no token: public models only",
    );
    fireEvent.change(screen.getAllByLabelText("Access token")[0]!, {
      target: { value: "hf_new" },
    });
    expect(lastSent(onChange)[0]!.token).toBe("hf_new");
  });

  it("switching a source off, and naming whose list, are sent as such", () => {
    const onChange = renderField();
    fireEvent.click(screen.getByLabelText("Search Engines' own lists"));
    expect(lastSent(onChange)[1]).toEqual({
      id: "engines",
      kind: "engine_list",
      enabled: false,
      label: "Engines' own lists",
    });
    fireEvent.change(screen.getByLabelText("Whose list"), { target: { value: "strata" } });
    expect(lastSent(onChange)[1]!.engine).toBe("strata");
    expect(screen.getByRole("option", { name: "Strata’s list" })).toBeInTheDocument();
  });

  it("adds a hub at the public address with an id of its own, and an engine's list", () => {
    const onChange = renderField();
    fireEvent.click(screen.getByRole("button", { name: "add a hub" }));
    expect(lastSent(onChange)[2]).toEqual({
      id: "another-hub",
      kind: "hf_hub",
      enabled: true,
      label: "Another hub",
      address: "https://huggingface.co",
    });
    fireEvent.click(screen.getByRole("button", { name: "add an engine’s list" }));
    expect(lastSent(onChange)[3]).toMatchObject({ id: "an-engine-s-list", kind: "engine_list" });
    expect(screen.getByTestId("source-another-hub")).toBeInTheDocument();
  });

  it("moves a source up or down: Discover answers in the list's order (LS7)", () => {
    const onChange = renderField();
    expect(screen.getByRole("button", { name: "Move Hugging Face up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Engines' own lists down" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move Engines' own lists up" }));
    expect(lastSent(onChange).map((s) => s.id)).toEqual(["engines", "huggingface"]);
    // The hub's saved token is not sent by moving it.
    expect(lastSent(onChange)[1]).not.toHaveProperty("token");
    fireEvent.click(screen.getByRole("button", { name: "Move Engines' own lists down" }));
    expect(lastSent(onChange).map((s) => s.id)).toEqual(["huggingface", "engines"]);
  });

  it("removes a source", () => {
    const onChange = renderField();
    fireEvent.click(screen.getAllByRole("button", { name: "remove" })[1]!);
    expect(lastSent(onChange).map((s) => s.id)).toEqual(["huggingface"]);
  });

  it("a new id is the label's, unique, and the shape the Library takes", () => {
    expect(newSourceId("Corp Hub!", [])).toBe("corp-hub");
    expect(newSourceId("Corp Hub", ["corp-hub", "corp-hub-2"])).toBe("corp-hub-3");
    expect(newSourceId("???", [])).toBe("source");
  });
});
