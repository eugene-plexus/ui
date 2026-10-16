/** Built Backends page, isolated NAS/worker responses, real Chrome layout and actions. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname, join, sep } from "node:path";
import { chromium, expect } from "@playwright/test";

const [assetsArg, outputArg] = process.argv.slice(2);
assert(assetsArg && outputArg, "usage: node engines-browser-acceptance.mjs <static> <output>");
const assets = resolve(assetsArg),
  output = resolve(outputArg);
await stat(join(assets, "inference/index.html"));
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
      ".svg": "image/svg+xml",
    };
    res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [],
  checks = [],
  writes = [];
const model = "qwen3.8-flash-next-iq2_xs",
  runtime = "qwen3-8-flash-next-iq2-xs",
  driver = runtime + "-driver";
const devices = [
  {
    kind: "cuda",
    name: "NVIDIA GeForce RTX 5090",
    index: 0,
    memoryTotalBytes: 34144990003,
    memoryFreeBytes: 30709016166,
  },
];
let status = "ready",
  autoStart = true,
  installState = null,
  engineReadFails = false,
  multiple = false;
const manualReason =
  "Kev is installed by the operator in a Python environment. " +
  "Use the checkout's own interpreter. Checkpoints include adapters and a tokenizer; download the matching base model separately. ".repeat(
    6,
  );
const engines = [
  {
    engine: "llama_cpp",
    available: true,
    version: "b11364",
    modelFormats: ["gguf"],
    managed: {
      version: "b11364",
      binaryPath: "C:/Eugene/engines/llama-server.exe",
      variant: "win-cuda-13.4-x64",
    },
    acquisition: {
      installable: true,
      variant: "win-cuda-13.4-x64",
      alternatives: ["win-cuda-13.4-x64", "win-cpu-x64"],
    },
  },
  {
    engine: "kev",
    available: false,
    experimental: true,
    modelFormats: ["kev"],
    acquisition: {
      policy: "manual",
      installable: false,
      reason: manualReason,
      manualInstall: {
        command: "uv sync --extra serve",
        docsUrl: "https://example.invalid/kev",
        notes: "Use the interpreter in the engine's own environment.",
      },
    },
  },
  {
    engine: "strata",
    available: true,
    experimental: true,
    version: "v0.1.39",
    modelFormats: ["strata"],
    managed: {
      version: "v0.1.39",
      variant: "windows-x64-cuda13",
      binaryPath: "C:/Eugene/strata.exe",
    },
    acquisition: { installable: true },
  },
];
const ownRuntime = () => ({
  name: runtime,
  engine: "strata",
  modelAlias: model,
  modelPath: "C:/Models/qwen",
  status,
  autoStart,
  profile: { id: "default", name: "default" },
  localPathSource: "copy",
  localPath: "C:/Models/qwen",
});
const primaryDriver = () => ({
  name: driver,
  node: "Amish_Station",
  runtime,
  modelId: model,
  reachable: true,
  url: "http://worker:8081",
});
const identity = (worker) => ({
  name: worker ? "Amish_Station" : "NAS",
  enrolled: true,
  devices: worker ? devices : [],
  time: new Date().toISOString(),
});
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() =>
  sessionStorage.setItem("eugene-session-token", "disposable-engines-layout"),
);
await page.route("**/api/**", async (route) => {
  const req = route.request(),
    path = decodeURIComponent(new URL(req.url()).pathname);
  const worker = path.includes("node:Amish_Station");
  if (
    ["POST", "PUT", "DELETE"].includes(req.method()) &&
    !path.endsWith("/library/folders/check")
  ) {
    writes.push({ method: req.method(), path, body: req.postDataJSON() });
    assert(worker, "Every model/engine action must target the selected worker");
    if (path.endsWith("/auto-start")) autoStart = req.postDataJSON().autoStart;
    else if (path.endsWith("/stop")) status = "stopped";
    else if (path.endsWith("/start")) status = "ready";
    else if (path.endsWith("/restart"))
      return route.fulfill({ status: 409, json: { detail: "A request is still finishing." } });
    else if (path.endsWith("/install"))
      installState = {
        engine: "llama_cpp",
        state: "downloading",
        bytesTotal: 1000000000,
        bytesDownloaded: 500000000,
      };
    else if (path.endsWith("/uninstall"))
      return route.fulfill({ status: 409, json: { detail: "Stop its models first." } });
    else throw new Error("Unexpected mutation: " + path);
    return route.fulfill({ json: installState ?? ownRuntime() });
  }
  let body = {};
  if (path.endsWith("/auth/status")) body = { initialized: true };
  else if (path.endsWith("/config")) body = { firstRunComplete: true };
  else if (path.endsWith("/node")) body = identity(worker);
  else if (path.endsWith("/nodes"))
    body = {
      nodes: [
        { name: "NAS", role: "control", reachable: true, url: "http://nas:8079" },
        {
          name: "Amish_Station",
          role: "worker",
          reachable: true,
          url: "http://worker:8079",
          devices,
        },
      ],
    };
  else if (path.endsWith("/control/status")) body = { role: "control", epoch: 1 };
  else if (path.endsWith("/admin/drivers"))
    body = {
      drivers: [
        primaryDriver(),
        ...(multiple
          ? [
              {
                name: "external",
                node: "NAS",
                backend: "openai_compat_http",
                modelId: "external-model-with-a-very-long-name-".repeat(4),
                reachable: false,
                error: "Connection refused",
                url: "http://external:8000",
              },
            ]
          : []),
      ],
    };
  else if (path.endsWith("/admin/routing"))
    body = {
      control_root: { source: "agent", url: "http://nas:8283", reachable: true, nodes: 2 },
      slots: [
        {
          model,
          tiers: [
            {
              target: model,
              backends: [
                {
                  driver,
                  node: "Amish_Station",
                  runtime,
                  runtime_status: status,
                  eligible: true,
                  in_flight: 0,
                  idle_seconds: 60,
                  url: "http://worker:8081",
                },
              ],
            },
          ],
        },
      ],
      unreachable_drivers: [],
    };
  else if (path.endsWith("/components"))
    body = {
      components: [
        {
          name: driver,
          node: "Amish_Station",
          kind: "inference-driver",
          status: "running",
          url: "http://worker:8081",
        },
      ],
    };
  else if (path.endsWith("/engines")) {
    if (worker && engineReadFails)
      return route.fulfill({
        status: 503,
        json: { detail: "Worker engine inventory unavailable" },
      });
    body = { engines: worker ? engines : [] };
  } else if (path.includes("/engines/") && path.endsWith("/install")) {
    if (installState && path.includes("llama_cpp")) body = installState;
    else return route.fulfill({ status: 404, json: { detail: "No install" } });
  } else if (path.endsWith("/runtimes"))
    body = {
      runtimes: path.includes("/control/")
        ? [{ ...ownRuntime(), node: "Amish_Station" }]
        : worker
          ? [ownRuntime()]
          : [],
    };
  else if (path.endsWith("/models"))
    body = {
      object: "list",
      data: [{ id: model, object: "model", x_eugene_plexus: { context_length: 131072 } }],
    };
  else if (path.endsWith("/library/folders/check")) body = { folders: [], libraryConsulted: true };
  else
    return route.fulfill({ status: 404, json: { detail: "Optional endpoint absent in fixture" } });
  return route.fulfill({ json: body });
});
async function noOverflow() {
  const offenders = await page
    .locator("main, main table, main td, main details, main select")
    .evaluateAll((els) =>
      els
        .filter((el) => el.getBoundingClientRect().width && el.scrollWidth > el.clientWidth + 2)
        .map((el) => `${el.tagName}: ${el.scrollWidth} > ${el.clientWidth}`),
    );
  assert.deepEqual(offenders, [], "Controls and content must not require horizontal scrolling");
}
try {
  await page.goto(`${url}/inference/?sel=${encodeURIComponent(`driver:${driver}@Amish_Station`)}`);
  const row = page.locator(`tr[data-driver="${driver}"]`),
    management = page.getByTestId("engine-management");
  await expect(row.getByTestId("backend-model")).toContainText(model);
  await expect(row).toContainText("128k context");
  await expect(row).toContainText("ready");
  await expect(management).toContainText("2 installed");
  await expect(management).not.toHaveAttribute("open");
  await expect(page.getByText(manualReason)).not.toBeVisible();
  assert.equal(
    (await row.innerText()).split(runtime).length - 1,
    0,
    "Redundant runtime identity is hidden",
  );
  assert((await row.boundingBox()).y < (await management.boundingBox()).y);
  await noOverflow();
  await page.screenshot({ path: join(output, "engines-desktop.png") });
  await management.locator(":scope > summary").focus();
  await page.keyboard.press("Enter");
  await expect(management).toHaveAttribute("open", "");
  await expect(page.getByRole("region", { name: "Kev engine" })).toBeVisible();
  await expect(page.getByText(manualReason)).not.toBeVisible();
  await noOverflow();
  await expect(page.getByText(/Tools and structured output work/)).not.toBeVisible();
  await page.getByText("Using Strata models", { exact: true }).click();
  await expect(page.getByText(/Tools and structured output work/)).toBeVisible();
  await page.getByText("Using Strata models", { exact: true }).click();
  await page.screenshot({ path: join(output, "engines-expanded.png") });
  await page.getByLabel("Setup details for Kev", { exact: true }).click();
  await expect(page.getByText(manualReason)).toBeVisible();
  await noOverflow();
  await page.getByLabel("Setup details for Kev", { exact: true }).click();
  checks.push(
    "Models lead; engines and manual setup disclose by keyboard/click without losing instructions",
  );

  for (const width of [1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await noOverflow();
    if (width === 390)
      await page.screenshot({ path: join(output, "engines-mobile.png"), fullPage: true });
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "editorial"));
  await noOverflow();
  await page.screenshot({ path: join(output, "engines-light.png") });
  checks.push("No horizontal overflow at 1600, 1280, 768, 390 and 320 px; dark/light screenshots");

  await row.getByRole("button", { name: `Stop ${model}`, exact: true }).click();
  await expect(row).toContainText("stopped");
  await row.getByRole("button", { name: `Start ${model}`, exact: true }).click();
  await expect(row).toContainText("ready");
  await row.getByRole("checkbox", { name: "Start when Eugene starts" }).click();
  await expect(row.getByRole("checkbox", { name: "Start when Eugene starts" })).not.toBeChecked();
  assert.equal(autoStart, false);
  await row.getByRole("button", { name: `Restart ${model}`, exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Could not restart" })).toContainText(
    "A request is still finishing.",
  );
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await row.getByTestId("remove-row").click();
  await expect(row.getByTestId("remove-row-cancel")).toBeFocused();
  await page.setViewportSize({ width: 390, height: 1000 });
  await noOverflow();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1600, height: 1000 });
  assert(!writes.some((w) => w.method === "DELETE"));
  await expect(row.getByTestId("runtime-logs")).toHaveAttribute("href", /Amish_Station/);
  checks.push(
    "Worker start/stop, saved autostart, visible restart refusal, safe removal confirmation and logs preserved",
  );

  await page
    .getByRole("combobox", { name: "Build of llama_cpp to install" })
    .selectOption("win-cpu-x64");
  await page.getByRole("button", { name: "Install llama.cpp", exact: true }).click();
  await expect(page.getByTestId("engine-install-progress")).toContainText("50%");
  assert.deepEqual(writes.find((w) => w.path.endsWith("/install")).body, {
    variant: "win-cpu-x64",
  });
  await page.reload();
  await expect(page.getByTestId("engine-install-progress")).toBeVisible();
  await expect(management).toHaveAttribute("open", "");
  installState = { engine: "llama_cpp", state: "failed", error: "Checksum mismatch" };
  await expect(page.getByTestId("engine-install-failed")).toBeVisible();
  await expect(page.getByTestId("engine-install-failed")).toContainText("Checksum mismatch");
  checks.push(
    "Selected build reaches worker; existing install progress and failure automatically reveal engine management",
  );

  engineReadFails = true;
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "Could not read engines" })).toBeVisible();
  await expect(row.getByRole("button", { name: `Stop ${model}`, exact: true })).toBeVisible();
  engineReadFails = false;
  installState = null;
  multiple = true;
  await page.goto(`${url}/inference/?sel=backends`);
  await expect(page.locator('tr[data-driver="external"]')).toContainText("Connection refused");
  await page.setViewportSize({ width: 390, height: 1000 });
  await noOverflow();
  checks.push(
    "Inventory failures leave model controls available; multiple nodes and long external names fit narrow screens",
  );
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, writes, errors }, null, 2));
} finally {
  await writeFile(
    join(output, "browser.json"),
    JSON.stringify({ checks, writes, errors }, null, 2),
  );
  await browser.close();
  await new Promise((r) => server.close(r));
}
