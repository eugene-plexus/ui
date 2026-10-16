import { readFileSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";

const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(
    (token) => sessionStorage.setItem("eugene-session-token", token),
    config.token,
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(config.url + "/people/");
  await page.getByText("Access history", { exact: true }).click();
  await expect(page.getByText(/Showing the latest/)).toBeVisible();
  await expect(page.getByText(/Saved account/).first()).toBeVisible();
  await page.getByRole("button", { name: "Refresh history" }).click();
  await expect(page.getByText(/Showing the latest/)).toBeVisible();
  await page.getByText("Access history", { exact: true }).evaluate((el) => el.scrollIntoView());
  await page.screenshot({ path: config.output + "/access-history-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText("Access history", { exact: true }).evaluate((el) => el.scrollIntoView());
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: config.output + "/access-history-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
  writeFileSync(
    config.output + "/browser-result.json",
    JSON.stringify({ passed: true, realProxy: true, mobileFits: true }, null, 2),
  );
} finally {
  await browser.close();
}
