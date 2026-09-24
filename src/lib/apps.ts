/**
 * Optional apps: the spokes each agent installs and supervises.
 *
 * **Design:** `specs/docs/design/apps-and-spokes.md`. An app is not a
 * component: it holds a client key and nothing else, runs from its own
 * Python environment, and reaches the hub the way any outside client
 * does. Apps are per machine, so every read and every action is
 * addressed to the agent of the machine the app is on.
 *
 * **An app's UI is opened on its own origin, never inside this console.**
 * This page's origin holds the operator's session and a proxy to every
 * component, so anything running here has operator authority. That is
 * why `openTarget` returns a link, and why nothing in this UI frames or
 * proxies an app.
 *
 * Pure: no React, no fetching.
 */

import type { App, AppCatalogueEntry, AppInstall } from "./types";

/**
 * The proxy target for a machine's agent: `agent` for the one this
 * console is served by, `node:<name>` for any other
 * (`one-console-never-hop-nodes`).
 */
export function agentTarget(node: string | null | undefined, localNode: string | null): string {
  if (!node || node === localNode) return "agent";
  return `node:${node}`;
}

/** An install that has stopped moving, one way or another. */
export function installFinished(install: AppInstall | null | undefined): boolean {
  return install?.state === "done" || install?.state === "failed" || install?.state === "cancelled";
}

/** Plain words for where an install is. */
export function describeInstall(install: AppInstall): string {
  switch (install.state) {
    case "resolving":
      return "Getting ready…";
    case "creating":
      return "Setting up its Python…";
    case "installing":
      return "Installing…";
    case "verifying":
      return "Checking that it can start…";
    case "done":
      return "Installed.";
    case "cancelled":
      return "Cancelled.";
    case "failed":
      return "The install failed.";
  }
}

/** Whether the catalogue offers a version other than the installed one. */
export function updateAvailable(entry: AppCatalogueEntry): boolean {
  return !!entry.installedVersion && entry.installedVersion !== entry.manifest.version;
}

/** Plain words for an app's state, and whether it is a problem. */
export function describeApp(app: App): { text: string; tone: "ok" | "muted" | "warn" | "error" } {
  if (!app.enabled) return { text: "Stopped", tone: "muted" };
  switch (app.status) {
    case "running":
      return { text: "Running", tone: "ok" };
    case "starting":
      return { text: "Starting", tone: "muted" };
    case "exited":
      return { text: "Restarting", tone: "muted" };
    case "crashed":
      return { text: "Stopped after crashing", tone: "error" };
    default:
      return { text: app.status, tone: "warn" };
  }
}

function isLoopback(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  return bare === "localhost" || bare === "::1" || bare.startsWith("127.");
}

/**
 * Where "Open" goes, or why it cannot go anywhere useful from here.
 *
 * `uiUrl` is the app's node's advertised host with the app's port. A
 * loopback `uiUrl` means that node advertises no address, so the app
 * binds loopback too and only a browser on that machine can reach it --
 * which is worth saying rather than offering a link that will fail with
 * "connection refused" from a phone. `pageHost` is `window.location.hostname`.
 */
export function openTarget(
  app: App,
  pageHost: string,
): { href: string | null; note: string | null } {
  if (!app.ui || !app.uiUrl) return { href: null, note: null };
  let host: string;
  try {
    host = new URL(app.uiUrl).hostname;
  } catch {
    return { href: null, note: `This app reported an address that is not a URL: ${app.uiUrl}` };
  }
  if (isLoopback(host) && !isLoopback(pageHost)) {
    return {
      href: app.uiUrl,
      note:
        "This opens only in a browser on the machine the app runs on. To open it from here, " +
        "turn on “Reach it from other devices” on Home for that machine.",
    };
  }
  return { href: app.uiUrl, note: null };
}

/** The first line of an install failure, for a status line; the rest is detail. */
export function installErrorSummary(error: string | null | undefined): string | null {
  if (!error) return null;
  const first = error.split("\n").find((line) => line.trim().length > 0);
  return first?.trim() ?? null;
}
