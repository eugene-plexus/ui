import { describe, expect, it } from "vitest";

import { describeEncryption, describeMachineLink } from "./machineLink";

describe("describeMachineLink", () => {
  it("says encrypted plainly", () => {
    expect(describeMachineLink({ name: "gpu", machineTls: { state: "encrypted" } })).toMatchObject({
      text: "Encrypted",
      tone: "good",
      fix: null,
    });
  });

  it("names the version a machine without a key runs", () => {
    expect(
      describeMachineLink({
        name: "amish",
        label: "Amish_Station",
        agentVersion: "0.3.1",
        machineTls: { state: "no_key" },
      })?.text,
    ).toBe("Not encrypted: Amish_Station runs v0.3.1; update it");
  });

  it("names the port it cannot reach and the fix for that platform", () => {
    const line = describeMachineLink({
      name: "amish",
      label: "Amish_Station",
      os: "linux",
      machineUrl: "https://192.168.1.7:8283",
      machineTls: { state: "unreachable", detail: "connection refused" },
    });
    expect(line?.text).toBe(
      "Not encrypted: the root can't reach Amish_Station on port 8283 (connection refused)",
    );
    expect(line?.fix).toContain("8283");
  });

  it("says why a machine's port does not answer, in that machine's words", () => {
    const line = describeMachineLink({
      name: "amish",
      label: "Amish_Station",
      machineTls: { state: "door_down", detail: "port 8083 is held by python (pid 4242)" },
    });
    expect(line?.text).toBe("Not reachable: port 8083 is held by python (pid 4242)");
    expect(line?.tone).toBe("bad");
    expect(describeMachineLink({ name: "amish", machineTls: { state: "door_down" } })?.text).toBe(
      "Not reachable: amish's machine port is not open",
    );
  });

  it("says a refused key is a refusal", () => {
    const line = describeMachineLink({ name: "amish", machineTls: { state: "refused" } });
    expect(line?.text).toBe(
      "amish's machine key doesn't match the one it registered. Nothing was sent to it.",
    );
    expect(line?.tone).toBe("bad");
  });

  it("says nothing it has not observed", () => {
    expect(describeMachineLink({ name: "gpu", machineTls: { state: "unknown" } })).toBeNull();
    expect(describeMachineLink({ name: "gpu" })).toBeNull();
  });
});

describe("describeEncryption", () => {
  it("defaults to automatic, which is what an install upgraded from before LT1 has", () => {
    expect(describeEncryption(undefined)).toContain("automatic");
    expect(describeEncryption("required")).toBe("Encryption between machines: required");
  });
});
