/**
 * The `path_mappings` editor and the Browse button on path lists (M11).
 *
 * The editor keeps a half-filled row to itself and hands the parent only
 * complete pairs — the same rule the list editor has always had for a
 * half-typed directory — so what reaches the server is never a mapping
 * the operator has not finished.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfigFieldInput } from "./ConfigField";
import type { ConfigField } from "@/lib/types";

const MAPPINGS: ConfigField = {
  key: "pathMappings",
  label: "Model directory mappings",
  valueType: "path_mappings",
  category: "storage",
  sensitive: false,
  required: false,
  requiresRestart: false,
  default: [],
};

const ROOTS: ConfigField = {
  key: "modelRoots",
  label: "Model directories",
  valueType: "path_list",
  category: "library",
  sensitive: false,
  required: false,
  requiresRestart: false,
  default: [],
};

describe("PathMappingsInput", () => {
  it("offers the library's roots for `from`, and reports only complete pairs", () => {
    const onChange = vi.fn();
    render(
      <ConfigFieldInput
        field={MAPPINGS}
        value={[]}
        pending={false}
        browseTarget="node:Amish_Station"
        pathSuggestions={["/models"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "add override" }));

    // The first suggestion pre-fills `from`; `to` is still empty, so the
    // parent has not been told anything.
    const from = screen.getByLabelText("Library folder, as the Library states it");
    expect(from).toHaveValue("/models");
    expect(onChange).not.toHaveBeenCalled();
    expect(document.querySelector("datalist option[value='/models']")).not.toBeNull();

    fireEvent.change(screen.getByLabelText("The same directory on this host"), {
      target: { value: "Z:\\models" },
    });
    expect(onChange).toHaveBeenLastCalledWith([{ from: "/models", to: "Z:\\models" }]);

    // Browse exists because the field knows whose host it is about.
    expect(screen.getByRole("button", { name: "browse" })).toBeInTheDocument();
  });

  it("renders what the server holds, and removing a row sends the rest", () => {
    const onChange = vi.fn();
    render(
      <ConfigFieldInput
        field={MAPPINGS}
        value={[
          { from: "/models", to: "Z:\\models" },
          { from: "/big", to: "Y:\\big" },
        ]}
        pending={false}
        onChange={onChange}
      />,
    );
    expect(
      screen
        .getAllByLabelText("Library folder, as the Library states it")
        .map((i) => (i as HTMLInputElement).value),
    ).toEqual(["/models", "/big"]);
    // No target to browse: no Browse button.
    expect(screen.queryByRole("button", { name: "browse" })).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "remove" })[0]!);
    expect(onChange).toHaveBeenLastCalledWith([{ from: "/big", to: "Y:\\big" }]);
  });

  it("a path list gains Browse only when it knows whose host it is about", () => {
    const { rerender } = render(
      <ConfigFieldInput field={ROOTS} value={["/models"]} pending={false} onChange={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "browse" })).toBeNull();
    rerender(
      <ConfigFieldInput
        field={ROOTS}
        value={["/models"]}
        pending={false}
        browseTarget="library"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "browse" })).toBeInTheDocument();
  });
});
