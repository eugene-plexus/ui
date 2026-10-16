import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { ConfigFieldInput } from "./ConfigField";
import type { ConfigField } from "@/lib/types";

const temperature: ConfigField = {
  key: "defaultTemperature",
  label: "Default temperature",
  category: "generation",
  valueType: "number",
  default: 0.7,
  minimum: 0,
  maximum: 2,
  required: false,
  sensitive: false,
  requiresRestart: false,
  pendingRestart: false,
};
function Input({
  initial,
  field = temperature,
  changed,
}: {
  initial: unknown;
  field?: ConfigField;
  changed: (v: unknown) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ConfigFieldInput
      field={field}
      value={value}
      savedValue={initial}
      pending={false}
      onChange={(v) => {
        setValue(v);
        changed(v);
      }}
    />
  );
}
it("keeps the slider and precise number in sync without rounding an existing value", () => {
  const changed = vi.fn();
  render(<Input initial={0.735} changed={changed} />);
  expect(screen.getByRole("slider")).toHaveValue("0.735");
  expect(screen.getByRole("spinbutton")).toHaveValue(0.735);
  expect(changed).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("slider"), { target: { value: "1.25" } });
  expect(screen.getByRole("spinbutton")).toHaveValue(1.25);
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "0.333" } });
  expect(screen.getByRole("slider")).toHaveValue("0.333");
});
it("labels an inherited default without saving it, and preserves the explicit reset", () => {
  const changed = vi.fn();
  render(<Input initial={null} changed={changed} />);
  expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "0.7 (default)");
  expect(screen.getByRole("spinbutton")).toHaveValue(null);
  expect(changed).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("slider"), { target: { value: "1.2" } });
  fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
  expect(changed).toHaveBeenLastCalledWith(null);
});
it.each([5, "invalid"])("does not clamp or disguise an unsupported saved value: %s", (initial) => {
  const changed = vi.fn();
  render(<Input initial={initial} changed={changed} />);
  expect(screen.queryByRole("slider")).toBeNull();
  expect(screen.getByTestId("value-warning-defaultTemperature")).toBeVisible();
  expect(changed).not.toHaveBeenCalled();
});
it("keeps exact resource limits as number fields", () => {
  render(
    <Input
      initial={200}
      field={{ ...temperature, key: "documentsMaxPassagesPerPerson", maximum: 1000000 }}
      changed={vi.fn()}
    />,
  );
  expect(screen.queryByRole("slider")).toBeNull();
  expect(screen.getByRole("spinbutton")).toHaveValue(200);
});
