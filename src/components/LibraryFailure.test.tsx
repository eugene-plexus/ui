import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { ApiError, describeError } from "@/lib/api";
import { LibraryFailure, GatewayLibraryState } from "./LibraryFailure";

it("shows what still works and keeps the proxy cause behind Details", () => {
  const error = new ApiError(
    502,
    "Bad Gateway",
    {
      detail: { detail: "library at http://nas:1234/v1/models did not answer: connection refused" },
    },
    "library",
  );
  render(<LibraryFailure error={error} />);
  expect(
    screen.getByText(
      /Running models keep serving, and machines start models from their own copies/,
    ),
  ).toBeVisible();
  expect(describeError(error)).toContain("The Library is not answering (connection refused).");
  fireEvent.click(screen.getByText("Details"));
  expect(screen.getByText(/library at http/)).toBeVisible();
});

it("counts only the saved settings the gateway reports in effect", () => {
  render(
    <GatewayLibraryState
      library={{
        reachable: false,
        since: null,
        cause: "connection refused",
        modelsOnSavedSettings: 3,
      }}
    />,
  );
  expect(
    screen.getByText("The Library is not answering. 3 models use their last known settings."),
  ).toBeVisible();
});
