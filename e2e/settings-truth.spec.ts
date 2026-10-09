/**
 * Settings never lie (Troy, 2026-09-29: fundamental), in a browser, against
 * a real install.
 *
 * `specs/docs/design/settings-accuracy.md`. The runner
 * (`specs/scripts/settings-truth-acceptance.sh`) builds a throwaway install
 * whose files hold the states this is about -- an update channel never saved,
 * a hand-edited value no dropdown offers, a number out of range, a restart
 * saved but not taken, a share login with and without a password -- and this
 * spec reads what the Settings page shows for each against what the
 * components really serve.
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

const PASSPHRASE = process.env.EP_PASSPHRASE ?? "settings-truth";
const DRIVER = process.env.EP_DRIVER_NAME ?? "truth-probe";
const NODE = process.env.EP_NODE_NAME ?? "truth-node";

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  const field = page.locator("#passphrase");
  await expect(field).toBeVisible({ timeout: 60_000 });
  await field.fill(PASSPHRASE);
  await page.getByRole("button", { name: /Unlock|Sign in/i }).click();
  await expect(page.getByTestId("resource-tree")).toBeVisible({ timeout: 120_000 });
}

/** One field on the Settings page, by the component that owns it. */
function field(page: Page, target: string, key: string): Locator {
  return page.locator(
    `[data-testid="settings-section"][data-target="${target}"] [data-config-key="${key}"]`,
  );
}

async function settings(page: Page, query: string): Promise<void> {
  await page.goto(`/config?q=${encodeURIComponent(query)}`);
  await expect(page.getByTestId("settings-section").first()).toBeVisible({ timeout: 60_000 });
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("an update channel never saved is not decided, never shown as a choice", async ({ page }) => {
  await settings(page, "updateChannel");
  const channel = field(page, "agent", "updateChannel");
  await expect(channel).toBeVisible();
  await expect(channel.locator("select")).toHaveValue("");
  await expect(channel.locator("select option:checked")).toHaveText("Not set");
  await expect(channel.getByTestId("unset-updateChannel")).toContainText("Not decided yet");
});

test("choosing a channel saves it, and it reads back as itself", async ({ page }) => {
  await settings(page, "updateChannel");
  const channel = field(page, "agent", "updateChannel");
  await channel.locator("select").selectOption("releases");
  await page.getByTestId("section-actions").getByRole("button", { name: "Save" }).click();
  await page.reload();
  const again = field(page, "agent", "updateChannel");
  await expect(again.locator("select option:checked")).toHaveText("Releases");
  await expect(again.getByTestId("default-updateChannel")).toContainText("Releases");
});

test("a value no dropdown offers is shown as itself, with why", async ({ page }) => {
  await settings(page, "loadBalancing");
  const balancing = field(page, "gateway", "loadBalancing");
  await expect(balancing.locator("select option:checked")).toHaveText(
    '"beta" (not one of the choices)',
  );
  await expect(balancing.getByTestId("value-warning-loadBalancing")).toContainText('"beta"');
});

test("a number out of range is shown, and said", async ({ page }) => {
  await settings(page, "maxImagesPerRequest");
  const images = field(page, "gateway", "maxImagesPerRequest");
  await expect(images.locator("input")).toHaveValue("1000");
  await expect(images.getByTestId("value-warning-maxImagesPerRequest")).toContainText("1 to 64");
});

test("unset values say what they do, in each component's words", async ({ page }) => {
  await settings(page, "defaultMaxTokens");
  await expect(
    field(page, "gateway", "defaultMaxTokens").getByTestId("unset-defaultMaxTokens"),
  ).toContainText("No cap");
  await settings(page, "corsAllowedOrigins");
  const origins = field(page, "gateway", "corsAllowedOrigins");
  await expect(origins).toContainText("any website may call");
  await expect(origins).not.toContainText("standby");
  await settings(page, "hfToken");
  await expect(field(page, "library", "hfToken").getByTestId("unset-hfToken")).toContainText(
    "anonymously",
  );
  await settings(page, "standbyUrls");
  await expect(field(page, "control", "standbyUrls")).toContainText("No standbys");
});

test("a saved value not yet in effect says what runs meanwhile", async ({ page }) => {
  await settings(page, "logLevel");
  const level = field(page, "gateway", "logLevel");
  await expect(level.getByTestId("pending-logLevel")).toContainText(
    "runs on INFO until it restarts",
  );
});

test("a share login says whether a password is stored", async ({ page }) => {
  await settings(page, "shareCredentials");
  const boxes = page.getByLabel("Password for the file server");
  await expect(boxes).toHaveCount(2);
  await expect(boxes.nth(0)).toHaveAttribute("placeholder", "saved - leave blank to keep it");
  await expect(boxes.nth(1)).toHaveAttribute("placeholder", "no password saved");
});

test("a backend's address says whose it is, and a saved provider waits for a restart", async ({
  page,
}) => {
  await page.goto(`/config?sel=${encodeURIComponent(`driver:${DRIVER}@${NODE}`)}`);
  const provider = page.locator('[data-config-key="provider"]');
  await expect(provider).toBeVisible({ timeout: 60_000 });
  await expect(provider.getByTestId("pending-provider")).toBeVisible();
  const base = page.locator('[data-config-key="baseUrl"]');
  await expect(base.getByTestId("unset-baseUrl")).toContainText("openrouter.ai");
});
