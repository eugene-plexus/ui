/* global process, console */
// Static production export in real Chrome; every API request is intercepted.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname, join, sep } from "node:path";
import { chromium, expect } from "@playwright/test";

const [assetsArg, outputArg] = process.argv.slice(2);
assert(assetsArg && outputArg, "usage: node metrics-browser-acceptance.mjs <static> <output>");
const assets = resolve(assetsArg),
  output = resolve(outputArg);
await stat(join(assets, "metrics/index.html"));
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    let file = resolve(assets, "." + decodeURIComponent(new URL(req.url, "http://test").pathname));
    assert(file === assets || file.startsWith(assets + sep));
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
      }[extname(file)] ?? "application/octet-stream",
    );
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const errors = [],
  checks = [],
  calls = [];
let mode = "normal";
const now = Date.now();
const qwen = "qwen3.8-flash-next-iq2_xs";
const base = {
  requests: 18420,
  errors: 23,
  cascaded: 142,
  swappedIn: 38,
  latencyMs: { p50: 3240, p90: 7820, p99: 14880, max: 31920 },
  ttftMs: { p50: 284, p90: 680, p99: 1400, max: 3200 },
  tokensPerSecond: { p50: 92.4, samples: 17004 },
  decodeTokensPerSecond: { p50: 128.6, samples: 16021 },
  routingMs: { p50: 4, p90: 12, max: 82 },
  overheadMs: { p50: 8, p90: 20, max: 140 },
  waitedMs: { p50: 2340, p90: 8010, max: 14800 },
  promptCache: { requests: 15700, promptTokens: 1000000, cachedTokens: 784000 },
  affinity: { hit: 7300, new: 9100, moved: 42, evicted: 6 },
  tierCounts: { 1: 18120, 2: 277 },
};
const backend = {
  driver: "qwen-strata",
  node: "Amish_Station",
  runtime: "qwen-flash",
  eligible: true,
  runtime_status: "ready",
  in_flight: 3,
  parallel_slots: 4,
};
const routing = () => ({
  refreshed_at: new Date(now - 23000).toISOString(),
  load_balancing: "least_busy",
  control_root: { source: "agent", reachable: true, nodes: 3 },
  slots: [
    { model: qwen, tiers: [{ target: qwen, backends: [backend] }] },
    {
      model: "fast-chat",
      tiers: [
        { target: qwen, backends: [backend] },
        {
          target: "cloud",
          backends: [
            {
              driver: "cloud-fallback",
              node: "NAS",
              eligible: true,
              in_flight: 1,
              parallel_slots: 8,
            },
          ],
        },
      ],
    },
    {
      model: "deep-reasoning",
      tiers: [
        {
          target: "reasoner",
          backends: [
            {
              driver: "reasoning-worker",
              node: "Worker_2",
              eligible: false,
              runtime_status: "stopped",
              in_flight: 0,
              parallel_slots: 2,
              start_on_demand: true,
              ineligible_reason: "Unloaded after idle timeout",
            },
          ],
        },
      ],
    },
  ],
  unreachable_drivers: [],
});
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() =>
  sessionStorage.setItem("eugene-session-token", "disposable-metrics-layout"),
);
await page.route("**/api/**", async (route) => {
  const req = route.request(),
    parsed = new URL(req.url()),
    path = decodeURIComponent(parsed.pathname),
    query = parsed.searchParams;
  calls.push({ method: req.method(), path, query: parsed.search });
  if (path.endsWith("/library/folders/check") && req.method() === "POST")
    return route.fulfill({ json: { folders: [], libraryConsulted: true } });
  assert.equal(req.method(), "GET", `Dashboard must be read-only: ${path}`);
  if (path.endsWith("/metrics") && ["failed", "disabled"].includes(mode))
    return route.fulfill({
      status: mode === "disabled" ? 503 : 500,
      json: { detail: "Metrics store unavailable: disk is full." },
    });
  if (path.endsWith("/admin/routing") && mode === "partial")
    return route.fulfill({ status: 502, json: { detail: "Routing snapshot unavailable" } });
  let body = {};
  if (path.endsWith("/auth/status")) body = { initialized: true };
  else if (path.endsWith("/config")) body = { firstRunComplete: true };
  else if (path.endsWith("/node"))
    body = { name: "NAS", enrolled: true, devices: [], time: new Date(now).toISOString() };
  else if (path.endsWith("/nodes"))
    body = {
      nodes: [
        { name: "NAS", role: "control", reachable: true, url: "http://nas:8079" },
        { name: "Amish_Station", role: "worker", reachable: true, url: "http://worker:8079" },
      ],
    };
  else if (path.endsWith("/control/status")) body = { role: "control", epoch: 1 };
  else if (path.endsWith("/components"))
    body = {
      components: [
        { kind: "gateway", name: "gateway", status: "running", url: "http://gateway:8080" },
      ],
    };
  else if (path.endsWith("/admin/drivers"))
    body = {
      drivers: [{ name: "qwen-strata", node: "Amish_Station", modelId: qwen, reachable: true }],
    };
  else if (path.endsWith("/admin/routing")) body = routing();
  else if (path.endsWith("/runtimes")) body = { runtimes: [] };
  else if (path.endsWith("/models"))
    body = { object: "list", data: [qwen, "fast-chat"].map((id) => ({ id, object: "model" })) };
  else if (path.endsWith("/metrics")) {
    const windowStart = decodeURIComponent(query.get("since")),
      windowEnd = new Date(now).toISOString();
    let groups =
      query.get("groupBy") === "total"
        ? [base]
        : [
            {
              ...base,
              model: qwen,
              driver: "qwen-strata",
              node: "Amish_Station",
              runtime: "qwen-flash",
            },
          ];
    if (query.get("bucket") === "hour") {
      const start = new Date(windowStart);
      start.setUTCMinutes(0, 0, 0);
      groups = Array.from({ length: Math.ceil((now - start.getTime()) / 3600000) }, (_, i) => ({
        ...base,
        bucketStart: new Date(start.getTime() + i * 3600000).toISOString(),
        requests: Math.round(400 + 400 * (1 + Math.sin(i * 0.7))),
        errors: i % 5 === 0 ? 3 : 0,
        cascaded: (i % 7) * 3,
        swappedIn: i % 4,
        latencyMs: {
          p50: 2200 + 700 * Math.sin(i),
          p90: 4800 + 2100 * Math.sin(i * 0.5),
          max: 31000,
        },
        ttftMs: { p50: 180 + 160 * (1 + Math.sin(i)), p90: 680, max: 3200 },
        decodeTokensPerSecond: { p50: 120 + 30 * Math.cos(i * 0.7), samples: 240 },
      }));
    }
    body = {
      windowStart,
      windowEnd,
      gatewayStartedAt: new Date(now - 12 * 86400000).toISOString(),
      rowsDropped: mode === "partial" ? 4 : 0,
      truncated: mode === "partial",
      groups: mode === "empty" ? [] : groups,
    };
  } else if (path.endsWith("/metrics/clients"))
    body = {
      windowStart: new Date(now - 86400000).toISOString(),
      windowEnd: new Date(now).toISOString(),
      rowsDropped: 0,
      clients: [
        {
          clientKeyId: "key-workbench",
          clientKeyName: "Workbench",
          requests: 14200,
          served: 14180,
          failed: 20,
          attempts: 14330,
          promptTokens: 8420000,
          completionTokens: 1940000,
          incompleteUsageRequests: 12,
        },
      ],
    };
  else if (path.endsWith("/metrics/requests"))
    body = {
      requests:
        mode === "empty"
          ? []
          : [
              {
                requestId: "req-dashboard-investigation-01",
                startedAt: new Date(now - 12000).toISOString(),
                requestedModel: query.get("model") || qwen,
                attempts: 2,
                totalMs: 8400,
                outcome: "error",
                streamed: true,
                routingMs: 12,
                strategy: "least_busy",
                tries: [
                  {
                    driver: "qwen-strata",
                    elapsedMs: 3200,
                    served: false,
                    firstMs: 280,
                    error: "Backend connection closed",
                    usageKnown: false,
                  },
                  {
                    driver: "cloud-fallback",
                    elapsedMs: 5100,
                    served: false,
                    error: "Upstream rate limit",
                    usageKnown: false,
                  },
                ],
              },
            ],
    };
  else
    return route.fulfill({ status: 404, json: { detail: "Optional endpoint absent in fixture" } });
  return route.fulfill({ json: body });
});
async function noOverflow() {
  assert.equal(
    await page.locator("main").evaluate((el) => el.scrollWidth > el.clientWidth + 2),
    false,
    "Dashboard must fit its scroll container",
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2),
    false,
    "Page must fit viewport",
  );
}
async function refresh() {
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
}
try {
  await page.goto(`${url}/metrics/?sel=gateway`);
  await expect(
    page.getByRole("heading", { name: "Traffic. Performance. Reliability." }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Window at a glance" })).toContainText("18.4K");
  await expect(page.getByText("2 / 3", { exact: true })).toBeVisible();
  await expect(page.getByText("Routable backends").locator("..").locator("..")).toContainText(
    "2 / 3",
  );
  const capacity = page.getByRole("region", { name: "Backend capacity" });
  await expect(
    capacity.getByText("In flight", { exact: true }).locator("..").locator(".."),
  ).toContainText("4");
  await noOverflow();
  await page.screenshot({ path: join(output, "metrics-desktop.png") });
  await page.getByRole("link", { name: "Capacity", exact: true }).click();
  await page.screenshot({ path: join(output, "metrics-capacity.png") });
  checks.push(
    "Deduplicated capacity, honest sleeping-route status, six history charts and server percentiles",
  );
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloadEvent;
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(exported.totals.groups[0].requests, 18420);
  assert.equal(exported.scopes.capacity, "current, all models");
  assert.equal(exported.selection.model, null);
  await page.getByRole("combobox", { name: "Request outcome", exact: true }).selectOption("error");
  await expect(page.getByRole("combobox", { name: "Request outcome", exact: true })).toHaveValue(
    "error",
  );
  assert(
    calls.some((c) => c.path.endsWith("/metrics/requests") && c.query.includes("outcome=error")),
  );
  await expect(page.getByText("Request req-dashboard-investigation-01")).toBeVisible();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  for (const width of [1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.locator("main").evaluate((el) => {
      el.scrollTop = 0;
    });
    await noOverflow();
    if (width === 390) await page.screenshot({ path: join(output, "metrics-mobile.png") });
  }
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "editorial"));
  await page.screenshot({ path: join(output, "metrics-light.png") });
  checks.push(
    "Export includes scope and exact data; failures filter requests on server; desktop/mobile and light theme fit",
  );
  mode = "failed";
  await refresh();
  await expect(page.getByText(/Refresh failed. Showing the last/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeDisabled();
  mode = "partial";
  await refresh();
  await expect(page.getByText(/Capacity unavailable: Routing snapshot unavailable/)).toBeVisible();
  await expect(page.getByText(/4 measurements were dropped/)).toBeVisible();
  await expect(page.getByText(/Part of this window/)).toBeVisible();
  mode = "empty";
  await refresh();
  await expect(page.getByText(/No retained requests match/)).toBeVisible();
  await expect(page.getByText("2 / 3", { exact: true })).toBeVisible();
  mode = "disabled";
  await refresh();
  await expect(page.getByRole("heading", { name: "Not recording", exact: true })).toBeVisible();
  checks.push(
    "Failed refresh marked stale; export disabled; partial reads, dropped/expired data, empty window, and disabled recording distinct",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "browser.json"),
    JSON.stringify(
      {
        result: "passed",
        checks,
        browserErrors: errors,
        apiMutations: calls.filter(
          (c) => c.method !== "GET" && !c.path.endsWith("/library/folders/check"),
        ),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ result: "passed", checks }, null, 2));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
