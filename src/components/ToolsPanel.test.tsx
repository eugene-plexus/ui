/**
 * The tools panel's editor has a name.
 *
 * It was a bare textarea: a screen reader announced "edit text" and
 * nothing about what goes in it.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EXAMPLE_TOOLS_TEXT, ToolsPanel } from "./ToolsPanel";

describe("ToolsPanel", () => {
  it("labels the tool definitions editor", () => {
    render(
      <ToolsPanel
        enabled={true}
        onEnabled={vi.fn()}
        definitions={EXAMPLE_TOOLS_TEXT}
        onDefinitions={vi.fn()}
        error={null}
        toolNames={["get_weather"]}
        toolChoice="auto"
        onToolChoice={vi.fn()}
        responseFormat="text"
        onResponseFormat={vi.fn()}
        modelToolCalling={null}
      />,
    );
    expect(screen.getByLabelText("Tool definitions (JSON)")).toBe(screen.getByTestId("tools-json"));
  });
});
