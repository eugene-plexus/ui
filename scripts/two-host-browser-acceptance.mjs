// Real agent/root APIs and the production export; no intercepted requests.
import { readFileSync, writeFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";

const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
expect(new URL(config.agent).hostname).toBe("127.0.0.1");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const login = await context.request.post(config.agent + "/v1/auth/login", {
    data: { passphrase: config.password },
  });
  expect(login.status()).toBe(200);
  await context.addInitScript(
    (token) => sessionStorage.setItem("eugene-session-token", token),
    (await login.json()).sessionToken,
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(config.agent + "/access/");
  await page.getByLabel("Base domain", { exact: false }).fill("example.org");
  await page.getByLabel("Allowed private networks", { exact: false }).fill("192.168.16.0/24");
  await page.getByLabel("Trusted proxy IP addresses", { exact: false }).fill("172.30.0.2");
  await page.getByLabel("Enable the model API for other apps", { exact: false }).check();
  await expect(
    page.getByLabel("Use Eugene’s address (recommended)", { exact: false }),
  ).toBeChecked();
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/v1/entrypoint/preview") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Prepare setup", exact: true }).click();
  const preview = await (await response).json();
  expect(preview.configuration.inference_on_console.networks).toEqual(["192.168.16.0/24"]);
  expect(preview.configuration.inference).toBeUndefined();
  expect(preview.publicUrls.inferenceUrl).toBe("https://eugene.example.org/inference");
  await expect(page.getByRole("region", { name: "Prepared setup" })).toContainText(
    "https://eugene.example.org/inference/v1",
  );
  await page.screenshot({ path: config.output + "/access-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: config.output + "/access-mobile.png", fullPage: true });

  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(config.agent + "/people/");
  await page.getByText("External sign-in", { exact: true }).click();
  await expect(page.getByText("https://eugene.example.org/oidc", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Eugene sign-in address", { exact: true })).not.toBeVisible();
  await expect(
    page.getByText("https://eugene.example.org/oidc/external/callback", { exact: true }),
  ).toBeVisible();
  await page
    .getByText("External sign-in", { exact: true })
    .locator("..")
    .screenshot({ path: config.output + "/sso-derived-desktop.png" });
  await page.getByText("Advanced: override the sign-in address", { exact: true }).click();
  await page
    .getByLabel("Eugene sign-in address", { exact: true })
    .fill("https://existing.example.org/oidc");
  await page.getByRole("button", { name: "Save sign-in address", exact: true }).click();
  await expect(
    page.getByText("https://existing.example.org/oidc/external/callback", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByText("External sign-in", { exact: true }).click();
  await expect(
    page.getByText("https://existing.example.org/oidc/external/callback", { exact: true }),
  ).toBeVisible();
  await page.getByText("Advanced: override the sign-in address", { exact: true }).click();
  await page.getByRole("button", { name: "Use access setup address", exact: true }).click();
  await expect(
    page.getByText("https://eugene.example.org/oidc/external/callback", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText("Advanced: override the sign-in address", { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: config.output + "/sso-derived-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
  writeFileSync(
    config.output + "/browser-result.json",
    JSON.stringify({ passed: true, preview, errors }, null, 2) + "\n",
  );
} finally {
  await browser.close();
}
