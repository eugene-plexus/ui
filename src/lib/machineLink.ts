/**
 * One line on Machines: whether the root reaches a machine over TLS (LT1).
 *
 * `specs/docs/design/tls-between-machines.md` §3.6. The control root
 * observes it on every poll (`Node.machineTls`) and this says it the way a
 * person reads it: encrypted, or not and why, with what fixes it. A key that
 * does not match is said as what it is, a refusal, and is never retried
 * quietly.
 */

export type MachineLinkState = "encrypted" | "no_key" | "unreachable" | "refused" | "unknown";

export interface MachineLinkInput {
  name: string;
  label?: string | null;
  agentVersion?: string | null;
  os?: string | null;
  machineUrl?: string | null;
  machineTls?: { state: MachineLinkState; detail?: string | null } | null;
}

export interface MachineLinkLine {
  text: string;
  tone: "good" | "bad" | "muted";
  /** What a person can do about it, when there is something. */
  fix: string | null;
}

/** The port a machine's TLS door is on, from the URL it announced. */
function portOf(url: string | null | undefined): string {
  if (!url) return "8083";
  try {
    return new URL(url).port || "443";
  } catch {
    return "8083";
  }
}

/** What opens a port on that machine, said for its platform. */
function firewallFix(os: string | null | undefined, port: string): string {
  if (os === "windows") {
    return (
      `Eugene opens port ${port} in Windows Firewall by itself; if another firewall runs ` +
      `there, allow TCP ${port} in it.`
    );
  }
  if (os === "macos") {
    return `Allow incoming connections to Eugene on port ${port} in macOS's firewall settings.`;
  }
  return `Allow TCP port ${port} in that machine's firewall (ufw allow ${port}/tcp).`;
}

export function describeMachineLink(node: MachineLinkInput): MachineLinkLine | null {
  const who = node.label || node.name;
  const link = node.machineTls;
  if (!link) return null;
  switch (link.state) {
    case "encrypted":
      return { text: "Encrypted", tone: "good", fix: null };
    case "no_key":
      return {
        text: `Not encrypted: ${who} runs ${
          node.agentVersion ? `v${node.agentVersion.replace(/^v/, "")}` : "an older version"
        }; update it`,
        tone: "bad",
        fix: null,
      };
    case "unreachable": {
      const port = portOf(node.machineUrl);
      return {
        text:
          `Not encrypted: the root can't reach ${who} on port ${port}` +
          (link.detail ? ` (${link.detail})` : ""),
        tone: "bad",
        fix: firewallFix(node.os, port),
      };
    }
    case "refused":
      return {
        text: `${who}'s machine key doesn't match the one it registered. Nothing was sent to it.`,
        tone: "bad",
        fix:
          "Something on the network is answering in its place, or it was set up again " +
          "with a new key. If it was reinstalled, remove it and join it again.",
      };
    default:
      // Not polled yet, or this root's own machine, which it reaches locally.
      return null;
  }
}

export type MachineEncryption = "automatic" | "required" | "off";

/** The install-wide setting, as Machines names it above the table. */
export function describeEncryption(value: MachineEncryption | null | undefined): string {
  switch (value) {
    case "required":
      return "Encryption between machines: required";
    case "off":
      return "Encryption between machines: off. Machines on an older version are reached in plain text.";
    default:
      return "Encryption between machines: automatic. It becomes required once every machine is encrypted.";
  }
}

/** The control root's setting, on its Config page. */
export const ENCRYPTION_SETTING_HREF = "/config?sel=control#machineEncryption";
