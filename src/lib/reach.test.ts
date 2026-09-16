import { describe, expect, it } from "vitest";

import { canRestartHere, evidence, firewallNote, headline, listening, reachState } from "./reach";
import type { NodeReach } from "./types";

/**
 * Reach, as the card reads it.
 *
 * The load-bearing assertions are the ones about **not saying the wrong
 * confident thing**. A card that claims reach we have not got sends a
 * person to debug their phone; one that says "restart Eugene" when a
 * firewall rule is the problem gets them a restart, no change, and
 * nothing learnt. So the order of the states and the treatment of
 * `unknown` are what these tests are mostly about.
 */

function reach(over: Partial<NodeReach> = {}): NodeReach {
  return {
    enabled: true,
    restartRequired: false,
    advertiseUrl: "http://192.168.1.20:8079/",
    proposedUrl: "http://192.168.1.20:8079/",
    boundAddresses: [{ process: "agent", host: "0.0.0.0", port: 8079, reachableOffHost: true }],
    firewall: {
      supported: true,
      product: "Windows Defender Firewall",
      enabled: true,
      defaultInbound: "block",
      activeProfiles: ["Private"],
      ports: [{ port: 8079, verdict: "allowed", rule: "Eugene Plexus", scope: "port" }],
    },
    ...over,
  } as NodeReach;
}

describe("reachState", () => {
  it("is loading until the agent answers", () => {
    expect(reachState(null)).toEqual({ kind: "loading" });
  });

  it("offers the derived address when reach is off", () => {
    const state = reachState(reach({ enabled: false, advertiseUrl: undefined }));
    expect(state).toEqual({ kind: "off", proposed: "http://192.168.1.20:8079" });
    expect(headline(state)).toContain("http://192.168.1.20:8079");
    expect(headline(state)).toContain("phone");
  });

  it("says so honestly when there is no address to offer", () => {
    const state = reachState(
      reach({ enabled: false, advertiseUrl: undefined, proposedUrl: undefined }),
    );
    expect(headline(state)).toContain("not on a network");
  });

  it("puts the restart before the firewall, because the firewall is answering about a dead port", () => {
    // The state a switch leaves behind: the setting moved, the agent's
    // socket did not, and until it does the firewall's verdict is about
    // a port nothing is listening on. True, and not the thing to act on.
    const state = reachState(
      reach({
        restartRequired: true,
        firewall: {
          supported: true,
          ports: [{ port: 8079, verdict: "blocked" }],
        },
      } as Partial<NodeReach>),
    );
    expect(state.kind).toBe("restart-needed");
    expect(headline(state)).toContain("restart");
  });

  it("names the firewall when the firewall is the thing in the way", () => {
    const state = reachState(
      reach({
        firewall: {
          supported: true,
          activeProfiles: ["Private"],
          ports: [
            {
              port: 8079,
              verdict: "blocked",
              remedy: 'New-NetFirewallRule -DisplayName "Eugene Plexus" ...',
            },
          ],
        },
      } as Partial<NodeReach>),
    );
    expect(state.kind).toBe("blocked");
    if (state.kind !== "blocked") throw new Error("unreachable");
    expect(state.remedy).toContain("New-NetFirewallRule");
    expect(headline(state)).toContain("firewall");
    // And never the word "restart" -- restarting fixes nothing here.
    expect(headline(state).toLowerCase()).not.toContain("restart");
  });

  it("treats an unknown verdict as 'we could not check', never as either answer", () => {
    const state = reachState(
      reach({
        firewall: {
          supported: false,
          ports: [{ port: 8079, verdict: "unknown" }],
          detail: "Norton is also managing this machine's firewall.",
        },
      } as Partial<NodeReach>),
    );
    expect(state.kind).toBe("unchecked");
    const said = headline(state);
    // It asks for the one test that would settle it rather than
    // guessing: an eager refusal can be wrong, an explanation cannot.
    expect(said).toContain("If the page loads");
    expect(said.toLowerCase()).not.toContain("blocked");
    expect(
      firewallNote(
        reach({ firewall: { supported: false, detail: "Norton." } } as Partial<NodeReach>),
      ),
    ).toBe("Norton.");
  });

  it("treats an empty port list as unchecked rather than fine", () => {
    // A firewall object with no verdicts is a read that produced
    // nothing. Reading that as "nothing is blocking" is the inference
    // this whole module refuses to make.
    const state = reachState(
      reach({ firewall: { supported: true, ports: [] } } as Partial<NodeReach>),
    );
    expect(state.kind).toBe("unchecked");
  });

  it("is on only when something listening, something advertised and a verdict all agree", () => {
    const state = reachState(reach());
    expect(state.kind).toBe("on");
    expect(headline(state)).toContain("http://192.168.1.20:8079");
  });
});

describe("evidence", () => {
  it("is nothing until something off this machine has connected", () => {
    expect(evidence(reach())).toBeNull();
  });

  it("names the address and when, because that is the only proof from outside", () => {
    const said = evidence(
      reach({
        lastReachedFrom: "192.168.1.55",
        lastReachedAt: new Date(Date.now() - 12_000).toISOString(),
      } as Partial<NodeReach>),
    );
    expect(said).toContain("192.168.1.55");
    expect(said).toContain("seconds ago");
  });

  it("does not dress the firewall verdict up as proof", () => {
    // An `allowed` verdict on a machine nothing has ever reached is a
    // statement about rules, not about reachability. The router, the
    // subnet and a VPN are all still in the way and unmeasured here.
    expect(evidence(reach())).toBeNull();
  });
});

describe("the expert lines", () => {
  it("lists what is listening where", () => {
    expect(listening(reach())).toBe("agent on 0.0.0.0:8079");
  });

  it("warns about a Public network even when every verdict is allowed", () => {
    // The commonest cause of "it worked here yesterday": the thing that
    // will change under the person tomorrow.
    const note = firewallNote(
      reach({
        firewall: {
          supported: true,
          activeProfiles: ["Public"],
          ports: [{ port: 8079, verdict: "allowed" }],
        },
      } as Partial<NodeReach>),
    );
    expect(note).toContain("Public");
    expect(note).toContain("Private");
  });

  it("will not offer a restart where nothing would start the agent again", () => {
    expect(canRestartHere(reach())).toBe(false);
    expect(
      canRestartHere(
        reach({ restart: { mechanism: "logon_task", canSelfRestart: true } } as Partial<NodeReach>),
      ),
    ).toBe(true);
  });
});
