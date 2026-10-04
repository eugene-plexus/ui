/** Real exported setup form, downloads and narrow-screen scrolling. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat, mkdir } from "node:fs/promises";
import { resolve, extname, join, sep } from "node:path";
import { chromium, expect } from "@playwright/test";

const [assetsArg, outputArg] = process.argv.slice(2);
assert(assetsArg && outputArg, "usage: node access-browser-acceptance.mjs <static> <output>");
const assets = resolve(assetsArg),
  output = resolve(outputArg);
await stat(join(assets, "access/index.html"));
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    let file = resolve(assets, "." + decodeURIComponent(new URL(req.url, "http://test").pathname));
    assert(file === assets || file.startsWith(assets + sep));
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
    res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
const errors = [];
let submitted;
page.on("pageerror", (error) => errors.push(String(error)));
await page.addInitScript(() => sessionStorage.setItem("eugene-session-token", "disposable-access"));
await page.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith("/entrypoint/preview")) {
    submitted = route.request().postDataJSON().configuration;
    return route.fulfill({
      json: {
        configuration: submitted,
        publicUrls: {
          consoleUrl: submitted.console.origin,
          workbenchUrl: submitted.workbench.origin,
        },
        instructions: [
          "No running settings changed.",
          "Keep your data volume and follow the migration guide.",
        ],
      },
    });
  }
  let body;
  if (path.endsWith("/auth/status")) body = { initialized: true };
  else if (path.endsWith("/config")) body = { firstRunComplete: true };
  else if (path.endsWith("/node")) body = { name: "NAS", enrolled: true, devices: [] };
  else if (path.endsWith("/nodes")) body = { nodes: [] };
  else if (path.endsWith("/components")) body = { components: [] };
  else if (path.endsWith("/control/status")) body = { role: "control", epoch: 1 };
  else return route.fulfill({ status: 404, json: { detail: "Optional endpoint absent" } });
  return route.fulfill({ json: body });
});
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/access/`);
  await expect(page.getByRole("heading", { name: "Container access setup" })).toBeVisible();
  await page.getByLabel("Base domain", { exact: false }).fill("example.org");
  await page.getByLabel("Allowed private networks", { exact: false }).fill("192.168.16.0/24");
  await page.getByLabel("Trusted proxy IP addresses", { exact: false }).fill("172.30.0.2");
  await page.getByRole("button", { name: "Prepare setup" }).click();
  await expect(page.getByRole("region", { name: "Prepared setup" })).toBeVisible();
  assert.equal(submitted.proxy.transport, "http");
  const downloadWait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download configuration" }).click();
  const download = await downloadWait;
  assert.equal(download.suggestedFilename(), "entrypoint.json");
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), submitted);

  await page.getByLabel("Who manages HTTPS?").selectOption("automatic");
  await expect(page.getByRole("region", { name: "Prepared setup" })).toHaveCount(0);
  await expect(page.getByLabel("Public HTTPS port")).toBeDisabled();
  await page.getByLabel("Certificate contact email").fill("owner@example.org");
  await page.getByLabel("I accept", { exact: false }).check();
  await page.getByRole("button", { name: "Prepare setup" }).click();
  await expect(page.getByRole("region", { name: "Prepared setup" })).toBeVisible();
  assert.equal(submitted.acme.accept_terms, true);
  assert.equal(submitted.proxy, undefined);

  await page.getByLabel("Who manages HTTPS?").selectOption("local");
  await page.getByRole("button", { name: "Prepare setup" }).click();
  await expect(page.getByRole("region", { name: "Prepared setup" })).toBeVisible();
  assert.equal(submitted.internal_ca, true);
  assert.equal(submitted.acme, undefined);

  await page.getByLabel("Who manages HTTPS?").selectOption("certificate");
  await page.getByLabel("Private CA certificate path (optional)").fill("/data/organisation.pem");
  await page.getByRole("button", { name: "Prepare setup" }).click();
  await expect(page.getByRole("region", { name: "Prepared setup" })).toBeVisible();
  assert.equal(submitted.trusted_ca, "/data/organisation.pem");
  assert.equal(submitted.internal_ca, undefined);
  await page.screenshot({ path: join(output, "desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Download instructions" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Download instructions" })).toBeInViewport();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: join(output, "phone.png") });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: exported setup works in Chrome for all four modes; download bytes, stale preview removal and mobile scrolling verified",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
