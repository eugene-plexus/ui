import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { MetricDial } from "./MetricDial";

it("keeps unknown capacity empty instead of showing a zero load", () => {
  render(<MetricDial value={undefined} total={8} label="Occupied slots" />);
  expect(screen.getByRole("img")).toHaveAccessibleName("Occupied slots: unreported");
  expect(screen.queryByText("0%")).toBeNull();
});

it("caps the needle but reports overload honestly", () => {
  render(<MetricDial value={6} total={4} label="Occupied slots" />);
  expect(screen.getByRole("img")).toHaveAccessibleName("Occupied slots: 6 of 4 (150%)");
  expect(screen.getByText("150%")).toBeInTheDocument();
  expect(document.querySelector("svg")!.outerHTML).not.toContain("NaN");
});

it("shows a measured zero cache hit rate and handles no observations separately", () => {
  const { rerender } = render(
    <MetricDial variant="segments" value={0} total={100} label="Cache reuse" />,
  );
  expect(screen.getByText("0%")).toBeInTheDocument();
  rerender(<MetricDial variant="segments" value={0} total={0} label="Cache reuse" />);
  expect(screen.getByRole("img")).toHaveAccessibleName("Cache reuse: unreported");
});
