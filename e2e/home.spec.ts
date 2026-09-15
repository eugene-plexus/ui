/**
 * Home, the install root's first page (hobbyist UX plan, S1).
 *
 * Runs against a live one-agent install the way `tree.spec.ts` does
 * (`scripts/navigation-acceptance.sh` stands it up). What it proves: a
 * signed-in operator lands on a page with one primary action and no
 * disabled input, the tasks tray opens and closes, and the playground
 * still exists at its new address. What it cannot prove here: the Try it
 * card's first reply, which needs a routable model this install does
 * not have; `playground-diagnostic-acceptance.sh` is where a model is.
 */

import { expect, test, type Page } from "@playwright/test";

const PASSPHRASE = process.env.EP_PASSPHRASE ?? "m9-acceptance-passphrase";

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  const field = page.locator("#passphrase");
  await expect(field).toBeVisible({ timeout: 60_000 });
  await field.fill(PASSPHRASE);
  await page.getByRole("button", { name: /Unlock|Sign in/i }).click();
  await expect(page.getByTestId("resource-tree")).toBeVisible({ timeout: 120_000 });
}

test.describe("Home", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("signing in lands on Home, and Home has a primary action instead of a disabled box", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/(\?.*)?$/);
    await expect(page.getByTestId("selection")).toHaveAttribute("data-sel", "install", {
      timeout: 60_000,
    });

    // §0.3 of the design: the first thing a new user met was a composer
    // disabled with the placeholder "Waiting…". Whatever state this install
    // is in, Home must not render a disabled text input anywhere.
    await expect(page.locator("textarea:disabled, input[type=text]:disabled")).toHaveCount(0);

    // One of the two task cards is present, never neither: either nothing
    // is routable and the first-model card offers a way forward, or a
    // model is routable and Try it offers a composer.
    const firstModel = page.getByTestId("home-first-model");
    const tryIt = page.getByTestId("home-try-it");
    await expect(firstModel.or(tryIt).first()).toBeVisible({ timeout: 60_000 });
    if (await firstModel.isVisible()) {
      const primary = firstModel.getByRole("link", {
        name: /Find a model|Choose a model to run/,
      });
      await expect(primary).toBeVisible();
    } else {
      await expect(tryIt.getByRole("combobox")).toBeVisible();
      await expect(tryIt.locator("textarea, input[type=text]")).toBeEnabled();
    }
  });

  test("the tasks tray opens, says what is running, and closes on Escape", async ({ page }) => {
    await page.goto("/");
    const tray = page.getByTestId("tasks-tray");
    await expect(tray).toBeVisible({ timeout: 60_000 });
    await tray.click();
    const popover = page.getByTestId("tasks-popover");
    await expect(popover).toBeVisible();
    // On this install nothing downloads or loads, so the honest line is
    // the empty state; with a task present a progress row appears instead.
    await expect(
      popover
        .getByText(/Nothing is running in the background/)
        .or(popover.getByRole("link").first()),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    await expect(tray).toHaveAttribute("aria-expanded", "false");
  });

  test("the playground still exists, one page over", async ({ page }) => {
    await page.goto("/playground");
    await expect(page).toHaveURL(/\/playground/);
    await expect(page.getByTestId("selection")).toHaveAttribute("data-sel", "install", {
      timeout: 60_000,
    });
    // Either a model picker or the no-models line: the screen rendered.
    await expect(
      page
        .getByRole("combobox")
        .first()
        .or(page.getByText(/No routable models/)),
    ).toBeVisible({ timeout: 60_000 });
  });
});
