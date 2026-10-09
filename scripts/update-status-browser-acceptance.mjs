/** Exported Machines + Needs Attention, with disposable NAS/worker responses. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname, join, sep } from "node:path";
import { chromium, expect } from "@playwright/test";

const [assetsArg, outputArg] = process.argv.slice(2);
assert(
  assetsArg && outputArg,
  "usage: node update-status-browser-acceptance.mjs <static> <output>",
);
const assets = resolve(assetsArg),
  output = resolve(outputArg);
await stat(join(assets, "nodes/index.html"));
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    let file = resolve(assets, "." + decodeURIComponent(new URL(req.url, "http://test").pathname));
    assert(file === assets || file.startsWith(assets + sep));
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    const types = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".json": "application/json",
    };
    res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
const errors = [],
  checks = [],
  posts = [];
let available = false,
  matched = false,
  fail = false;
let releaseCheck;
const pending = new Promise((r) => {
  releaseCheck = r;
});
let first = true;
const newCommit = "a".repeat(40),
  oldCommit = "b".repeat(40);
const newest = { channel: "edge", ref: "c".repeat(40), components: { agent: newCommit } };
let workerUpdate = {
  enabled: true,
  channel: "edge",
  channelSource: "setting",
  available: false,
  behind: [],
  ahead: [],
  newest,
  apply: { possible: true },
  checkedAt: new Date(Date.now() - 6 * 3600_000).toISOString(),
};
const identity = (local) => ({
  name: local ? "NAS" : "Amish_Station",
  enrolled: true,
  devices: [],
  install: {
    mechanism: local ? "container" : "windows_service",
    development: false,
    components: [
      { name: "agent", state: "stamped", commit: local || matched ? newCommit : oldCommit },
    ],
  },
  update: local
    ? {
        ...workerUpdate,
        available: false,
        behind: [],
        checkedAt: new Date().toISOString(),
        apply: { possible: false },
      }
    : workerUpdate,
});
page.on("pageerror", (error) => errors.push(String(error)));
await page.addInitScript(() =>
  sessionStorage.setItem("eugene-session-token", "disposable-update-status"),
);
await page.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  const local = path.includes("/agent/");
  if (route.request().method() === "POST" && path.includes("/node/update")) {
    posts.push(path);
    assert(path.endsWith("/check"), "Status checking must never install anything");
    if (first) {
      first = false;
      await pending;
    }
    workerUpdate = {
      ...workerUpdate,
      available: available && !matched,
      behind: available && !matched ? ["agent"] : [],
      checkedAt: new Date().toISOString(),
      error: fail ? "GitHub unavailable" : null,
    };
    return route.fulfill({ json: workerUpdate });
  }
  let body = {};
  if (path.endsWith("/auth/status")) body = { initialized: true };
  else if (path.endsWith("/config")) body = { firstRunComplete: true };
  else if (path.endsWith("/node")) body = identity(local);
  else if (path.endsWith("/nodes"))
    body = {
      nodes: [
        { name: "NAS", role: "control", reachable: true, url: "http://nas:8079" },
        { name: "Amish_Station", role: "worker", reachable: true, url: "http://worker:8079" },
      ],
    };
  else if (path.endsWith("/control/status")) body = { role: "control", epoch: 1 };
  else if (path.endsWith("/admin/routing")) body = { slots: [], unreachable_drivers: [] };
  else if (path.endsWith("/admin/drivers")) body = { drivers: [] };
  else if (path.endsWith("/components")) body = { components: [] };
  else if (path.endsWith("/engines")) body = { engines: [] };
  else if (path.endsWith("/runtimes")) body = { runtimes: [] };
  else if (path.endsWith("/library/folders/check")) body = { folders: [], libraryConsulted: true };
  else if (path.endsWith("/nodes/join-tokens")) body = { tokens: [] };
  else
    return route.fulfill({ status: 404, json: { detail: "Optional endpoint absent in fixture" } });
  return route.fulfill({ json: body });
});
try {
  await page.goto(`${url}/nodes/`);
  const worker = page.locator('[data-testid="node-update"][data-node="Amish_Station"]');
  await expect(page.getByRole("status")).toContainText("Checking for newer versions");
  releaseCheck();
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(worker).toHaveAttribute("data-state", "different");
  await expect(worker).toContainText("No newer update found on edge");
  await expect(page.getByTestId("node-versions")).not.toContainText("Up to date");
  await page.getByTestId("issues-badge").click();
  const detail = await page.getByTestId("version-difference").innerText();
  await expect(page.getByTestId("issues-popover")).toContainText("release checks finish");
  assert(detail.includes("release checks finish"));
  checks.push("A stale worker is checked automatically; pending Edge is explained in both places");

  available = true;
  await worker.getByTestId("node-update-check").click();
  await expect(worker.getByTestId("node-update-now")).toBeVisible();
  await page.getByTestId("issues-badge").click();
  await expect(page.getByTestId("issues-popover")).toContainText(
    "A newer version of Eugene is ready for Amish_Station",
  );
  await expect(page.getByTestId("issues-popover")).not.toContainText(
    "Machines in this install run different versions",
  );
  checks.push("Check now changes the worker's action and the open warning together");

  available = false;
  fail = true;
  await worker.getByTestId("node-update-check").click();
  await expect(worker).toHaveAttribute("data-state", "check-failed");
  await expect(worker).toContainText("GitHub unavailable");
  await expect(page.getByTestId("node-versions")).not.toContainText("Up to date");
  checks.push("A failed update check is not presented as up to date");

  fail = false;
  matched = true;
  workerUpdate = { ...workerUpdate, available: false, behind: [], error: null };
  await page.getByTestId("issues-badge").click();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(worker).toHaveAttribute("data-state", "current");
  await expect(page.getByTestId("version-difference")).toHaveCount(0);
  await expect(page.getByTestId("issues-badge")).toHaveCount(0);
  await expect(page.getByTestId("issues-popover")).toHaveCount(0);
  assert.deepEqual(errors, []);
  checks.push("Matching versions clear the open warning and Machines notice without F5");
  await page.screenshot({ path: join(output, "updates-matched.png") });
  console.log(JSON.stringify({ checks, posts: posts.length, errors }, null, 2));
} finally {
  releaseCheck();
  await writeFile(
    join(output, "browser.json"),
    JSON.stringify({ checks, posts: posts.length, errors }, null, 2),
  );
  await browser.close();
  await new Promise((r) => server.close(r));
}
