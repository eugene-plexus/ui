// Real APIs through Next's development rewrite and the actual agent proxy.
// No route interception or synthetic responses. The Python harness owns servers.
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";

const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(config.url + "/administration/");
  await page.getByLabel("Account name").fill("Manager");
  await page.getByLabel("Password", { exact: true }).fill(config.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Signed in as Manager")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add group" })).toHaveCount(0);
  await page.getByText("Add a person", { exact: true }).click();
  await page.getByLabel("Account name").fill("New member");
  await page.getByLabel("First password").fill(config.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Account created. Assign group access below.")).toBeVisible();
  const member = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "New member", exact: true }) });
  await member.getByText("Assign groups", { exact: true }).click();
  await member.getByLabel("Builders", { exact: true }).check();
  await member.getByRole("button", { name: "Save memberships" }).click();
  await expect(member.getByText("Groups: Builders", { exact: true })).toBeVisible();
  await expect(member.getByText("Apps: Workbench", { exact: true })).toBeVisible();
  await page.screenshot({ path: config.output + "/administration-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: config.output + "/administration-mobile.png", fullPage: true });
  await page.reload();
  await expect(page.getByText("Signed in as Manager")).toBeVisible();
  const token = await page.evaluate(() => sessionStorage.getItem("eugene-administration-token"));
  const headers = { Authorization: "Bearer " + token };
  // Real root refuses APIs that the UI never presents.
  const forbidden = await context.request.get(config.agent + "/api/proxy/control/v1/config", {
    headers,
  });
  expect(forbidden.status()).toBe(401);
  const reset = await context.request.put(
    config.agent + `/api/proxy/control/v1/people/${config.person}/password`,
    { headers, data: { password: config.password } },
  );
  expect(reset.status()).toBe(401);
  const removed = await context.request.put(
    config.control + `/v1/people/${config.manager}/administration`,
    { headers: { Authorization: "Bearer " + config.owner }, data: {} },
  );
  expect(removed.status()).toBe(200);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Administrator sign-in" })).toBeVisible();
  expect(errors).toEqual([]);
  writeFileSync(
    config.output + "/browser-result.json",
    JSON.stringify(
      { passed: true, mobileFits: true, pageErrors: errors, revokedSessionRefused: true },
      null,
      2,
    ),
  );
  console.log(
    "PASS Chrome named sign-in, account creation, scoped assignment, reload, mobile and immediate revocation",
  );
} finally {
  await browser.close();
}
