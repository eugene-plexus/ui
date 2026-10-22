/**
 * "Change this machine's key now" (row 3, part 3b): the question it asks,
 * the call to that machine's own agent, Stop before the switch, and the
 * agent's refusal shown in its words.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "@/lib/api";
import type { NodeIdentity } from "@/lib/types";

import { MachineKeyCard } from "./MachineKeyCard";

afterEach(() => vi.restoreAllMocks());

function identity(machine: Record<string, unknown>): NodeIdentity {
  return {
    machine: {
      pin: "p".repeat(43),
      listening: true,
      required: true,
      keyMadeAt: "2026-01-01T00:00:00Z",
      keyChangeDueAt: "2027-01-01T00:00:00Z",
      ...machine,
    },
  } as unknown as NodeIdentity;
}

describe("MachineKeyCard", () => {
  it("asks first, then starts the change on that machine's agent", async () => {
    const onChanged = vi.fn();
    const post = vi.spyOn(api, "post").mockResolvedValue({ state: "waiting" });
    const user = userEvent.setup();
    render(
      <MachineKeyCard
        name="nas"
        label="NAS"
        target="node:nas"
        identity={identity({})}
        observed={null}
        others={2}
        onChanged={onChanged}
      />,
    );
    expect(screen.getByTestId("machine-key-nas")).toHaveTextContent(/Next key change: /);
    await user.click(screen.getByRole("button", { name: "Change NAS's key now" }));
    expect(screen.getByText(/The others take it within a few minutes; nothing stops/)).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Change the key" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith("node:nas", "/v1/node/machine-key", {});
  });

  it("offers Stop while the change waits, and calls it on that machine", async () => {
    const onChanged = vi.fn();
    const del = vi.spyOn(api, "delete").mockResolvedValue({ state: "stopped" });
    const user = userEvent.setup();
    render(
      <MachineKeyCard
        name="nas"
        label="NAS"
        target="node:nas"
        identity={identity({
          keyChange: { state: "waiting", startedAt: "2026-10-22T11:59:00Z", nextPin: "n" },
        })}
        observed={{ nextPin: "n", waitingOn: ["gpu"], unreachable: [], notReady: [] }}
        others={2}
        onChanged={onChanged}
      />,
    );
    expect(screen.getByTestId("machine-key-nas")).toHaveTextContent(
      "Changing machine key: 1 of 2 machines have the new key",
    );
    expect(screen.queryByRole("button", { name: "Change NAS's key now" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Stop the key change on NAS" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(del).toHaveBeenCalledWith("node:nas", "/v1/node/machine-key");
  });

  it("shows the agent's refusal in its words", async () => {
    vi.spyOn(api, "post").mockRejectedValue(
      new ApiError(409, "Conflict", {
        detail: {
          title: "The root cannot change machine keys",
          status: 409,
          detail:
            "The root runs a version that does not take a next machine key. Update the " +
            "machine that runs the root first.",
        },
      }),
    );
    const user = userEvent.setup();
    render(
      <MachineKeyCard
        name="nas"
        label="NAS"
        target="node:nas"
        identity={identity({})}
        observed={null}
        others={1}
        onChanged={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Change NAS's key now" }));
    await user.click(screen.getByRole("button", { name: "Change the key" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Update the machine that runs/);
  });
});
