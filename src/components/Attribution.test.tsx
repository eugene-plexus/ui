/**
 * The licence line reaches all three of its surfaces.
 *
 * **These are wiring tests, not component tests, and the distinction is
 * the point.** A test that renders `<Attribution />` and finds its own
 * string proves the component, and the component is trivially right; it
 * would stay green while every surface stopped rendering it. S7 produced
 * that exact escape twice in one slice (Home's card proved while Home
 * could have fed it `[]` forever), so these drive the SURFACES and let
 * the string be the assertion.
 *
 * The third surface, the Login card, is driven in `app/login/page.test.tsx`
 * rather than here, because signing in needs a stubbed fetch and a
 * mocked router that already exist there. Three surfaces, three driven.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LayerMap } from "./LayerMap";
import { UIPreferences } from "./UIPreferences";

import { ATTRIBUTION } from "./Attribution";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("the licence line", () => {
  it("names the licence and the holder, and says 2026", () => {
    // The string itself is the legal notice, so it is asserted by value
    // and not by shape -- a regex over /Apache/ would pass a line that
    // had lost the copyright half.
    expect(ATTRIBUTION).toBe("Apache-2.0 · Copyright 2026 Eugene Plexus contributors");
  });

  it("closes the layer map, the panel that explains what this is", () => {
    render(<LayerMap id="map" current={null} onClose={() => {}} />);
    expect(screen.getByTestId("layer-map")).toHaveTextContent(ATTRIBUTION);
  });

  it("is an About row in Config -> UI, where a person looks for a version", () => {
    render(<UIPreferences />);
    // Driven through the row, not the raw text: a line rendered without
    // its label is not the About row the brief asked for.
    const about = screen.getByText("About").closest("div")?.parentElement;
    expect(about).toHaveTextContent(ATTRIBUTION);
  });
});
