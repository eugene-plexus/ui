/**
 * An enum dropdown shows an unset value as unset.
 *
 * Found on Troy's worker, 2026-09-29: `updateChannel` had never been saved,
 * so the agent followed how the machine was installed (a release, alpha.5)
 * and said "up to date on releases" -- while Settings showed **Edge**,
 * because `value=""` matched no option and a browser shows the first one.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfigFieldInput } from "./ConfigField";
import type { ConfigField } from "@/lib/types";

const CHANNEL: ConfigField = {
  key: "updateChannel",
  label: "Update channel",
  category: "updates",
  valueType: "enum",
  enumValues: ["edge", "releases"],
  enumLabels: ["Edge", "Releases"],
  sensitive: false,
  required: false,
  requiresRestart: false,
};

function renderField(field: ConfigField, value: unknown, onChange = vi.fn()) {
  render(<ConfigFieldInput field={field} value={value} pending={false} onChange={onChange} />);
  return onChange;
}

describe("an optional enum with no default", () => {
  it("shows an unset value as Not set, not as its first option", () => {
    renderField(CHANNEL, null);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.selectedOptions[0]?.textContent).toBe("Not set");
  });

  it("can be set, and cleared again", () => {
    const onChange = renderField(CHANNEL, "edge");
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.selectedOptions[0]?.textContent).toBe("Edge");
    fireEvent.change(select, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    fireEvent.change(select, { target: { value: "releases" } });
    expect(onChange).toHaveBeenLastCalledWith("releases");
  });
});

describe("an enum that always has a value", () => {
  it("offers no Not set: a default or a required field is never unset", () => {
    renderField({ ...CHANNEL, key: "logLevel", default: "edge" }, "edge");
    expect(screen.queryByRole("option", { name: "Not set" })).toBeNull();
    renderField({ ...CHANNEL, key: "mode", required: true }, "edge");
    expect(screen.queryByRole("option", { name: "Not set" })).toBeNull();
  });
});
