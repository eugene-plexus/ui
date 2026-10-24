import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Hardware } from "./Hardware";
import { IssueRow } from "./IssueRow";
import { api } from "@/lib/api";

describe("Hardware", () => {
  it("shows card health, direct peers, and unreadable fields", () => {
    render(
      <Hardware
        label="Box"
        devices={[
          {
            kind: "cuda",
            name: "RTX",
            index: 0,
            uuid: "GPU-a",
            peers: ["GPU-b"],
            pcieLink: { generation: 4, width: 4, maxGeneration: 4, maxWidth: 16 },
            powerLimitWatts: 300,
            powerDefaultLimitWatts: 450,
            throttleReasons: ["power-cap"],
            uncorrectedMemoryErrors: 0,
          },
          { kind: "cuda", name: "RTX", index: 1, uuid: "GPU-b" },
        ]}
        history={null}
      />,
    );
    expect(screen.getByText(/Gen 4 x4; supports Gen 4 x16/)).toBeTruthy();
    expect(screen.getByText(/Can reach directly: RTX #1/)).toBeTruthy();
    expect(screen.getAllByText(/300 W of 450 W/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/not reported/i).length).toBeGreaterThan(0);
  });

  it("restarts on the owning machine from the fewer-cards warning", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ scheduled: true });
    render(
      <IssueRow
        issue={{
          id: "fewer",
          kind: "runtime-on-fewer-cards",
          severity: "warning",
          title: "Model started on fewer cards",
          detail: "RTX is missing",
          href: "/inference",
          restart: { target: "node:box", name: "a/b" },
        }}
        onFixed={async () => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("node:box", "/v1/runtimes/a%2Fb/restart", {}),
    );
    post.mockRestore();
  });
});
