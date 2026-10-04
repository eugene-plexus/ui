import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Download } from "@/lib/types";
import { DownloadProgress } from "./DownloadProgress";

const base: Download = {
  id: "download-1",
  repo: "models/test",
  files: [],
  state: "downloading",
  bytesDownloaded: 2e9,
  bytesTotal: 8e9,
};

describe("DownloadProgress", () => {
  it("shows byte progress with a named bar and readable values", () => {
    render(<DownloadProgress download={base} />);
    expect(screen.getByRole("progressbar", { name: "Downloading: models/test" })).toHaveAttribute(
      "aria-valuenow",
      "25",
    );
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText(/of 8/)).toBeInTheDocument();
  });

  it.each([undefined, 0, NaN, Infinity, -1])(
    "stays indeterminate when the size is %s",
    (bytesTotal) => {
      render(<DownloadProgress download={{ ...base, bytesTotal }} />);
      expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
      expect(screen.queryByText(/%/)).not.toBeInTheDocument();
      expect(screen.getByText(/size not known yet/)).toBeInTheDocument();
    },
  );

  it("does not mistake verifying all bytes for a finished download", () => {
    render(<DownloadProgress download={{ ...base, state: "verifying", bytesDownloaded: 8e9 }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Verifying files");
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  });

  it("shows the paused amount without claiming to be downloading", () => {
    render(<DownloadProgress download={{ ...base, state: "paused" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Download paused");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
  });

  it.each(["cancelled", "done", "failed"] as const)(
    "does not show active progress for %s",
    (state) => {
      render(<DownloadProgress download={{ ...base, state, error: "Disk full" }} />);
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      expect(screen.queryByText(/Downloading/)).not.toBeInTheDocument();
      if (state === "failed") expect(screen.getByRole("status")).toHaveTextContent("Disk full");
    },
  );

  it("keeps the bar within its bounds when the reported total lags the transferred bytes", () => {
    render(<DownloadProgress download={{ ...base, bytesDownloaded: 9e9 }} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });
});
