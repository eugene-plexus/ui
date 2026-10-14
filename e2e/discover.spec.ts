/**
 * Discover, recommendation-first (hobbyist UX plan, S6).
 *
 * Runs against a live one-agent install the way `home.spec.ts` does
 * (`scripts/starter-set-acceptance.sh` stands it up). What it proves,
 * in a browser rather than in a unit test:
 *
 *   - with nothing typed, the screen is the starter set and not a page
 *     of whatever the hub sorted to the top today;
 *   - the suggestion is one card with one Download button on it, and the
 *     rest of the set is under a heading;
 *   - every verdict names the context it was scored at, and changing the
 *     context changes the verdicts;
 *   - a pasted link resolves to one repo, whose detail opens with a
 *     suggested version above a table called "All versions".
 *
 * **It needs the hub**, for the pasted-link case only: the starter panel
 * itself makes no upstream call and the run asserts that separately.
 */

import { expect, test, type Page } from "@playwright/test";

const PASSPHRASE = process.env.EP_PASSPHRASE ?? "m9-acceptance-passphrase";
const REPO = process.env.EP_DISCOVER_REPO ?? "unsloth/Qwen3-0.6B-GGUF";

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  const field = page.locator("#passphrase");
  await expect(field).toBeVisible({ timeout: 60_000 });
  await field.fill(PASSPHRASE);
  await page.getByRole("button", { name: /Unlock|Sign in/i }).click();
  await expect(page.getByTestId("resource-tree")).toBeVisible({ timeout: 120_000 });
}

test.describe("Discover", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto("/discover");
  });

  test("with nothing typed, the screen suggests models rather than listing the hub", async ({
    page,
  }) => {
    const panel = page.getByTestId("starter-set");
    await expect(panel).toBeVisible({ timeout: 60_000 });

    // One card, one primary button, above a list of the rest.
    await expect(page.getByTestId("starter-recommended")).toBeVisible();
    await expect(page.getByTestId("starter-download")).toBeVisible();
    await expect(panel).toContainText("All suggestions");

    // Ranked by downloads and said so -- there is no quality score here,
    // invented or borrowed, and a reader who assumes one is reading a
    // different document from the one written.
    await expect(panel).toContainText(/downloaded them in the last 30 days/i);
    // The date, because staleness rather than error is how a
    // recommendation in this field fails.
    await expect(panel).toContainText(/Reviewed /);

    const rows = page.getByTestId("starter-row");
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test("every verdict names the context it was scored at, and the control changes it", async ({
    page,
  }) => {
    await expect(page.getByTestId("starter-set")).toBeVisible({ timeout: 60_000 });
    const badge = page.getByTestId("fit-badge").first();
    await expect(badge).toContainText(/ at \d/);

    const control = page.getByLabel("Context length to score against");
    await expect(control).toBeVisible();
    await control.selectOption("131072");
    await expect(page.getByTestId("fit-badge").first()).toContainText("128k", {
      timeout: 30_000,
    });
  });

  test("a pasted link resolves to one model", async ({ page }) => {
    const box = page.getByRole("searchbox", { name: "Search the model catalogue" });
    await box.fill(`https://huggingface.co/${REPO}/tree/main`);

    // Said out loud: the list is one row because the link named one repo.
    await expect(page.getByTestId("resolved-link")).toBeVisible({ timeout: 60_000 });
    // And selected, rather than left for the person to click the only row.
    await expect(page.getByRole("heading", { level: 2 })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("all-versions")).toBeVisible({ timeout: 60_000 });
  });

  test("a repo opens with one suggested version above the full table", async ({ page }) => {
    const box = page.getByRole("searchbox", { name: "Search the model catalogue" });
    await box.fill(REPO);

    const suggested = page.getByTestId("repo-recommended");
    await expect(suggested).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("repo-recommended-download")).toBeVisible();
    // §0.5: the wall here is eleven near-identical rows, and a table
    // cannot have a primary action. Every row is still reachable.
    await expect(page.getByTestId("all-versions")).toBeVisible();
    await expect(suggested.getByTestId("fit-badge")).toContainText(/ at \d/);
  });
});
