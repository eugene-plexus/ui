/**
 * "Remove from install" (CX6): what the confirm says, and that the root's
 * own refusal is shown in its words.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "@/lib/api";

import { RemoveMachine, removalWarnings } from "./RemoveMachine";

const DOWN = { name: "old-box", reachable: false, standby: false, siteOwners: [] };

afterEach(() => vi.restoreAllMocks());

describe("removalWarnings", () => {
  it("always says the key is revoked and the way back", () => {
    const text = removalWarnings(DOWN).join(" ");
    expect(text).toMatch(/key is revoked/);
    expect(text).toMatch(/join again with a new token/);
    expect(text).not.toMatch(/running now|standby|job site/);
  });

  it("names what a running standby that hosts a job site loses", () => {
    const text = removalWarnings({
      ...DOWN,
      reachable: true,
      standby: true,
      siteOwners: ["Jessie"],
    }).join(" ");
    expect(text).toMatch(/It is running now/);
    expect(text).toMatch(/no standby until you choose another/);
    expect(text).toMatch(/hosts Jessie's job site\. The job site stays/);
  });
});

describe("RemoveMachine", () => {
  it("shows the root's refusal and does not call it removed", async () => {
    const onRemoved = vi.fn();
    vi.spyOn(api, "delete").mockRejectedValue(
      new ApiError(409, "Conflict", {
        detail: {
          title: "The only gateway",
          status: 409,
          detail: "'old-box' runs the only gateway in this install. Nothing was removed.",
        },
      }),
    );
    const user = userEvent.setup();
    render(<RemoveMachine facts={{ ...DOWN, label: "Old box" }} onRemoved={onRemoved} />);
    await user.click(screen.getByRole("button", { name: "Remove Old box from install" }));
    await user.click(screen.getByRole("button", { name: "Remove and revoke its key" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/only gateway/);
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("removes and tells the page", async () => {
    const onRemoved = vi.fn();
    const del = vi.spyOn(api, "delete").mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<RemoveMachine facts={DOWN} onRemoved={onRemoved} />);
    await user.click(screen.getByRole("button", { name: "Remove old-box from install" }));
    await user.click(screen.getByRole("button", { name: "Remove and revoke its key" }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(del).toHaveBeenCalledWith("control", "/v1/nodes/old-box");
  });
});
