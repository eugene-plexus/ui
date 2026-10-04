/**
 * The Reach card's restart line, where nothing can restart Eugene for
 * the person: the command they must type is the whole of the remedy, so
 * it gets the same Copy button the firewall remedy beside it has always
 * had. Rendered as the card, since the button is the card's wiring.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { NodeReach } from "@/lib/types";

import { ReachCard } from "./ReachCard";

function restartNeeded(command: string | null): NodeReach {
  return {
    enabled: true,
    restartRequired: true,
    advertiseUrl: "http://192.168.1.20:8079/",
    proposedUrl: "http://192.168.1.20:8079/",
    restart: { canSelfRestart: false, mechanism: "none", command },
  } as unknown as NodeReach;
}

describe("a restart only the person can do", () => {
  it("offers to copy the command it names", () => {
    render(<ReachCard reach={restartNeeded("eugene-plexus-agent")} onChanged={() => {}} />);
    const copy = screen.getByRole("button", { name: "Copy" });
    expect(copy).toHaveAttribute("title", "Copy the restart command");
  });

  it("offers nothing to copy when there is no command to name", () => {
    render(<ReachCard reach={restartNeeded(null)} onChanged={() => {}} />);
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
  });
});
