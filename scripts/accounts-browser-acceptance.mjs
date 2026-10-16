/* global process, console */
// Real production UI and agent proxy; no intercepted API responses.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";

const { url, token, output } = JSON.parse(await readFile(process.argv[2], "utf8"));
assert(new URL(url).hostname === "127.0.0.1", "isolated loopback acceptance only");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.addInitScript((value) => sessionStorage.setItem("eugene-session-token", value), token);
  await page.goto(url + "/people/");
  await expect(page.getByRole("link", { name: "Manage Ada", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add group", exact: true }).click();
  await page.getByLabel("Group name", { exact: true }).fill("Builders");
  await page.getByLabel("Description", { exact: true }).fill("Workbench and personal job sites");
  await page.getByLabel("Workbench", { exact: true }).check();
  await page.getByLabel("Use job sites as themselves", { exact: false }).check();
  await page.getByRole("button", { name: "Create group", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Builders", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Manage Ada", exact: true }).click();
  const ada = page.getByTestId("person-Ada");
  await ada.getByLabel("Use permission groups", { exact: true }).check();
  await expect(ada.getByText(/No groups selected/)).toBeVisible();
  await ada.getByLabel("Builders", { exact: true }).check();
  await ada.getByRole("button", { name: "Save access", exact: true }).click();
  await expect(ada.getByText("Access from groups: Builders", { exact: true })).toBeVisible();
  await expect(ada.getByTestId("person-apps-Ada")).toHaveText("Workbench");
  await expect(ada.getByTestId("person-permissions-Ada")).toContainText("from groups");
  await expect(ada.getByRole("group", { name: "Job-site permissions", exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({ path: join(output, "accounts-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(ada).toBeVisible();
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "mobile viewport overflows",
  );
  await page.screenshot({ path: join(output, "accounts-mobile.png"), fullPage: true });
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "browser-result.json"),
    JSON.stringify({ passed: true, errors, widths: [1500, 390], realApi: true }, null, 2),
  );
  console.log(
    "PASS Chrome creates and assigns a group through the real agent; desktop/mobile layouts fit",
  );
} finally {
  await browser.close();
}
