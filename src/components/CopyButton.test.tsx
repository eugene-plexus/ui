/**
 * A failed copy says what to do next, not only that it failed.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { copyText } from "@/lib/clipboard";

import { CopyButton } from "./CopyButton";

vi.mock("@/lib/clipboard", () => ({ copyText: vi.fn() }));

afterEach(() => vi.clearAllMocks());

describe("CopyButton", () => {
  it("tells a person whose copy failed to select the text themselves", async () => {
    vi.mocked(copyText).mockResolvedValue(false);
    render(<CopyButton text="abc" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("title", "Couldn't copy. Select the text and copy it yourself.");
    expect(button).toHaveTextContent("Select the text and copy it yourself.");
  });

  it("says Copied on success and adds no instruction", async () => {
    vi.mocked(copyText).mockResolvedValue(true);
    render(<CopyButton text="abc" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(screen.getByRole("button")).toHaveTextContent(/^Copied$/);
  });
});
