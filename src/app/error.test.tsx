/**
 * The error boundary says only what is true on the page it caught.
 *
 * It told every page "Your conversation is still saved", which is true
 * of the playground (the transcript is written to the tab's storage on
 * every change) and meaningless or false everywhere else - a promise on
 * the Library page about a conversation that does not exist.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ErrorPage from "./error";

let pathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the error page", () => {
  it("makes no promise about a conversation on a page that has none", () => {
    pathname = "/library/";
    render(<ErrorPage error={new Error("boom")} reset={() => {}} />);
    expect(screen.getByRole("heading")).toBeInTheDocument();
    expect(screen.queryByText(/conversation/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("says the conversation is kept on the playground, where it is", () => {
    pathname = "/playground/";
    render(<ErrorPage error={new Error("boom")} reset={() => {}} />);
    expect(screen.getByText(/Your conversation is still saved\./)).toBeInTheDocument();
  });
});
