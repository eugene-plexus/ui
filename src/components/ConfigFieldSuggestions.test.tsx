import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ConfigFieldInput } from "./ConfigField";
import type { ConfigField } from "@/lib/types";

const EMBEDDING: ConfigField = {
  key: "documentsEmbeddingModel",
  label: "Search model for My documents",
  category: "documents",
  valueType: "string",
  default: "auto",
  suggestions: ["auto", "qwen-embedding", "another-embedding"],
  status: { level: "info", text: "In use: qwen-embedding (automatic)." },
  sensitive: false,
  required: false,
  requiresRestart: false,
  pendingRestart: false,
};
const SORTER: ConfigField = {
  ...EMBEDDING,
  key: "documentsSortModel",
  label: "Result sorter for My documents",
  suggestions: ["auto", "off", "qwen-reranker"],
  status: { level: "info", text: "In use: qwen-reranker (automatic)." },
};

function Editor({
  field,
  initial = "auto",
  onChange,
}: {
  field: ConfigField;
  initial?: unknown;
  onChange: (value: unknown) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ConfigFieldInput
      field={field}
      value={value}
      savedValue={initial}
      pending={false}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe("discovered model dropdowns", () => {
  it.each([EMBEDDING, SORTER])(
    "$key shows all choices while auto is selected and saves the model ID",
    async (field) => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<Editor field={field} onChange={onChange} />);
      const select = screen.getByRole("combobox", { name: field.label });
      // A datalist filters by 'auto' and cannot provide this native select.
      expect(select.tagName).toBe("SELECT");
      expect(select).toHaveDisplayValue("Automatic (auto)");
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      for (const model of field.suggestions!.filter((value) => !["auto", "off"].includes(value))) {
        await user.selectOptions(select, screen.getByRole("option", { name: model }));
        expect(select).toHaveDisplayValue(model);
        expect(onChange).toHaveBeenLastCalledWith(model);
      }
      if (field.key === "documentsSortModel") {
        await user.selectOptions(select, screen.getByRole("option", { name: "Off" }));
        expect(onChange).toHaveBeenLastCalledWith("off");
      }
      await user.selectOptions(select, screen.getByRole("option", { name: "Automatic (auto)" }));
      expect(onChange).toHaveBeenLastCalledWith("auto");
      expect(screen.getByTestId(`status-${field.key}`)).toHaveTextContent(field.status!.text);
    },
  );

  it("opens manual entry without changing the value, keeps typing stable, and returns to the list", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Editor field={EMBEDDING} onChange={onChange} />);
    const select = screen.getByRole("combobox");
    await user.selectOptions(select, screen.getByRole("option", { name: "Enter manually…" }));
    const input = screen.getByRole("textbox", { name: `${EMBEDDING.label}: manual value` });
    expect(input).toHaveValue("auto");
    expect(input).toHaveFocus();
    expect(input).not.toHaveAttribute("list");
    expect(onChange).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, "auto-custom");
    expect(input).toHaveValue("auto-custom");
    expect(onChange).toHaveBeenLastCalledWith("auto-custom");
    await user.selectOptions(select, screen.getByRole("option", { name: "qwen-embedding" }));
    expect(onChange).toHaveBeenLastCalledWith("qwen-embedding");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("preserves a saved model when discovery no longer lists it", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ConfigFieldInput field={SORTER} value="qwen-reranker" pending={false} onChange={onChange} />,
    );
    rerender(
      <ConfigFieldInput
        field={{ ...SORTER, suggestions: ["auto", "off"] }}
        value="qwen-reranker"
        pending={false}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("qwen-reranker");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("can type a full custom value starting from an unset setting", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Editor field={SORTER} initial={null} onChange={onChange} />);
    await user.selectOptions(
      screen.getByRole("combobox"),
      screen.getByRole("option", { name: "Enter manually…" }),
    );
    const input = screen.getByRole("textbox");
    await user.type(input, "custom-sorter");
    expect(input).toHaveValue("custom-sorter");
    expect(input).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith("custom-sorter");
  });

  it("does not select a model for an unset value, and retains reset-to-default semantics", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Editor field={SORTER} initial="custom-sorter" onChange={onChange} />);
    expect(screen.getByRole("textbox")).toHaveValue("custom-sorter");
    await user.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("combobox")).toHaveDisplayValue("Not set");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByTestId(`default-${SORTER.key}`)).toHaveTextContent(
      "Goes back to the default when you save.",
    );
    await user.selectOptions(
      screen.getByRole("combobox"),
      screen.getByRole("option", { name: "Automatic (auto)" }),
    );
    expect(onChange).toHaveBeenLastCalledWith("auto");
  });

  it.each([{ pending: true }, { pending: false, managedBy: "Managed by Eugene" }])(
    "locks both controls when pending or managed: %o",
    ({ pending, managedBy }) => {
      render(
        <ConfigFieldInput
          field={{ ...SORTER, managedBy }}
          value="custom-sorter"
          pending={pending}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByRole("combobox")).toBeDisabled();
      expect(screen.getByRole("textbox")).toBeDisabled();
    },
  );
});
