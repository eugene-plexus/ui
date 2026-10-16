/** Isolated browser coverage for presentation, draft preservation and native widgets. */
import { expect, test } from "@playwright/test";

test.skip(process.env.EP_SETTINGS_FIXTURE !== "1", "opt-in settings fixture");

test("Workbench customization preserves drafts and the sorting slider supports keyboard and exact values", async ({
  page,
}, info) => {
  const fields = [
    { key: "documentsEnabled", label: "Read documents", valueType: "boolean", default: true },
    {
      key: "documentsExternalModels",
      label: "Documents sent to external models",
      valueType: "enum",
      default: "ask",
      enumValues: ["never", "ask", "always"],
      enumLabels: ["Never", "Ask each time", "Always"],
    },
    {
      key: "documentsEmbeddingModel",
      label: "Search model",
      valueType: "string",
      default: "auto",
      suggestions: ["auto", "embedding"],
      status: { level: "info", text: "In use: embedding (automatic)." },
    },
    {
      key: "documentsSortModel",
      label: "Result sorter",
      valueType: "string",
      default: "auto",
      suggestions: ["auto", "off", "sorter"],
      status: { level: "info", text: "No sorter is running. Results stay in search order." },
    },
    {
      key: "documentsSortSeconds",
      label: "Sorting time (seconds)",
      valueType: "number",
      default: 3,
      minimum: 0.5,
      maximum: 120,
      description: "Skip sorting when it is expected to take longer than this.",
    },
    {
      key: "documentsMaxFileMB",
      label: "File size limit (MiB)",
      valueType: "integer",
      default: 50,
      minimum: 1,
      maximum: 500,
    },
    {
      key: "documentsFolderSyncMinutes",
      label: "Folder check interval (minutes)",
      valueType: "integer",
      default: 5,
      minimum: 1,
      maximum: 1440,
    },
  ].map((f) => ({
    ...f,
    category: "documents",
    required: false,
    sensitive: false,
    requiresRestart: false,
    pendingRestart: false,
  }));
  let doc: Record<string, unknown> = Object.fromEntries(fields.map((f) => [f.key, f.default]));
  doc.documentsMaxFileMB = 75;
  const patches: unknown[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => sessionStorage.setItem("eugene-session-token", "fixture-token"));
  await page.route("**/api/proxy/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split("/v1/")[1] ?? "";
    const app = {
      id: "workbench",
      name: "Workbench",
      enabled: true,
      status: "running",
      configTrio: true,
    };
    let body: unknown = {};
    if (path === "node") body = { name: "PC", enrolled: true, devices: [] };
    else if (path === "nodes") body = { nodes: [{ name: "PC", reachable: true }] };
    else if (path === "apps") body = { apps: [app] };
    else if (path === "apps/workbench") body = app;
    else if (path === "apps/workbench/config/schema")
      body = { component: "workbench", fields, categories: { documents: "Documents" } };
    else if (path === "apps/workbench/config") {
      if (route.request().method() === "PATCH") {
        const patch = route.request().postDataJSON();
        patches.push(patch);
        doc = { ...doc, ...patch };
        body = { applied: Object.keys(patch), rejected: [], requiresRestart: false };
      } else body = doc;
    } else if (path === "run-operations") body = { operations: [] };
    else if (path === "downloads") body = { downloads: [] };
    else if (path === "components") body = { components: [] };
    else if (path === "engines") body = { engines: [] };
    else if (path === "runtimes") body = { runtimes: [] };
    await route.fulfill({ json: body });
  });
  await page.goto("/apps/settings?sel=app%3Aworkbench%40PC");
  await expect(page.getByRole("checkbox", { name: "Read documents" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Search model" })).toBeHidden();
  await expect(page.getByRole("list", { name: "Current custom settings" })).toContainText(
    "In use: embedding (automatic).",
  );
  await expect(page.getByRole("list", { name: "Current custom settings" })).toContainText(
    "File size limit (MiB) — 75 · Customized",
  );
  expect(patches).toEqual([]);
  await page.screenshot({ path: info.outputPath("settings-everyday.png"), fullPage: true });
  await page.getByRole("button", { name: /^Customize/ }).click();
  const slider = page.getByRole("slider", { name: "Sorting time (seconds) slider" });
  const exact = page.getByRole("spinbutton", { name: "Sorting time (seconds)", exact: true });
  await slider.focus();
  await slider.press("ArrowRight");
  expect(Number(await exact.inputValue())).toBeGreaterThan(3);
  await exact.fill("7.25");
  await expect(slider).toHaveValue("7.25");
  await page.getByRole("button", { name: /^Hide customization/ }).click();
  await expect(slider).toBeHidden();
  await expect(page.getByRole("list", { name: "Current custom settings" })).toContainText(
    "7.25 · Unsaved",
  );
  const search = page.getByRole("searchbox", { name: "Find a setting" });
  await search.fill("documentsSortModel");
  await expect(page.getByRole("combobox", { name: "Result sorter" })).toBeVisible();
  await search.fill("");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => patches).toEqual([{ documentsSortSeconds: 7.25 }]);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: /^Customize/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath("settings-phone.png"), fullPage: true });
  expect(doc.documentsMaxFileMB).toBe(75);
  expect(errors).toEqual([]);
});
