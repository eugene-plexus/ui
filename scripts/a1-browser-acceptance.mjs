/** A1: exported Home with controlled slow/failed routing, never the live install. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname, join, sep } from "node:path";
const require = createRequire(new URL("../package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const [assetsArg, outputArg] = process.argv.slice(2);
assert(
  assetsArg && outputArg,
  "usage: node a1-browser-acceptance.mjs <export-or-wheel-static> <output>",
);
const assets = resolve(assetsArg),
  output = resolve(outputArg);
await stat(join(assets, "index.html"));
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
const checks = [],
  errors = [];
let status = "loading",
  onDemand = false,
  unavailable = false,
  posts = [],
  failRequest = false,
  hang = false;
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => sessionStorage.setItem("eugene-session-token", "a1-disposable"));
await page.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  const backend = {
    driver: "test-driver",
    eligible: status === "ready",
    runtime: "test-runtime",
    runtime_status: status,
    start_on_demand: onDemand,
    node: "test-node",
  };
  let body = {};
  if (path.endsWith("/auth/status")) body = { initialized: true };
  else if (path.endsWith("/config")) body = { firstRunComplete: true };
  else if (path.endsWith("/node")) body = { name: "test-node", devices: [] };
  else if (path.endsWith("/components")) body = { components: [] };
  else if (path.endsWith("/nodes")) body = { nodes: [] };
  else if (path.includes("/gateway/v1/models"))
    body = {
      object: "list",
      data: [
        {
          id: "test-model",
          object: "model",
          x_eugene_plexus: {
            surfaces: ["chat"],
            ready_backends: status === "ready" ? 1 : 0,
            on_demand: onDemand && status === "stopped",
          },
        },
      ],
    };
  else if (path.endsWith("/admin/routing")) {
    if (unavailable) return route.fulfill({ status: 503, json: { detail: "gateway unreachable" } });
    body = {
      refreshed_at: new Date().toISOString(),
      slots: [{ model: "test-model", tiers: [{ target: "test-model", backends: [backend] }] }],
    };
  } else if (path.endsWith("/admin/drivers")) body = { drivers: [] };
  else if (path.endsWith("/runtimes")) body = { runtimes: [] };
  else if (path.endsWith("/models")) body = { models: [] };
  else if (path.endsWith("/engines")) body = { engines: [] };
  else if (path.endsWith("/downloads")) body = { downloads: [] };
  else if (path.endsWith("/benchmarks")) body = { benchmarks: [] };
  else if (path.endsWith("/chat/completions")) {
    posts.push(route.request().postDataJSON());
    if (hang) return; // Kept open until the browser cancels or closes.
    if (failRequest)
      return route.fulfill({
        status: 503,
        json: { detail: "Model stopped before the request arrived" },
      });
    return route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"model":"test-model","choices":[{"delta":{"content":"Hello from the test backend"}}]}\n\ndata: [DONE]\n\n',
    });
  } else
    return route.fulfill({
      status: 404,
      json: { detail: "fixture has no such optional endpoint" },
    });
  return route.fulfill({ json: body });
});
const refresh = () => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
try {
  await page.goto(url);
  const card = page.getByTestId("home-try-it"),
    input = page.getByTestId("home-composer");
  const send = card.getByRole("button", { name: "Send", exact: true });
  await expect(input).toBeEnabled();
  await input.fill("Keep this first prompt");
  await expect(send).toBeDisabled(); // Original alpha fails here.
  await expect(card.getByTestId("home-model-status")).toContainText(/loading/i);
  await input.press("Enter");
  assert.equal(posts.length, 0);
  await expect(input).toHaveValue("Keep this first prompt");
  status = "ready";
  await refresh();
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByTestId("home-turn-info")).toBeVisible();
  assert.equal(posts.length, 1);
  checks.push(
    "Slow healthy startup preserves prompt, blocks premature Enter, enables once ready, sends once",
  );

  status = "loading";
  await refresh();
  await input.fill("Keep the failed-start draft");
  await expect(send).toBeDisabled();
  status = "crashed";
  await refresh();
  await expect(card.getByTestId("home-model-status")).toContainText(/failed/i);
  await expect(card.getByRole("link", { name: "Check the model" })).toBeVisible();
  await expect(input).toHaveValue("Keep the failed-start draft");
  await expect(send).toBeDisabled();
  checks.push("Failed startup replaces loading with an actionable failure and retains draft");

  status = "stopped";
  await refresh();
  await expect(card.getByTestId("home-model-status")).toContainText(/stopped/i);
  await expect(send).toBeDisabled();
  onDemand = true;
  await refresh();
  await expect(send).toBeEnabled();
  await send.click();
  await expect(input).toBeEnabled();
  assert.equal(posts.length, 2);
  checks.push("Stopped manual model cannot send; start-on-demand sends through the gateway once");

  unavailable = true;
  await refresh();
  await input.fill("Do not lose this");
  await expect(card.getByTestId("home-model-status")).toContainText(/cannot check/i);
  await expect(send).toBeDisabled();
  unavailable = false;
  status = "ready";
  await refresh();
  await expect(send).toBeEnabled();
  failRequest = true;
  await send.click();
  await expect(input).toHaveValue("Do not lose this");
  await expect(card).toContainText("Model stopped before the request arrived");
  failRequest = false;
  await send.click();
  await expect(input).toHaveValue("");
  assert.equal(posts.at(-1).messages.filter((m) => m.content === "Do not lose this").length, 1);
  checks.push(
    "Unreachable routing blocks stale readiness; a send-time failure restores draft without duplicate history",
  );

  hang = true;
  await input.fill("Cancel this");
  await send.click();
  await card.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue("Cancel this");
  const count = posts.length;
  await page.getByTestId("home-continue").click();
  await expect(page).toHaveURL(/\/playground\/?$/);
  await page.goto(url);
  await expect(input).toHaveValue("Cancel this");
  assert.equal(posts.length, count);
  checks.push("Cancellation retains draft; leaving and returning never automatically resubmits");
  await expect(send).toBeEnabled();
  await input.fill("Keep this when I leave");
  await send.click();
  await expect(card.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await page.getByTestId("home-continue").click();
  await expect(page).toHaveURL(/\/playground\/?$/);
  const leftCount = posts.length;
  await page.goto(url);
  await expect(input).toHaveValue("Keep this when I leave");
  await expect(send).toBeEnabled();
  assert.equal(posts.length, leftCount);
  const transcript = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("eugene-playground")),
  );
  assert(!transcript.messages.some((m) => m.content === "Keep this when I leave"));
  checks.push(
    "Navigating away during a pending answer restores unsent history/draft and does not replay the request",
  );
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(output, "home-a1.png") });
  console.log(JSON.stringify({ checks, posts: posts.length, errors }, null, 2));
} finally {
  await writeFile(
    join(output, "browser.json"),
    JSON.stringify({ checks, posts: posts.length, errors }, null, 2),
  );
  await browser.close();
  await new Promise((r) => server.close(r));
}
