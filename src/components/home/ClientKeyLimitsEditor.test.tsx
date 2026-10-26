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
  cleanClientLimits,
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

describe("the limits say what is in effect (settings never lie, 2026-09-30)", () => {
  it("a key allowed exactly web_search reads as allowed to search", () => {
    const limits = { ...DEFAULT_CLIENT_LIMITS, allowedTools: ["web_search"] };
    render(<Harness start={limits} seen={[]} />);
    expect(screen.getByTestId("key-web-search")).toBeChecked();
    expect(describeClientLimits(limits)).not.toContain("No web search");
    expect(describeClientLimits({ ...limits, allowedTools: ["other"] })).toContain("No web search");
    expect(describeClientLimits({ ...limits, allowedTools: ["web_*"] })).not.toContain(
      "No web search",
    );
  });

  it("an emptied number box is the default, never 0", () => {
    const seen: ClientKeyLimits[] = [];
    render(<Harness start={DEFAULT_CLIENT_LIMITS} seen={seen} />);
    const box = screen.getByLabelText("Concurrent requests");
    fireEvent.change(box, { target: { value: "" } });
    expect(seen.at(-1)?.maxConcurrentRequests).toBeUndefined();
    expect(box).toHaveValue(null);
    expect(box).toHaveAttribute("placeholder", "2 (default)");
    expect(JSON.stringify(seen.at(-1))).not.toContain("maxConcurrentRequests");
  });
});

describe("the send-logs switch (C1)", () => {
  it("is off by default, turns writeLogs on, and says so in the summary", () => {
    const seen: ClientKeyLimits[] = [];
    render(<Harness start={DEFAULT_CLIENT_LIMITS} seen={seen} />);
    const box = screen.getByTestId("key-write-logs");
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(seen.at(-1)?.writeLogs).toBe(true);
    expect(describeClientLimits({ ...DEFAULT_CLIENT_LIMITS, writeLogs: true })).toMatch(
      /Sends logs/,
    );
    expect(describeClientLimits(DEFAULT_CLIENT_LIMITS)).not.toMatch(/logs/);
  });

  it("shows a key that may send as checked", () => {
    render(<Harness start={{ ...DEFAULT_CLIENT_LIMITS, writeLogs: true }} seen={[]} />);
    expect(screen.getByTestId("key-write-logs")).toBeChecked();
  });
});

describe("the key's place in line (row 11)", () => {
  it("shows the band in effect and sets the one chosen", () => {
    const seen: ClientKeyLimits[] = [];
    render(<Harness start={DEFAULT_CLIENT_LIMITS} seen={seen} />);
    const priority = screen.getByLabelText("Priority") as HTMLSelectElement;
    expect(priority.value).toBe("interactive");
    expect(screen.getByRole("option", { name: "Dropped first when busy" })).toBeInTheDocument();
    fireEvent.change(priority, { target: { value: "background" } });
    expect(seen.at(-1)?.band).toBe("background");
    fireEvent.change(priority, { target: { value: "sheddable" } });
    expect(seen.at(-1)?.band).toBe("sheddable");
  });

  it("says how many requests may wait, and that 0 refuses at once", () => {
    const seen: ClientKeyLimits[] = [];
    render(<Harness start={DEFAULT_CLIENT_LIMITS} seen={seen} />);
    const waiting = screen.getByLabelText("Requests that may wait") as HTMLInputElement;
    expect(waiting.value).toBe("8");
    expect(screen.getByText(/0 refuses at once/)).toBeInTheDocument();
    fireEvent.change(waiting, { target: { value: "0" } });
    expect(seen.at(-1)?.maxQueuedRequests).toBe(0);
  });

  it("sends a band and a queue bound only when they are not the defaults", () => {
    const sent = cleanClientLimits(DEFAULT_CLIENT_LIMITS);
    expect("band" in sent || "maxQueuedRequests" in sent).toBe(false);
    expect(
      cleanClientLimits({ ...DEFAULT_CLIENT_LIMITS, band: "background", maxQueuedRequests: 0 }),
    ).toMatchObject({ band: "background", maxQueuedRequests: 0 });
  });

  it("names a lower band and the line in the key's one-line summary", () => {
    expect(describeClientLimits({ ...DEFAULT_CLIENT_LIMITS, band: "background" })).toMatch(
      /Background/,
    );
    expect(describeClientLimits({ ...DEFAULT_CLIENT_LIMITS, maxQueuedRequests: 0 })).toMatch(
      /none may wait/,
    );
    expect(describeClientLimits(DEFAULT_CLIENT_LIMITS)).toMatch(/8 may wait/);
    expect(describeClientLimits(DEFAULT_CLIENT_LIMITS)).not.toMatch(/Background|Dropped/);
  });
});
