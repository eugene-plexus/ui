/**
 * A key's web-search switch (P8): on unless turned off, and never for a
 * local-only key, whose prompts must not leave the network.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { ClientKeyLimits } from "@/lib/types";

import {
  ClientKeyLimitsEditor,
  DEFAULT_CLIENT_LIMITS,
  describeClientLimits,
} from "./ClientKeyLimitsEditor";

function Harness({ start, seen }: { start: ClientKeyLimits; seen: ClientKeyLimits[] }) {
  const [value, setValue] = useState(start);
  return (
    <ClientKeyLimitsEditor
      value={value}
      onChange={(next) => {
        seen.push(next);
        setValue(next);
      }}
    />
  );
}

describe("the web search switch", () => {
  it("is on by default and turning it off denies every tool", () => {
    const seen: ClientKeyLimits[] = [];
    render(<Harness start={DEFAULT_CLIENT_LIMITS} seen={seen} />);
    const box = screen.getByTestId("key-web-search");
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(seen.at(-1)?.allowedTools).toEqual([]);
    fireEvent.click(box);
    expect(seen.at(-1)?.allowedTools).toBeNull();
  });

  it("is off and cannot be turned on for a local-only key", () => {
    render(<Harness start={{ ...DEFAULT_CLIENT_LIMITS, localOnly: true }} seen={[]} />);
    const box = screen.getByTestId("key-web-search");
    expect(box).not.toBeChecked();
    expect(box).toBeDisabled();
    expect(screen.getByText(/A local-only key never searches/)).toBeInTheDocument();
  });

  it("says so in the key's one-line summary", () => {
    expect(describeClientLimits({ ...DEFAULT_CLIENT_LIMITS, allowedTools: [] })).toMatch(
      /No web search/,
    );
    expect(describeClientLimits(DEFAULT_CLIENT_LIMITS)).not.toMatch(/web search/);
  });
});
