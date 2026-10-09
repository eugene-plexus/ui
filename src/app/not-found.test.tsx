/**
 * The page for an address that is not a page.
 *
 * Without `app/not-found.tsx` the static export's `404.html` is Next's
 * own unstyled default: black on white in every theme, no way back, and
 * nothing that says which address was wrong. What matters here is that
 * it names the address that was asked for (read in the browser, because
 * an export has one `404.html` for every missing path) and links Home.
 */

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import NotFound from "./not-found";

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("the not-found page", () => {
  it("names the address that was asked for and links Home", async () => {
    window.history.replaceState({}, "", "/no/such/page/");
    render(<NotFound />);
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(await screen.findByText("/no/such/page/")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Home" })).toHaveAttribute("href", "/");
  });
});
