/**
 * Every machine's log in a browser, against a real two-agent install
 * (2026-09-27): all machines on one timeline, one machine through the
 * tree, a model's engine lines from the Inference link's address, and a
 * line arriving while the page is open.
 *
 * Runner: `specs/scripts/logs-acceptance.sh`, which also writes the
 * marker line this spec waits for.
 */

import { expect, test, type Page } from "@playwright/test";

const PASSPHRASE = process.env.EP_PASSPHRASE ?? "m9-acceptance-passphrase";
const NODE_A = process.env.EP_NODE_A ?? "node-a";
const NODE_B = process.env.EP_NODE_B ?? "node-b";
const ENGINE = process.env.EP_ENGINE_SOURCE ?? "engine: broken";
const B_URL = process.env.EP_B_URL ?? "";
const MARKER = process.env.EP_LIVE_MARKER ?? "logs-live-marker";

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  const field = page.locator("#passphrase");
  await expect(field).toBeVisible({ timeout: 60_000 });
  await field.fill(PASSPHRASE);
  await page.getByRole("button", { name: /Unlock|Sign in/i }).click();
  await expect(page.getByTestId("resource-tree")).toBeVisible({ timeout: 120_000 });
}

const lines = (page: Page) => page.getByTestId("log-line");

test.describe("Logs", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("every machine on one timeline, each line naming its machine", async ({ page }) => {
    await page.goto("/logs/?sel=install");
    await expect(lines(page).filter({ hasText: NODE_A }).first()).toBeVisible({ timeout: 30_000 });
    await expect(lines(page).filter({ hasText: NODE_B }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("logs-unanswered")).toHaveCount(0);
  });

  test("a machine's page under Agents shows that machine alone", async ({ page }) => {
    await page.goto(`/logs/?sel=agent:${NODE_B}`);
    await expect(page.getByRole("heading", { name: `Logs on ${NODE_B}` })).toBeVisible();
    await expect(lines(page).first()).toBeVisible({ timeout: 30_000 });
    // One machine: no machine names on the lines.
    await expect(lines(page).filter({ hasText: `${NODE_A} ` })).toHaveCount(0);
  });

  test("the Inference link's address opens on the engine's own lines", async ({ page }) => {
    await page.goto(`/logs/?sel=agent:${NODE_B}&source=${encodeURIComponent(ENGINE)}`);
    await expect(page.getByTestId("logs-source")).toHaveValue(ENGINE);
    await expect(lines(page).first()).toContainText(`[${ENGINE}]`, { timeout: 30_000 });
    const texts = await lines(page).allTextContents();
    expect(texts.every((t) => t.includes(`[${ENGINE}]`))).toBe(true);
  });

  test("a line written while the page is open arrives without a reload", async ({
    page,
    request,
  }) => {
    test.skip(!B_URL, "the runner passes B's address to write a line there");
    await page.goto(`/logs/?sel=agent:${NODE_B}`);
    await expect(lines(page).first()).toBeVisible({ timeout: 30_000 });
    // Any request B answers is an access line in B's log; a 404 is enough.
    await request.get(`${B_URL}/v1/${MARKER}`);
    await expect(lines(page).filter({ hasText: MARKER }).first()).toBeVisible({ timeout: 20_000 });
  });
});
