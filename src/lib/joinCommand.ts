/**
 * The Nodes page's join command: which control-root address it names,
 * how it is written for each shell, and whether the token in it can
 * still be used.
 *
 * Pure and kept off the page so both halves are tested as data -- a Next
 * page module may export nothing but the page.
 */

import { isLoopbackHost } from "./diagnostic";

/** The control root's default port, and the agent's. */
const CONTROL_PORT = 8083;
const AGENT_PORT = 8079;
const GATEWAY_PORT = 8080;

/**
 * The ports this install's parts listen on, as another machine sees them.
 *
 * Nothing on this page can read a published port directly. A container
 * maps them outside itself, where no component can see the mapping. So
 * every port keeps the offset the root's own agent address shows, which
 * is the same guess `rootControlUrl` makes.
 */
export interface InstallPorts {
  /** This console: the agent, which serves the page. */
  agent: number;
  /** Where applications send their requests. */
  gateway: number;
  /** Where another machine joins. */
  control: number;
  /** How far every port sits from its default; 0 on an ordinary install. */
  offset: number;
}

export function installPorts(rootAgentUrl: string | null): InstallPorts {
  let offset = 0;
  if (rootAgentUrl) {
    try {
      const port = new URL(rootAgentUrl).port;
      if (port !== "" && Number.isInteger(Number(port))) offset = Number(port) - AGENT_PORT;
    } catch {
      offset = 0;
    }
  }
  return {
    agent: AGENT_PORT + offset,
    gateway: GATEWAY_PORT + offset,
    control: CONTROL_PORT + offset,
    offset,
  };
}

/** What is wrong with a typed control-root address, and the address that fixes it. */
export interface ControlAddressCheck {
  problems: string[];
  /** The typed address with every problem fixed, or null when none can be. */
  suggestion: string | null;
}

/**
 * Check the address a person typed for the control root.
 *
 * It warns and never blocks: someone who moved the root to another port
 * on purpose knows more than this guess does. A problem it can fix comes
 * with the fixed address, so the page can offer it in one click.
 *
 * Found by a person on Windows (2026-09-26), who typed the console's port
 * with no `http://`, because nothing on the page said which of three ports
 * was wanted once the placeholder vanished.
 */
export function checkControlAddress(
  typed: string,
  ports: InstallPorts,
): ControlAddressCheck | null {
  const value = typed.trim();
  if (value === "") return null;
  const problems: string[] = [];
  let candidate = value;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    problems.push("It needs http:// at the start.");
    candidate = `http://${candidate}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      problems: [
        "That is not an address. It should look like http://192.168.1.20:" + ports.control + ".",
      ],
      suggestion: null,
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      problems: ["It should start with http:// or https://."],
      suggestion: null,
    };
  }
  const port = parsed.port === "" ? null : Number(parsed.port);
  if (port === null) {
    problems.push(`It has no port. The control root is on port ${ports.control}.`);
  } else if (port === ports.agent) {
    problems.push(
      `Port ${port} is this console, not the control root. The control root is on port ${ports.control}.`,
    );
  } else if (port === ports.gateway) {
    problems.push(
      `Port ${port} is where your apps connect, not the control root. The control root is on port ${ports.control}.`,
    );
  } else if (port !== ports.control) {
    problems.push(
      `This install's control root is on port ${ports.control}, not ${port}. ` +
        "Keep it only if you moved the control root to that port yourself.",
    );
  }
  if (problems.length === 0) return null;
  if (port !== ports.control) parsed.port = String(ports.control);
  return { problems, suggestion: parsed.toString().replace(/\/+$/, "") };
}

/**
 * Turn a node's agent address into the control root's.
 *
 * `Node.url` is where the *agent* listens; the control root is a
 * component on that same host, on its own port. The guess keeps the
 * agent's OFFSET rather than naming 8083: an install that publishes
 * every port shifted by the same amount (the container template's +200,
 * an acceptance run's +100) publishes the root shifted too, so 8279 means
 * 8283 there -- and a hard-coded 8083 named a port nothing listened on.
 * Still a guess, so the page shows it in an editable field.
 */
export function rootControlUrl(agentUrl: string): string {
  try {
    const parsed = new URL(agentUrl);
    parsed.port = String(installPorts(agentUrl).control);
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return agentUrl;
  }
}

/**
 * Whether an address can only be reached from the machine it names.
 * A join command naming one fails on the other machine with "connection
 * refused", and nothing on this page used to say so.
 */
export function isLoopbackUrl(url: string): boolean {
  try {
    return isLoopbackHost(new URL(url).hostname) || new URL(url).hostname.startsWith("127.");
  } catch {
    return false;
  }
}

/** Where the installers are served from, the address the deployment docs give. */
const INSTALLER_BASE = "https://raw.githubusercontent.com/eugene-plexus/specs/main/scripts";

/** What a join needs: where the root is, the token, and the name asked for. */
export interface JoinDetails {
  controlUrl: string;
  token: string;
  nodeName?: string | null;
}

/** Characters both shells take as one plain word, so nothing needs quoting. */
const PLAIN_WORD = /^[A-Za-z0-9._:/@%+=-]+$/;

function powershellWord(value: string): string {
  return PLAIN_WORD.test(value) ? value : `'${value.replace(/'/g, "''")}'`;
}

function shellWord(value: string): string {
  return PLAIN_WORD.test(value) ? value : `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * The join, as the installer runs it, on a Windows machine.
 *
 * **The installer, not `eugene-plexus-agent join`.** The page used to
 * print the agent's own join command. That works only where the agent
 * is already installed, and installing it without the join first sets
 * up a control plane of its own on the new machine (2026-09-26). The
 * installer's `-Join` installs and joins in one step, and asks for
 * administrator rights itself.
 *
 * **One line, for both shells.** The old command was broken across
 * lines with `\`, which PowerShell rejects ("Missing expression after
 * unary operator '--'").
 */
export function windowsJoinCommand({ controlUrl, token, nodeName }: JoinDetails): string {
  const args = [`-Join ${powershellWord(controlUrl)}`, `-Token ${powershellWord(token)}`];
  if (nodeName) args.push(`-NodeName ${powershellWord(nodeName)}`);
  return `& ([scriptblock]::Create((irm ${INSTALLER_BASE}/install.ps1))) ${args.join(" ")}`;
}

/** The same join on Linux or macOS, as `tailnet.md` gives it. */
export function posixJoinCommand({ controlUrl, token, nodeName }: JoinDetails): string {
  const args = [`--join ${shellWord(controlUrl)}`, `--token ${shellWord(token)}`];
  if (nodeName) args.push(`--name ${shellWord(nodeName)}`);
  return `curl -fsSL ${INSTALLER_BASE}/install.sh | sh -s -- ${args.join(" ")}`;
}

export type JoinTokenState = "usable" | "used" | "expired";

/**
 * What a token shown on the page is good for now. A used or expired one
 * must stop offering its command: "It expires already passed." above a
 * Copy button was the old reading.
 */
export function joinTokenState(
  token: { expiresAt: string; used?: boolean | null },
  now: number = Date.now(),
): JoinTokenState {
  if (token.used) return "used";
  const expires = Date.parse(token.expiresAt);
  if (!Number.isNaN(expires) && expires <= now) return "expired";
  return "usable";
}
