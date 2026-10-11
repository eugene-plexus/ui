/**
 * "Download and run" as one action, in a browser (hobbyist UX §6.3).
 *
 * `scripts/download-and-run-acceptance.sh` stands up a fresh install
 * with no models, no engine, and a one-entry starter list pointing at a
 * small real model, then runs this.
 *
 * Two specs, and the second is the one worth having:
 *
 *   1. One click on Home reaches a running model — with the engine
 *      question in the middle and **one tray entry** throughout, which
 *      is what §6.3 actually asks for.
 *   2. **The closed laptop.** A download started with the intent to run,
 *      finished while nobody was watching, is picked up by a browser
 *      that has never seen it — no click, no memory of the tab that
 *      asked. The script arranges that state through the API; this spec
 *      only opens Home and waits.
 */

import { expect, test, type Page } from "@playwright/test";

const PASSPHRASE = process.env.EP_PASSPHRASE ?? "m9-acceptance-passphrase";
const BUDGET = Number(process.env.EP_RUN_BUDGET_MS ?? 900_000);
/** Set by the script for the resumption spec; absent for the first one. */
const RESUME_ONLY = process.env.EP_RESUME_ONLY === "1";

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  const field = page.locator("#passphrase");
  await expect(field).toBeVisible({ timeout: 60_000 });
  await field.fill(PASSPHRASE);
  await page.getByRole("button", { name: /Unlock|Sign in/i }).click();
  await expect(page.getByTestId("resource-tree")).toBeVisible({ timeout: 120_000 });
}

test.describe("Download and run", () => {
  test.skip(RESUME_ONLY, "this pass is the resumption only");

  test("one click on Home gets the model and runs it", async ({ page }) => {
    test.setTimeout(BUDGET + 120_000);
    await signIn(page);
    await page.goto("/");

    const card = page.getByTestId("home-first-model");
    await expect(card).toHaveAttribute("data-state", "no-models-recommended", { timeout: 60_000 });

    const primary = card.getByTestId("home-primary");
    await expect(primary).toContainText("Download and run");
    await primary.click();

    // The engine question, asked before anything is installed (#6).
    const dialog = page.getByTestId("run-dialog");
    await expect(dialog).toBeVisible({ timeout: 120_000 });
    await expect(dialog).toContainText(/llama\.cpp/i);
    await dialog.getByRole("button", { name: /^Install/ }).click();

    // ONE tray entry for the whole thing, which is §6.3's own words. The
    // run's row absorbs the download's while it waits on it, so at no
    // point are there two rows for one action.
    await page.getByTestId("tasks-tray").click();
    const popover = page.getByTestId("tasks-popover");
    await expect(popover).toBeVisible();
    const rows = popover.locator("a[data-task-kind]");
    await expect(rows).toHaveCount(1, { timeout: 60_000 });
    await expect(rows.first()).toHaveAttribute("data-task-kind", "run");
    await page.keyboard.press("Escape");

    // All the way to a model that answers.
    await expect(card.or(page.getByTestId("home-try-it"))).toBeVisible();
    const tryIt = page.getByTestId("home-try-it");
    await expect(tryIt).toBeVisible({ timeout: BUDGET });
    // `home-composer`, not a bare `textarea`: Home's composer is an
    // `input`. The first run of this spec waited sixty seconds for an
    // element that does not exist while the model behind it was ready
    // and answering — the API checks in the same run passed.
    const composer = page.getByTestId("home-composer");
    await expect(composer).toBeEnabled({ timeout: 60_000 });
    await composer.fill("Reply with the single word: ok");
    await composer.press("Enter");
    await expect(tryIt).toContainText(/\w/, { timeout: 180_000 });
  });
});

test.describe("The closed laptop", () => {
  test.skip(!RESUME_ONLY, "run by the script's second pass, against a prepared state");

  test("a finished download picks itself up in a browser that never saw it", async ({ page }) => {
    test.setTimeout(BUDGET + 120_000);
    await signIn(page);
    await page.goto("/");

    // Nothing is clicked here. The intent is on the download record, the
    // console claims it, and the run appears on its own.
    const popover = page.getByTestId("tasks-popover");
    await page.getByTestId("tasks-tray").click();
    await expect(popover).toBeVisible();
    await expect(popover.locator('a[data-task-kind="run"]')).toBeVisible({ timeout: 120_000 });
    await page.keyboard.press("Escape");

    const tryIt = page.getByTestId("home-try-it");
    await expect(tryIt).toBeVisible({ timeout: BUDGET });
    await expect(page.getByTestId("home-composer")).toBeEnabled({ timeout: 60_000 });
  });
});
